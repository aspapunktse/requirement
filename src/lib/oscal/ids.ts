/**
 * Identifiers in an OSCAL Package (ADR 0017, #442). Pure: no database, no clock.
 *
 * - `oscalUuid`: the UUID of a record, a version-5 (name-based, SHA-1) UUID of `<model>:<id>[:<id>...]` under one fixed
 *   namespace, so the same record keeps the same UUID in every export. The record's CUID never appears in a package.
 * - `controlId`: a Control's OSCAL id, derived from its code.
 */
import { createHash } from "node:crypto";

/**
 * The namespace of every OSCAL UUID this app derives. It must NEVER change: changing it gives every record a new identity,
 * so a recipient could no longer follow a System or Control from one package to the next (ADR 0017).
 */
export const OSCAL_NAMESPACE_UUID = "4912ea13-2c3d-4b59-849e-d13c7efec5ba";

const NAMESPACE_BYTES = Buffer.from(OSCAL_NAMESPACE_UUID.replace(/-/g, ""), "hex");

/** RFC 4122 version-5 UUID of `name` under `namespace` (16 bytes). */
function uuidV5(name: string, namespace: Buffer): string {
  const hash = createHash("sha1").update(namespace).update(name, "utf8").digest().subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The OSCAL UUID of one record: `model` names the kind of record ("System", "Control"), `ids` its key (a record id, or a pair). */
export function oscalUuid(model: string, ...ids: string[]): string {
  return uuidV5(`${model}:${ids.join(":")}`, NAMESPACE_BYTES);
}

/** The URI the app's own props and its system identifier type live under. Chosen by the product owner (#452); never change it. */
export const OSCAL_APP_NS = "https://github.com/aspapunktse/requirement/ns/oscal";

/** The kinds of OSCAL document a package holds. */
export type DocumentKind = "catalog" | "profile" | "ssp" | "assessment-plan" | "assessment-results";

/**
 * The identifier of a document across its exports (`metadata.document-ids`): the same Control Library, or the same System's
 * Profile or SSP, has the same identifier in every export, while the root `uuid` is new each time. The Catalog is the one Control
 * Library (a fixed subject); a Profile and an SSP are per System (`subjectId` is the System's id, never written to the package); an
 * Assessment Plan and Assessment Results are per System and Internal Audit (`subjectId` is both ids, "<systemId>:<auditId>").
 */
export function documentId(kind: DocumentKind, subjectId?: string): string {
  return oscalUuid("Document", kind, kind === "catalog" ? "control-library" : (subjectId ?? ""));
}

/** OSCAL's token datatype (NIST schema `TokenDatatype`). */
const TOKEN = /^(\p{L}|_)(\p{L}|\p{N}|[.\-_])*$/u;

/**
 * A Control's OSCAL id. A code that is already a valid OSCAL token and does not start with `_` is used unchanged ("A.5.15",
 * "SEC-001"); the original code also travels as the control's `label` prop. Any other code is escaped reversibly: a leading
 * `_`, then every character that is not a letter, digit, `.` or `-` as `_x<hex code point>_` ("5.1 Policy" becomes
 * "_5.1_x20_Policy"). Never lowercased: OSCAL ids are case-sensitive, and lowercasing would merge "A.5" and "a.5".
 *
 * No two codes get the same id: an escaped id always starts with `_` and writes `_` itself as `_x5f_`, so it decodes to one
 * code only, and an unchanged id never starts with `_` (the prototype's rule let the code "_5.1_x20_Policy" collide with the
 * escaped "5.1 Policy"; a code that starts with `_` is therefore escaped too).
 */
export function controlId(code: string): string {
  if (TOKEN.test(code) && !code.startsWith("_")) return code;
  return "_" + [...code].map((ch) => (/[\p{L}\p{N}.-]/u.test(ch) ? ch : `_x${ch.codePointAt(0)!.toString(16)}_`)).join("");
}

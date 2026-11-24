/**
 * OSCAL package validator (#441, PRD #440). Used by tests and CI, not on the request path.
 *
 * A package is three documents: a Catalog, an OSCAL Profile and a System Security Plan.
 * Two layers, because the JSON schema does not catch broken links:
 *   1. schema: each document against NIST's pinned OSCAL v1.2.3 schema, using the per-model
 *      definition rather than the schema root (a `oneOf` over every model).
 *   2. reference: links between and inside the documents (see `referenceErrors`).
 * The reference layer only runs when every document passes the schema, so it can rely on shape.
 *
 * In-package href convention: `catalog.json` and `profile.json`, with or without a leading `./`.
 * The Profile imports `catalog.json`; the SSP's import-profile is `profile.json`. Any other href
 * (an http URL, `../x`, `#uuid`) points outside the package and is an error.
 */
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import oscalSchema from "./schema/oscal_complete_schema.json";

export type OscalDocumentName = "catalog" | "profile" | "ssp";
export type OscalValidationError = {
  layer: "schema" | "reference";
  document: OscalDocumentName;
  /** JSON pointer into the document file, starting at its root key (e.g. `/profile/imports/0`). */
  path: string;
  message: string;
};
export type OscalPackage = { catalog: unknown; profile: unknown; ssp: unknown };

const ROOT_KEY: Record<OscalDocumentName, string> = {
  catalog: "catalog",
  profile: "profile",
  ssp: "system-security-plan",
};
const MODEL_DEFINITION: Record<OscalDocumentName, string> = {
  catalog: "oscal-complete-oscal-catalog:catalog",
  profile: "oscal-complete-oscal-profile:profile",
  ssp: "oscal-complete-oscal-ssp:system-security-plan",
};
/** Package file name (without `./`) of each in-package document. */
export const PACKAGE_FILES = { catalog: "catalog.json", profile: "profile.json" } as const;

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

let validators: (Record<OscalDocumentName, ValidateFunction> & { directive: ValidateFunction }) | undefined;
function getValidators() {
  if (!validators) {
    const ajv = new Ajv({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(oscalSchema);
    const id = (oscalSchema as { $id: string }).$id;
    const get = (name: OscalDocumentName) => {
      const fn = ajv.getSchema(`${id}#/definitions/${MODEL_DEFINITION[name]}`);
      if (!fn) throw new Error(`OSCAL schema definition ${MODEL_DEFINITION[name]} not found`);
      return fn;
    };
    const directive = ajv.getSchema(`${id}#/definitions/json-schema-directive`);
    if (!directive) throw new Error("OSCAL schema definition json-schema-directive not found");
    validators = { catalog: get("catalog"), profile: get("profile"), ssp: get("ssp"), directive };
  }
  return validators;
}

export function schemaErrors(document: OscalDocumentName, doc: unknown): OscalValidationError[] {
  const root = ROOT_KEY[document];
  if (!isObject(doc) || !(root in doc)) {
    return [{ layer: "schema", document, path: "", message: `must be an object with a "${root}" property` }];
  }
  const extra = Object.keys(doc).filter((k) => k !== root && k !== "$schema");
  const errors: OscalValidationError[] = extra.map((k) => ({
    layer: "schema",
    document,
    path: `/${k}`,
    message: `must not have the property "${k}"`,
  }));
  const { directive, ...models } = getValidators();
  if ("$schema" in doc && !directive(doc.$schema)) {
    for (const e of directive.errors ?? []) {
      errors.push({ layer: "schema", document, path: "/$schema", message: e.message ?? "is invalid" });
    }
  }
  const validate = models[document];
  if (!validate(doc[root])) {
    for (const e of validate.errors ?? []) {
      const extraProperty = e.keyword === "additionalProperties" ? ` (${JSON.stringify(e.params.additionalProperty)})` : "";
      errors.push({
        layer: "schema",
        document,
        path: `/${root}${e.instancePath}`,
        message: `${e.message ?? "is invalid"}${extraProperty}`,
      });
    }
  }
  return errors;
}

/** Strips one leading `./` and returns the in-package document an href names, if any. */
export function packageDocumentForHref(href: string): "catalog" | "profile" | undefined {
  const name = href.startsWith("./") ? href.slice(2) : href;
  if (name === PACKAGE_FILES.catalog) return "catalog";
  if (name === PACKAGE_FILES.profile) return "profile";
  return undefined;
}

/** Ids of every control in a Catalog document, including controls nested in groups and enhancements. */
export function catalogControlIds(catalog: unknown): Set<string> {
  const ids = new Set<string>();
  const walkControl = (c: unknown) => {
    if (!isObject(c)) return;
    if (typeof c.id === "string") ids.add(c.id);
    asArray(c.controls).forEach(walkControl);
  };
  const walkGroup = (g: unknown) => {
    if (!isObject(g)) return;
    asArray(g.controls).forEach(walkControl);
    asArray(g.groups).forEach(walkGroup);
  };
  const root = isObject(catalog) && isObject(catalog.catalog) ? catalog.catalog : {};
  asArray(root.controls).forEach(walkControl);
  asArray(root.groups).forEach(walkGroup);
  return ids;
}

/**
 * Resolves a Profile against its Catalog. Supports only `include-controls` with `with-ids`; every
 * other way of selecting or changing controls is reported as unsupported, not guessed at.
 * Returns the selected control ids (in order, no duplicates) and the problems found.
 */
export function resolveProfile(
  profile: unknown,
  catalog: unknown,
): { ids: string[]; errors: Omit<OscalValidationError, "layer" | "document">[] } {
  const ids = new Set<string>();
  const errors: { path: string; message: string }[] = [];
  const root = isObject(profile) && isObject(profile.profile) ? profile.profile : {};
  const have = catalogControlIds(catalog);
  const unsupported = (path: string, what: string) =>
    errors.push({ path, message: `unsupported: ${what} (only include-controls with with-ids is supported)` });

  if (root.merge !== undefined) unsupported("/profile/merge", "merge");
  if (root.modify !== undefined) unsupported("/profile/modify", "modify");

  asArray(root.imports).forEach((imp, i) => {
    if (!isObject(imp)) return;
    const base = `/profile/imports/${i}`;
    if (imp["include-all"] !== undefined) unsupported(`${base}/include-all`, "include-all");
    if (imp["exclude-controls"] !== undefined) unsupported(`${base}/exclude-controls`, "exclude-controls");
    const includes = asArray(imp["include-controls"]);
    if (imp["include-all"] === undefined && includes.length === 0) {
      errors.push({ path: base, message: "import selects no controls: expected include-controls with with-ids" });
    }
    includes.forEach((inc, j) => {
      if (!isObject(inc)) return;
      const ip = `${base}/include-controls/${j}`;
      if (inc.matching !== undefined) unsupported(`${ip}/matching`, "matching");
      if (inc["with-child-controls"] === "yes") unsupported(`${ip}/with-child-controls`, "with-child-controls");
      if (inc["with-ids"] === undefined && inc.matching === undefined) {
        errors.push({ path: ip, message: "include-controls without with-ids" });
      }
      asArray(inc["with-ids"]).forEach((id, k) => {
        if (typeof id !== "string") return;
        if (have.has(id)) ids.add(id);
        else errors.push({ path: `${ip}/with-ids/${k}`, message: `control "${id}" is not in the Catalog` });
      });
    });
  });
  return { ids: [...ids], errors };
}

function hrefError(
  document: OscalDocumentName,
  path: string,
  href: unknown,
  expected: "catalog" | "profile",
): OscalValidationError | undefined {
  const target = typeof href === "string" ? packageDocumentForHref(href) : undefined;
  if (target === expected) return undefined;
  return {
    layer: "reference",
    document,
    path,
    message: `href ${JSON.stringify(href)} does not resolve to ${PACKAGE_FILES[expected]} inside the package`,
  };
}

/** Every uuid and id the SSP defines, for checking the references made to them. */
function sspDefinitions(ssp: Json) {
  const metadata = isObject(ssp.metadata) ? ssp.metadata : {};
  const impl = isObject(ssp["system-implementation"]) ? ssp["system-implementation"] : {};
  const pick = (list: unknown, key: string) =>
    new Set(asArray(list).flatMap((x) => (isObject(x) && typeof x[key] === "string" ? [x[key] as string] : [])));
  return {
    components: pick(impl.components, "uuid"),
    roles: pick(metadata.roles, "id"),
    parties: pick(metadata.parties, "uuid"),
  };
}

export function referenceErrors(pkg: OscalPackage): OscalValidationError[] {
  const errors: OscalValidationError[] = [];
  const add = (document: OscalDocumentName, path: string, message: string) =>
    errors.push({ layer: "reference", document, path, message });
  const profileDoc = pkg.profile as Json;
  const sspDoc = (pkg.ssp as Json)[ROOT_KEY.ssp] as Json;

  // Links between the documents.
  const profileRoot = profileDoc.profile as Json;
  asArray(profileRoot.imports).forEach((imp, i) => {
    const e = hrefError("profile", `/profile/imports/${i}/href`, (imp as Json).href, "catalog");
    if (e) errors.push(e);
  });
  const sspImportError = hrefError(
    "ssp",
    "/system-security-plan/import-profile/href",
    (sspDoc["import-profile"] as Json | undefined)?.href,
    "profile",
  );
  if (sspImportError) errors.push(sspImportError);

  // The Profile: only the supported subset, every id in the Catalog.
  const resolved = resolveProfile(pkg.profile, pkg.catalog);
  for (const e of resolved.errors) add("profile", e.path, e.message);
  const selected = new Set(resolved.ids);

  // The SSP: controls in the selected set, and every referenced uuid or id defined.
  asArray((sspDoc["control-implementation"] as Json | undefined)?.["implemented-requirements"]).forEach((ir, i) => {
    const id = (ir as Json)["control-id"];
    if (typeof id === "string" && !selected.has(id)) {
      add(
        "ssp",
        `/system-security-plan/control-implementation/implemented-requirements/${i}/control-id`,
        `control "${id}" is not in the set selected by the Profile`,
      );
    }
  });

  const defs = sspDefinitions(sspDoc);
  const check = (path: string, value: unknown, defined: Set<string>, what: string) => {
    if (typeof value === "string" && !defined.has(value)) add("ssp", path, `${what} "${value}" is not defined in the SSP`);
  };
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}/${i}`));
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const p = `${path}/${key}`;
      if (key === "component-uuid") check(p, value, defs.components, "component");
      else if (key === "role-id") check(p, value, defs.roles, "role");
      else if (key === "role-ids") asArray(value).forEach((v, i) => check(`${p}/${i}`, v, defs.roles, "role"));
      else if (key === "party-uuid") check(p, value, defs.parties, "party");
      else if (key === "party-uuids" || key === "member-of-organizations")
        asArray(value).forEach((v, i) => check(`${p}/${i}`, v, defs.parties, "party"));
      else walk(value, p);
    }
  };
  walk(sspDoc, "/system-security-plan");
  return errors;
}

/** Validates a package. Reference checks run only if all three documents pass the schema. */
export function validateOscalPackage(pkg: OscalPackage): OscalValidationError[] {
  const schema = (["catalog", "profile", "ssp"] as const).flatMap((name) => schemaErrors(name, pkg[name]));
  return schema.length > 0 ? schema : referenceErrors(pkg);
}

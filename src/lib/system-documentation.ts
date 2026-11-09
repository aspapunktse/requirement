import type { DocumentationStage, EvaluationTrack, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { DOCUMENT_REQUIREMENT_SELECT, toRow } from "@/lib/document-requirement-data";
import type { DocumentRequirementRow } from "@/lib/document-requirement";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/**
 * What a System provides against the Document Requirements (#324, PRD 0002 F-DOC.2). One `SystemDocument` row per
 * System and Document Requirement holds a link, an uploaded file and a "provided" mark (which needs a link or a file); no row means not provided. The System's owner
 * or an Admin writes them, at any Onboarding Status (like the Business System Owner). Writing is not a Change Event:
 * the row records who and when. The stage gate that uses `documentationStatusFor` comes with the stage tickets.
 */

/** May `user` set a System's document links and mark them provided? The owner or an Admin, as everywhere. */
export function canEditSystemDocuments(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  return isSystemOwnerOrAdmin(user, system);
}

export const MAX_DOCUMENT_LINK_LENGTH = 2000;
export const PROVIDED_NEEDS_EVIDENCE = "Add a link or upload a file before marking it provided.";

/**
 * Does a Document Requirement apply to a System on `track`? Before a System has a Track (`null`, `undefined`) every
 * one applies; once it has one, only those whose Tracks include it. The one definition: callers pass the System's
 * Track in when the stage tickets add it.
 */
export function appliesToTrack(requirement: { tracks: readonly EvaluationTrack[] }, track?: EvaluationTrack | null): boolean {
  return !track || requirement.tracks.includes(track);
}

/** The Document Requirements that apply on `track` (all of them when `track` is null or omitted). */
export function applicableRequirements<T extends { tracks: readonly EvaluationTrack[] }>(requirements: readonly T[], track?: EvaluationTrack | null): T[] {
  return requirements.filter((requirement) => appliesToTrack(requirement, track));
}

/** A link as typed: trimmed, empty is none, otherwise an http(s) URL of bounded length. */
const link = z
  .string({ error: "The link must be text, or null for none." })
  .trim()
  .max(MAX_DOCUMENT_LINK_LENGTH, `The link can be at most ${MAX_DOCUMENT_LINK_LENGTH} characters.`)
  .nullable()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => {
      if (value === null) return true;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "The link must be a web address starting with http:// or https://." },
  );

/**
 * Body of `PUT /api/systems/[id]/documents/[documentRequirementId]`. Marking provided needs a link or an uploaded
 * file, which the route checks against the stored file (the body can't know it).
 */
export const systemDocumentBodySchema = z.object({ link, provided: z.boolean({ error: "provided must be true or false." }) });

type DocumentsClient = Pick<Prisma.TransactionClient, "documentRequirement" | "systemDocument">;

/** The columns of a stored file that may be read outside the download route: never `data`. */
export const SYSTEM_DOCUMENT_FILE_SELECT = { fileName: true, contentType: true, size: true, uploadedAt: true } as const;

/** One applicable Document Requirement with what the System has recorded against it. */
export type SystemDocumentRow = DocumentRequirementRow & {
  link: string | null;
  provided: boolean;
  /** The uploaded file, without its bytes (those are only read by the download route). */
  file: { fileName: string; contentType: string; size: number; uploadedAt: string } | null;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
};

/**
 * The Document Requirements that apply to `systemId` (see `appliesToTrack`), first documentation before second round
 * and then by name, each with its link and whether it is provided (not provided when there is no row). Every query
 * is on `client`, so a caller can pass a transaction.
 */
export async function listSystemDocuments(client: DocumentsClient, systemId: string, track?: EvaluationTrack | null): Promise<SystemDocumentRow[]> {
  const [requirements, records] = await Promise.all([
    client.documentRequirement.findMany({ select: DOCUMENT_REQUIREMENT_SELECT, orderBy: [{ stage: "asc" }, { name: "asc" }] }),
    client.systemDocument.findMany({
      where: { systemId },
      select: {
        documentRequirementId: true,
        link: true,
        provided: true,
        updatedAt: true,
        updatedBy: { select: { id: true, name: true } },
        file: { select: SYSTEM_DOCUMENT_FILE_SELECT },
      },
    }),
  ]);
  const byRequirement = new Map(records.map((record) => [record.documentRequirementId, record]));
  return applicableRequirements(requirements.map(toRow), track).map((requirement) => {
    const record = byRequirement.get(requirement.id);
    return {
      ...requirement,
      link: record?.link ?? null,
      provided: record?.provided ?? false,
      file: record?.file ? { ...record.file, uploadedAt: record.file.uploadedAt.toISOString() } : null,
      updatedAt: record ? record.updatedAt.toISOString() : null,
      updatedBy: record?.updatedBy ?? null,
    };
  });
}

export type DocumentationStatus = { allProvided: boolean; missing: { id: string; name: string }[] };

/**
 * Are all Document Requirements for `stage` provided on `systemId`? `missing` names the ones that apply (on `track`,
 * all of them when omitted) and aren't marked provided, by name; a stage with none applicable is all provided. For the
 * stage gates: pass the Prisma client, or a transaction `tx`, and every query here uses it.
 */
export async function documentationStatusFor(
  client: DocumentsClient,
  systemId: string,
  stage: DocumentationStage,
  track?: EvaluationTrack | null,
): Promise<DocumentationStatus> {
  const requirements = applicableRequirements(await client.documentRequirement.findMany({ where: { stage }, select: { id: true, name: true, tracks: true }, orderBy: { name: "asc" } }), track);
  const provided = new Set(
    (
      await client.systemDocument.findMany({
        where: { systemId, provided: true, documentRequirementId: { in: requirements.map((requirement) => requirement.id) } },
        select: { documentRequirementId: true },
      })
    ).map((record) => record.documentRequirementId),
  );
  const missing = requirements.filter((requirement) => !provided.has(requirement.id)).map(({ id, name }) => ({ id, name }));
  return { allProvided: missing.length === 0, missing };
}

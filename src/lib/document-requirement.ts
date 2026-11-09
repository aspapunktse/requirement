import type { DocumentationStage, EvaluationTrack, UserRole } from "@prisma/client";
import { z } from "zod";

/**
 * Document Requirements (#323, PRD 0002 F-DOC.1): a catalogue of what a System must provide besides answering its
 * Controls. Everyone signed in reads it; the Compliance Manager and an Admin curate it (create, edit, delete). Catalogue
 * edits are not Change Events. First documentation is a Full-track stage, so a requirement for it can't apply to Self.
 */
export const ROLES_ALLOWED_TO_CURATE_DOCUMENT_REQUIREMENTS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

export function canCurateDocumentRequirements(user: { role: UserRole } | null | undefined): boolean {
  return !!user && ROLES_ALLOWED_TO_CURATE_DOCUMENT_REQUIREMENTS.includes(user.role);
}

export const MAX_DOCUMENT_REQUIREMENT_NAME_LENGTH = 80;
export const MAX_DOCUMENT_REQUIREMENT_DESCRIPTION_LENGTH = 300;

export const DOCUMENTATION_STAGES = ["FIRST_DOCUMENTATION", "SECOND_ROUND"] as const satisfies readonly DocumentationStage[];
export const EVALUATION_TRACKS = ["SELF", "FULL"] as const satisfies readonly EvaluationTrack[];

export const STAGE_LABEL: Record<DocumentationStage, string> = { FIRST_DOCUMENTATION: "First documentation", SECOND_ROUND: "Second round" };
export const TRACK_LABEL: Record<EvaluationTrack, string> = { SELF: "Self", FULL: "Full" };

export const FIRST_DOCUMENTATION_IS_FULL = "First documentation is a Full-track stage, so a Document Requirement for it can't apply to the Self track.";

/** True when the stage and Tracks go together: first documentation never includes Self. */
export function stageAllowsTracks(stage: DocumentationStage, tracks: readonly EvaluationTrack[]): boolean {
  return !(stage === "FIRST_DOCUMENTATION" && tracks.includes("SELF"));
}

const name = z
  .string({ error: "Give the Document Requirement a name." })
  .trim()
  .min(1, "Give the Document Requirement a name.")
  .max(MAX_DOCUMENT_REQUIREMENT_NAME_LENGTH, `The name can be at most ${MAX_DOCUMENT_REQUIREMENT_NAME_LENGTH} characters.`);

/** An empty description is the same as none. */
const description = z
  .string()
  .trim()
  .max(MAX_DOCUMENT_REQUIREMENT_DESCRIPTION_LENGTH, `The description can be at most ${MAX_DOCUMENT_REQUIREMENT_DESCRIPTION_LENGTH} characters.`)
  .nullable()
  .transform((value) => (value ? value : null));

const stage = z.enum(DOCUMENTATION_STAGES, { error: "Choose the stage that needs it: first documentation or second round." });

/** The Tracks it applies to, in a fixed order without repeats; at least one. */
const tracks = z
  .array(z.enum(EVALUATION_TRACKS, { error: "Choose Self, Full or both." }), { error: "Choose the Tracks it applies to." })
  .min(1, "Choose at least one Track.")
  .transform((list) => EVALUATION_TRACKS.filter((track) => list.includes(track)));

export const createDocumentRequirementSchema = z
  .object({ name, description: description.optional().default(null), stage, tracks })
  .refine((data) => stageAllowsTracks(data.stage, data.tracks), { message: FIRST_DOCUMENTATION_IS_FULL, path: ["tracks"] });

/** An edit may change any of the fields; the stage/Tracks pairing is checked by the route against the stored other field. */
export const updateDocumentRequirementSchema = z
  .object({ name: name.optional(), description: description.optional(), stage: stage.optional(), tracks: tracks.optional() })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one of name, description, stage or tracks to update.",
  });

/** One Document Requirement as the page and the API show it. */
export type DocumentRequirementRow = {
  id: string;
  name: string;
  description: string | null;
  stage: DocumentationStage;
  tracks: EvaluationTrack[];
};

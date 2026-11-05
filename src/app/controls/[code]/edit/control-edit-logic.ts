import type { ImpactLevel } from "@prisma/client";
import type { ControlEditView } from "./control-edit-data";

/**
 * The pure side of the single-Control editor (issue #314, decision 3): the form's draft, which fields changed,
 * the request body for `PATCH /api/controls/[id]` and what is wrong with the draft. No React, no Prisma values.
 */

export type EditableControl = ControlEditView["control"];

/** What the form holds: the text areas as typed, the picks as ids. */
export type EditDraft = {
  title: string;
  description: string;
  category: string;
  mandatory: boolean;
  question: string;
  intent: string;
  /** One example per line, as typed. */
  examples: string;
  deploymentFacetIds: string[];
  minSensitivityLevel: number | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
  /** "" is no Control Owner. */
  ownerId: string;
};

/** The body `PATCH /api/controls/[id]` takes: only the fields that changed. */
export type EditBody = {
  title?: string;
  description?: string;
  category?: string;
  mandatory?: boolean;
  question?: string | null;
  intent?: string | null;
  examples?: string[];
  deploymentFacetIds?: string[];
  minSensitivityLevel?: number | null;
  minIntegrityImpactLevel?: ImpactLevel | null;
  minAvailabilityImpactLevel?: ImpactLevel | null;
  ownerId?: string | null;
};

export const draftOf = (control: EditableControl): EditDraft => ({
  title: control.title,
  description: control.description,
  category: control.category,
  mandatory: control.mandatory,
  question: control.question ?? "",
  intent: control.intent ?? "",
  examples: control.examples.join("\n"),
  deploymentFacetIds: control.deploymentFacetIds,
  minSensitivityLevel: control.minSensitivityLevel,
  minIntegrityImpactLevel: control.minIntegrityImpactLevel,
  minAvailabilityImpactLevel: control.minAvailabilityImpactLevel,
  ownerId: control.ownerId ?? "",
});

/** The lines of the examples box: trimmed, empty lines dropped. */
export const exampleLines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const sameSet = (a: string[], b: string[]) => new Set(a).size === new Set(b).size && a.every((id) => b.includes(id));
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * The body to send for `draft`: only what differs from `control`, so a Save can't clear a Control Owner the picker
 * never offered or rewrite a field nobody touched. An Organizational Control has no Self-Assessment Question, Intent,
 * Examples or scoping, so none of those is ever sent for it (the API refuses scoping on one). Empty when nothing changed.
 */
export function editBody(control: EditableControl, draft: EditDraft): EditBody {
  const body: EditBody = {};
  if (draft.title.trim() !== control.title) body.title = draft.title.trim();
  if (draft.description.trim() !== control.description) body.description = draft.description.trim();
  if (draft.category.trim() !== control.category) body.category = draft.category.trim();
  if (draft.mandatory !== control.mandatory) body.mandatory = draft.mandatory;
  if (draft.ownerId !== (control.ownerId ?? "")) body.ownerId = draft.ownerId === "" ? null : draft.ownerId;
  if (control.applicability === "ORGANIZATIONAL") return body;

  if (draft.question.trim() !== (control.question ?? "")) body.question = draft.question.trim() === "" ? null : draft.question.trim();
  if (draft.intent.trim() !== (control.intent ?? "")) body.intent = draft.intent.trim() === "" ? null : draft.intent.trim();
  const examples = exampleLines(draft.examples);
  if (!sameList(examples, control.examples)) body.examples = examples;
  if (!sameSet(draft.deploymentFacetIds, control.deploymentFacetIds)) body.deploymentFacetIds = draft.deploymentFacetIds;
  if (draft.minSensitivityLevel !== control.minSensitivityLevel) body.minSensitivityLevel = draft.minSensitivityLevel;
  if (draft.minIntegrityImpactLevel !== control.minIntegrityImpactLevel) body.minIntegrityImpactLevel = draft.minIntegrityImpactLevel;
  if (draft.minAvailabilityImpactLevel !== control.minAvailabilityImpactLevel) body.minAvailabilityImpactLevel = draft.minAvailabilityImpactLevel;
  return body;
}

export const hasChanges = (control: EditableControl, draft: EditDraft) => Object.keys(editBody(control, draft)).length > 0;

/**
 * What stops a Save, as the create form requires it: a title, a description and a category, and for a Per-System or
 * Both Control a Self-Assessment Question. The API checks the first three too (it refuses an empty string); the
 * question is the form's own rule, as when a Control is created.
 */
export function draftProblems(control: EditableControl, draft: EditDraft): string[] {
  const problems: string[] = [];
  if (draft.title.trim() === "") problems.push("Title is required.");
  if (draft.description.trim() === "") problems.push("Description is required.");
  if (draft.category.trim() === "") problems.push("Category is required.");
  // Only when it had one: a Control that never got a question can still have its other fields saved.
  if (control.applicability !== "ORGANIZATIONAL" && control.question && draft.question.trim() === "") problems.push("A Per-System or Both Control needs a Self-Assessment Question.");
  return problems;
}

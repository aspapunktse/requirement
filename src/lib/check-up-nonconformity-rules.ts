import type { ControlAssessmentStatus } from "@prisma/client";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";

/**
 * The words a Nonconformity writes (#157): the Risk's title and description, the note on a target
 * that is set back, and the path of the finding. Pure and Prisma-free so they are unit-tested and
 * the Check-up page can show them. Nothing here decides anything.
 */

/** Where the finding lives: a relative path, which is how a note or an event links to it. */
export function checkUpFindingPath(checkUpId: string): string {
  return `/check-ups/${checkUpId}`;
}

/** What the evaluation did to the target, for the Risk's description. */
export type SetBackOutcome =
  | { kind: "SET_BACK" }
  /** The stored status isn't Fulfilled: left exactly as it is. */
  | { kind: "NOT_FULFILLED"; status: ControlAssessmentStatus }
  /** A System's own status isn't Fulfilled but it is effectively Fulfilled through `source` (e.g. "Inherited from Organization"): not changed. */
  | { kind: "INHERITED_ONLY"; status: ControlAssessmentStatus; source: string };

/** The longest part of the auditor's comment copied into the Risk (the comment itself stays whole on the evaluation). */
export const RISK_COMMENT_COPY_LIMIT = 600;

/** The note appended to the target's notes or description when it is set back. */
export function setBackNote(auditTitle: string, finding: string): string {
  return `Set back from Fulfilled to In Progress by an Internal Audit Nonconformity (audit "${auditTitle}"): ${finding}`;
}

/** The sentence about the target that closes the Risk's description. */
export function setBackSentence(outcome: SetBackOutcome, target: "System" | "Organization"): string {
  const owner = target === "System" ? "System's" : "Organization's";
  switch (outcome.kind) {
    case "SET_BACK":
      return `The ${owner} status was Fulfilled and has been set back to In Progress.`;
    case "NOT_FULFILLED":
      return `Not changed: the ${owner} stored status is ${CONTROL_ASSESSMENT_STATUS_LABEL[outcome.status]}, not Fulfilled.`;
    case "INHERITED_ONLY":
      return `Not changed: this System's status is inherited (${outcome.source}); its own status is ${CONTROL_ASSESSMENT_STATUS_LABEL[outcome.status]}, so there was nothing to set back.`;
  }
}

/** The Risk a Nonconformity opens. */
export function nonconformityRiskText(input: {
  auditTitle: string;
  control: { code: string; title: string };
  systemName: string | null;
  comment: string;
  outcome: SetBackOutcome;
  finding: string;
}): { title: string; description: string } {
  const comment =
    input.comment.length > RISK_COMMENT_COPY_LIMIT ? `${input.comment.slice(0, RISK_COMMENT_COPY_LIMIT)}… (see the finding)` : input.comment;
  const target = input.systemName === null ? "the Organization" : `System "${input.systemName}"`;
  return {
    title: `${input.control.code}: ${input.control.title} (Internal Audit Nonconformity)`,
    description: [
      `Internal Audit "${input.auditTitle}" found a Nonconformity on ${input.control.code} for ${target} (${input.finding}).`,
      `Auditor's comment: ${comment}`,
      setBackSentence(input.outcome, input.systemName === null ? "Organization" : "System"),
    ].join("\n\n"),
  };
}

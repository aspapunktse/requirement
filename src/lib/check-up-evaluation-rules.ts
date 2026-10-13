import type { CheckUpOutcome, InternalAuditStatus, UserRole } from "@prisma/client";
import { canWriteInternalAudits, INTERNAL_AUDIT_STATUS_LABEL } from "@/lib/internal-audit-rules";

/**
 * Who evaluates a Check-up, when, and what an evaluation must contain (PRD 0001 F-IA.6, F-CE.1,
 * #156). Pure and Prisma-free, so the route, the page, the form and the unit matrix share one
 * definition. An evaluation records a verdict and one Change Event; a Nonconformity has no side
 * effect yet (a Risk and a status set-back are #157's).
 */

export const CHECK_UP_OUTCOMES: CheckUpOutcome[] = ["CONFORMING", "OBSERVATION", "NONCONFORMITY"];
export const CHECK_UP_OUTCOME_LABEL: Record<CheckUpOutcome, string> = {
  CONFORMING: "Conforming",
  OBSERVATION: "Observation",
  NONCONFORMITY: "Nonconformity",
};

export const MAX_EVALUATION_COMMENT_LENGTH = 2000;

/**
 * May `user` evaluate Check-ups? Only an Internal Auditor, and any Internal Auditor, not only the
 * one who created or launched the audit (decision 7a on #152: audits are a small team's shared
 * work). The Admin and the Compliance Manager are refused too (independence), like every other
 * role. It is the same allow-list as writing Internal Audits, so there is one place to change it.
 * An Internal Auditor is never a Check-up's recipient in practice (decision 14a on #155: they
 * never answer), so no "not your own Check-up" case is needed.
 */
export function canEvaluateCheckUps(user: { role: UserRole }): boolean {
  return canWriteInternalAudits(user);
}

/**
 * Why a Check-up can't be evaluated (now), or null if it can. All of them are 409, checked in
 * this order: it is already evaluated (an evaluation is final: it is never changed or replaced,
 * because a Nonconformity fires side effects, #157, that a later change would have to undo; the
 * alternative, changeable until the audit closes, is a product-owner decision), its audit isn't
 * launched, or it hasn't been answered.
 */
export function checkUpEvaluationRefusal(checkUp: {
  auditStatus: InternalAuditStatus;
  answered: boolean;
  evaluated: boolean;
}): string | null {
  if (checkUp.evaluated) return "This Check-up has been evaluated already; an evaluation is final";
  if (checkUp.auditStatus !== "LAUNCHED") {
    return `This Check-up can't be evaluated: its Internal Audit is ${INTERNAL_AUDIT_STATUS_LABEL[checkUp.auditStatus].toLowerCase()}`;
  }
  if (!checkUp.answered) return "This Check-up can't be evaluated until it has been answered";
  return null;
}

/** A finding without a reason is no use to the recipient: only a Conforming outcome may go without a comment. */
export function commentRequired(outcome: CheckUpOutcome): boolean {
  return outcome !== "CONFORMING";
}

export type EvaluationInput = { outcome: string; comment?: string };
export type ValidEvaluation = { outcome: CheckUpOutcome; comment: string };

/**
 * Validates an evaluation: the outcome is one of the three, the comment (trimmed) is at most
 * `MAX_EVALUATION_COMMENT_LENGTH` characters and present for an Observation and a Nonconformity.
 * Returns the cleaned evaluation, usable only when `problems` is empty.
 */
export function validateEvaluation(input: EvaluationInput): { evaluation: ValidEvaluation | null; problems: string[] } {
  const problems: string[] = [];
  const outcome = CHECK_UP_OUTCOMES.find((o) => o === input.outcome);
  const comment = (input.comment ?? "").trim();
  if (!outcome) problems.push("The outcome must be Conforming, Observation or Nonconformity");
  if (comment.length > MAX_EVALUATION_COMMENT_LENGTH) {
    problems.push(`The comment can be at most ${MAX_EVALUATION_COMMENT_LENGTH} characters`);
  }
  if (outcome && commentRequired(outcome) && comment === "") {
    problems.push(`A comment is required for ${CHECK_UP_OUTCOME_LABEL[outcome]}`);
  }
  return { evaluation: problems.length === 0 && outcome ? { outcome, comment } : null, problems };
}

/** The longest audit title or System name kept in a Change Event detail. */
export const EVALUATION_EVENT_NAME_LIMIT = 200;

function capped(text: string) {
  return text.length > EVALUATION_EVENT_NAME_LIMIT ? `${text.slice(0, EVALUATION_EVENT_NAME_LIMIT)}…` : text;
}

/**
 * The detail of the Change Event an evaluation writes: the audit, the Control, the target (the
 * System, or the Organization) and the outcome. Never the comment or the response, which are
 * free text the Recent updates feed has no business repeating.
 */
export function describeCheckUpEvaluation(evaluation: {
  outcome: CheckUpOutcome;
  auditTitle: string;
  controlCode: string;
  systemName: string | null;
}): string {
  const target = evaluation.systemName === null ? "the Organization" : `System "${capped(evaluation.systemName)}"`;
  return `Check-up evaluated as ${CHECK_UP_OUTCOME_LABEL[evaluation.outcome]}: Control ${evaluation.controlCode} for ${target} (Internal Audit "${capped(evaluation.auditTitle)}")`;
}

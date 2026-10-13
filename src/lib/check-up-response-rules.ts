import type { CheckUpAnswer, InternalAuditStatus, UserRole } from "@prisma/client";
import { canReadInternalAudits, INTERNAL_AUDIT_STATUS_LABEL } from "@/lib/internal-audit-rules";

/**
 * Who answers a Check-up, when it is open or overdue, what a response must contain and when it
 * can no longer be changed (PRD 0001 F-IA.4, F-IA.5, #155). Pure and Prisma-free, so the task
 * list, the pages, the write route and the form share one definition.
 *
 * Nothing here writes a Change Event or a status: submitting a response changes no Control
 * Assessment, no Organization Control Implementation and opens no Risk (F-CE.1 logs a Check-up
 * being *evaluated*, #156).
 */

export const CHECK_UP_ANSWERS: CheckUpAnswer[] = ["YES", "NO", "NA"];
export const CHECK_UP_ANSWER_LABEL: Record<CheckUpAnswer, string> = { YES: "Yes", NO: "No", NA: "N/A" };

export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_EVIDENCE_LINKS = 10;
export const MAX_EVIDENCE_LINK_LENGTH = 2000;

// ---------------------------------------------------------------------------------------------
// The recipient

/**
 * The recipient of a Check-up: whoever owns its target *now*. For a System-level Check-up the
 * System's owner, for an Organization-level one (no System) the Control's Control Owner, who may
 * be null: then nobody can answer it until one is assigned. Never stored, so a Check-up follows a
 * change of owner.
 */
export function checkUpRecipientId(checkUp: {
  system: { ownerId: string } | null;
  control: { ownerId: string | null };
}): string | null {
  return checkUp.system ? checkUp.system.ownerId : checkUp.control.ownerId;
}

/**
 * Roles that can never answer a Check-up, even as its recorded recipient: the Internal Auditor
 * would be answering its own audit (independence). Product-owner decision 14a of 2026-10-13 (comment on #155).
 */
export const ROLES_NEVER_ANSWERING_CHECK_UPS: UserRole[] = ["INTERNAL_AUDITOR"];

/**
 * Product-owner decisions 13a and 15a of 2026-10-13 (comment on #155).
 * May `user` answer a Check-up whose recipient is `recipientId`? Only the recipient, whatever
 * their role (an Admin who isn't the recipient may not answer on their behalf), except the
 * Internal Auditor. A Compliance Manager recorded as a System's owner may answer: an answer is an
 * account of how the Control works and changes no status, so it isn't a System write.
 */
export function canAnswerCheckUp(user: { id: string; role: UserRole }, recipientId: string | null): boolean {
  return recipientId !== null && user.id === recipientId && !ROLES_NEVER_ANSWERING_CHECK_UPS.includes(user.role);
}

/**
 * May `user` read a Check-up and its response? Its recipient (now: after a change of owner the
 * new recipient reads, and can change, an existing response) and the roles that read Internal
 * Audits. Everyone else is refused.
 */
export function canReadCheckUp(user: { id: string; role: UserRole }, recipientId: string | null): boolean {
  return canReadInternalAudits(user) || (recipientId !== null && user.id === recipientId);
}

// ---------------------------------------------------------------------------------------------
// Open, overdue, locked

/**
 * Is the Check-up open: the audit is launched and nothing has been answered yet? (#156 does not
 * change this: an evaluated Check-up is answered. #158's withdrawn Check-up joins the conditions.)
 * `Open` Check-ups are the ones in the recipient's "My tasks".
 */
export function isCheckUpOpen(checkUp: { auditStatus: InternalAuditStatus; answered: boolean }): boolean {
  return checkUp.auditStatus === "LAUNCHED" && !checkUp.answered;
}

/**
 * Is the Check-up overdue: open, and today (UTC) is after the audit's due date? Today equal to the
 * due date is not overdue. `dueDate` is the audit's calendar date (UTC midnight).
 */
export function isCheckUpOverdue(
  checkUp: { auditStatus: InternalAuditStatus; answered: boolean; dueDate: Date },
  now: Date = new Date(),
): boolean {
  if (!isCheckUpOpen(checkUp)) return false;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return todayUtc > checkUp.dueDate.getTime();
}

/**
 * Why a Check-up's response can't be created or changed, or null if it can: its audit isn't
 * launched (a closed audit is read-only, #158), or it has been evaluated (#156: the auditor judged
 * this response, so it is frozen; an evaluation is final, so it never unlocks).
 */
export function checkUpResponseRefusal(checkUp: { auditStatus: InternalAuditStatus; evaluated: boolean }): string | null {
  if (checkUp.evaluated) return "This Check-up has been evaluated, so its response can no longer be changed";
  if (checkUp.auditStatus === "LAUNCHED") return null;
  return `This Check-up can't be answered: its Internal Audit is ${INTERNAL_AUDIT_STATUS_LABEL[checkUp.auditStatus].toLowerCase()}`;
}

/**
 * Sent, answered, evaluated, awaiting-evaluation, open and overdue Check-ups of one audit, for its
 * page. "Answered" is every Check-up with a response, evaluated ones included; "evaluated" is the
 * subset the auditor has judged, and "awaiting evaluation" is answered minus evaluated.
 */
export type CheckUpProgress = {
  sent: number;
  answered: number;
  evaluated: number;
  awaitingEvaluation: number;
  open: number;
  overdue: number;
};

export function checkUpProgress(checkUps: { answered: boolean; evaluated: boolean; overdue: boolean }[]): CheckUpProgress {
  const answered = checkUps.filter((c) => c.answered).length;
  const evaluated = checkUps.filter((c) => c.answered && c.evaluated).length;
  return {
    sent: checkUps.length,
    answered,
    evaluated,
    awaitingEvaluation: answered - evaluated,
    open: checkUps.length - answered,
    overdue: checkUps.filter((c) => c.overdue).length,
  };
}

// ---------------------------------------------------------------------------------------------
// Evidence links

/**
 * The normalised absolute http(s) URL for `value`, or null if it is anything else (a relative
 * URL, `javascript:`, `data:`, `file:`, over-long or unparseable). Applied on write and again on
 * read before a stored value becomes an `href`.
 */
export function safeHttpUrl(value: string): string | null {
  const text = value.trim();
  if (text === "" || text.length > MAX_EVIDENCE_LINK_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return text;
}

/**
 * Trims `links`, drops blank entries and duplicates (first occurrence wins) and returns what
 * remains, plus a problem per entry that isn't an absolute http(s) URL and one if there are more
 * than `MAX_EVIDENCE_LINKS`. The stored text is the trimmed text the user wrote.
 */
export function normalizeEvidenceLinks(links: string[]): { links: string[]; problems: string[] } {
  const problems: string[] = [];
  const kept: string[] = [];
  for (const raw of links) {
    const text = raw.trim();
    if (text === "") continue;
    if (safeHttpUrl(text) === null) {
      problems.push(`"${text.length > 60 ? `${text.slice(0, 60)}...` : text}" is not an http(s) URL (at most ${MAX_EVIDENCE_LINK_LENGTH} characters)`);
      continue;
    }
    if (!kept.includes(text)) kept.push(text);
  }
  if (kept.length > MAX_EVIDENCE_LINKS) problems.push(`At most ${MAX_EVIDENCE_LINKS} evidence links`);
  return { links: kept, problems };
}

// ---------------------------------------------------------------------------------------------
// The submission

export type ResponseInput = {
  answers: { questionId: string; answer: string; description?: string }[];
  evidenceLinks?: string[];
};

export type ValidResponse = {
  answers: { questionId: string; answer: CheckUpAnswer; description: string }[];
  evidenceLinks: string[];
};

/** A No or N/A needs an explanation: an auditor can't evaluate a bare "No". A Yes may be bare. */
export function descriptionRequired(answer: CheckUpAnswer): boolean {
  return answer !== "YES";
}

/**
 * Validates a whole submission against the Check-up's questions (`questionIds`, in order): every
 * question has exactly one answer of Yes / No / N/A (and no answer is for a question the Check-up
 * doesn't have), a No or N/A has a description, a description is at most `MAX_DESCRIPTION_LENGTH`
 * characters, and the evidence links are absolute http(s) URLs. Returns the cleaned response
 * (answers in question order, text trimmed, links normalised and de-duplicated) and one message
 * per problem; the response is only usable when `problems` is empty.
 */
export function validateCheckUpResponse(
  input: ResponseInput,
  questions: { id: string; position: number }[],
): { response: ValidResponse; problems: string[] } {
  const problems: string[] = [];
  const byQuestion = new Map<string, ResponseInput["answers"][number]>();
  for (const given of input.answers) {
    if (!questions.some((q) => q.id === given.questionId)) {
      problems.push("An answer is for a question that is not part of this Check-up");
    } else if (byQuestion.has(given.questionId)) {
      problems.push("A question is answered more than once");
    } else {
      byQuestion.set(given.questionId, given);
    }
  }

  const answers: ValidResponse["answers"] = [];
  for (const question of [...questions].sort((a, b) => a.position - b.position)) {
    const given = byQuestion.get(question.id);
    const answer = CHECK_UP_ANSWERS.find((a) => a === given?.answer);
    if (!given || !answer) {
      problems.push(`Question ${question.position} needs an answer: Yes, No or N/A`);
      continue;
    }
    const description = (given.description ?? "").trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      problems.push(`The description of question ${question.position} can be at most ${MAX_DESCRIPTION_LENGTH} characters`);
    }
    if (descriptionRequired(answer) && description === "") {
      problems.push(`Question ${question.position}: a description is required for ${CHECK_UP_ANSWER_LABEL[answer]}`);
    }
    answers.push({ questionId: question.id, answer, description });
  }

  const links = normalizeEvidenceLinks(input.evidenceLinks ?? []);
  problems.push(...links.problems);
  return { response: { answers, evidenceLinks: links.links }, problems };
}

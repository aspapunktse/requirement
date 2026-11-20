import type { CheckUpOutcome, InternalAuditStatus } from "@prisma/client";
import { calendarDaysUntil } from "@/lib/internal-audit-rules";

/**
 * The state of one Check-up, and counts of states (the Internal Audits list, #398; the single-audit page
 * reuses it). Pure and Prisma-free. A Check-up's state is derived from what exists beside it, never stored:
 *
 * 1. **withdrawn** beats everything (a withdrawn Check-up keeps any response, but it no longer counts as answered);
 * 2. **evaluated**: an evaluation exists;
 * 3. **awaiting** evaluation: a response exists and no evaluation (answered, not yet judged);
 * 4. **overdue**: unanswered, not withdrawn, in a LAUNCHED audit whose due date has passed (the due date itself
 *    is not overdue; a draft and a closed audit have no overdue Check-up);
 * 5. otherwise **notAnswered** yet.
 *
 * A Check-up is **open** while it is neither evaluated nor withdrawn (answered or not): those are the ones that
 * stop an audit being closed (`isUnfinishedCheckUp` in `internal-audit-close-rules.ts` says the same).
 */

export type CheckUpStateKey = "evaluated" | "withdrawn" | "awaiting" | "overdue" | "notAnswered";

/** The display order of the states: the order of a progress bar and the ring's segments. */
export const CHECK_UP_STATE_ORDER: CheckUpStateKey[] = ["evaluated", "withdrawn", "awaiting", "overdue", "notAnswered"];

export const CHECK_UP_STATE_LABEL: Record<CheckUpStateKey, string> = {
  evaluated: "Evaluated",
  withdrawn: "Withdrawn",
  awaiting: "Awaiting evaluation",
  overdue: "Overdue",
  notAnswered: "Not answered yet",
};

/** What the state of a Check-up is derived from. */
export type CheckUpFacts = { answered: boolean; evaluated: boolean; withdrawn: boolean };

/** The audit side of the rule: its status and due date ("YYYY-MM-DD" or a Date at UTC midnight). */
export type CheckUpAuditFacts = { status: InternalAuditStatus; dueDate: string | Date };

export function checkUpState(checkUp: CheckUpFacts, audit: CheckUpAuditFacts, now: Date = new Date()): CheckUpStateKey {
  if (checkUp.withdrawn) return "withdrawn";
  if (checkUp.evaluated) return "evaluated";
  if (checkUp.answered) return "awaiting";
  const daysLeft = calendarDaysUntil(audit.dueDate, now);
  if (audit.status === "LAUNCHED" && daysLeft !== null && daysLeft < 0) return "overdue";
  return "notAnswered";
}

/** Open: neither evaluated nor withdrawn. */
export function isOpenCheckUpState(state: CheckUpStateKey): boolean {
  return state !== "evaluated" && state !== "withdrawn";
}

/** Counts of Check-ups per state; `open` is every Check-up that is neither evaluated nor withdrawn. */
export type CheckUpStateCounts = Record<CheckUpStateKey, number> & { total: number; open: number };

export function emptyCheckUpStateCounts(): CheckUpStateCounts {
  return { evaluated: 0, withdrawn: 0, awaiting: 0, overdue: 0, notAnswered: 0, total: 0, open: 0 };
}

export function addCheckUpState(counts: CheckUpStateCounts, state: CheckUpStateKey): void {
  counts[state] += 1;
  counts.total += 1;
  if (isOpenCheckUpState(state)) counts.open += 1;
}

export function countCheckUpStates(states: Iterable<CheckUpStateKey>): CheckUpStateCounts {
  const counts = emptyCheckUpStateCounts();
  for (const state of states) addCheckUpState(counts, state);
  return counts;
}

/** The sum of several audits' counts (the ring across every launched audit). */
export function sumCheckUpStateCounts(all: Iterable<CheckUpStateCounts>): CheckUpStateCounts {
  const sum = emptyCheckUpStateCounts();
  for (const counts of all) for (const key of [...CHECK_UP_STATE_ORDER, "total", "open"] as const) sum[key] += counts[key];
  return sum;
}

/** A launched audit can be closed when no Check-up is open (`closeInternalAudit` enforces it again). */
export function isReadyToClose(counts: Pick<CheckUpStateCounts, "open">): boolean {
  return counts.open === 0;
}

/** The evaluated Check-ups of a closed audit by outcome, plus the Risks Nonconformities opened. */
export type CheckUpFindings = Record<CheckUpOutcome, number> & { risksOpened: number };

export function emptyCheckUpFindings(): CheckUpFindings {
  return { CONFORMING: 0, OBSERVATION: 0, NONCONFORMITY: 0, risksOpened: 0 };
}

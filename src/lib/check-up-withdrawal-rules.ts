import type { InternalAuditStatus, UserRole } from "@prisma/client";
import { canWriteInternalAudits, INTERNAL_AUDIT_STATUS_LABEL } from "@/lib/internal-audit-rules";

/**
 * Who withdraws a Check-up, when, and what a withdrawal must contain (PRD 0001 F-IA.8, #158). Pure
 * and Prisma-free, so the route, the page, the form and the unit matrix share one definition.
 *
 * Product-owner defaults of #158, each kept in one place so a change is small: a withdrawal writes
 * no Change Event (F-CE.1 lists only "Check-up evaluated"); it is final, there is no un-withdraw;
 * any Internal Auditor may withdraw any Check-up (decision 7a on #152).
 */

export const MAX_WITHDRAWAL_REASON_LENGTH = 2000;

/** May `user` withdraw Check-ups? Only an Internal Auditor: the same allow-list as writing Internal Audits. */
export function canWithdrawCheckUps(user: { role: UserRole }): boolean {
  return canWriteInternalAudits(user);
}

/**
 * Why a Check-up can't be withdrawn (now), or null if it can. All of them are 409, checked in this
 * order: it is withdrawn already (a withdrawal is final), it has been evaluated (a judged Check-up
 * is part of the finished record; only one that is not evaluated can be withdrawn, answered or not)
 * or its audit isn't launched (a draft has no Check-ups; a closed audit is read-only).
 */
export function checkUpWithdrawalRefusal(checkUp: {
  auditStatus: InternalAuditStatus;
  evaluated: boolean;
  withdrawn: boolean;
}): string | null {
  if (checkUp.withdrawn) return "This Check-up has been withdrawn already; a withdrawal is final";
  if (checkUp.evaluated) return "This Check-up has been evaluated, so it can't be withdrawn";
  if (checkUp.auditStatus !== "LAUNCHED") {
    return `This Check-up can't be withdrawn: its Internal Audit is ${INTERNAL_AUDIT_STATUS_LABEL[checkUp.auditStatus].toLowerCase()}`;
  }
  return null;
}

export type WithdrawalInput = { reason?: string };

/**
 * Validates a withdrawal: the reason (trimmed) is required and at most `MAX_WITHDRAWAL_REASON_LENGTH`
 * characters. Returns the cleaned reason, usable only when `problems` is empty.
 */
export function validateWithdrawal(input: WithdrawalInput): { reason: string | null; problems: string[] } {
  const reason = (input.reason ?? "").trim();
  const problems: string[] = [];
  if (reason === "") problems.push("A reason is required to withdraw a Check-up");
  if (reason.length > MAX_WITHDRAWAL_REASON_LENGTH) {
    problems.push(`The reason can be at most ${MAX_WITHDRAWAL_REASON_LENGTH} characters`);
  }
  return { reason: problems.length === 0 ? reason : null, problems };
}

import type { InternalAuditStatus, UserRole } from "@prisma/client";
import { canWriteInternalAudits, INTERNAL_AUDIT_STATUS_LABEL } from "@/lib/internal-audit-rules";

/**
 * Who closes an Internal Audit, when it can be closed, and what a closed audit means (PRD 0001
 * F-IA.8, #158). Pure and Prisma-free, so the route, the audit page and the unit matrix share one
 * definition.
 *
 * Product-owner defaults of #158, each kept in one place so a change is small: closing writes no
 * Change Event; only a LAUNCHED audit can be closed (a draft is deleted instead); any Internal
 * Auditor may close any audit (decision 7a on #152). A closed audit and its Check-ups, responses,
 * evaluations and withdrawals are read-only for every role, the Internal Auditor included: each
 * write refuses a status other than the one it needs (DRAFT for editing and launching, LAUNCHED for
 * answering, evaluating, withdrawing and closing). A Risk a Nonconformity opened stays an ordinary
 * Risk after the audit closes: its Risk Owner keeps managing it.
 */

/** May `user` close Internal Audits? Only an Internal Auditor: the same allow-list as writing Internal Audits. */
export function canCloseInternalAudits(user: { role: UserRole }): boolean {
  return canWriteInternalAudits(user);
}

/** Why an Internal Audit in `status` can't be closed (whatever its Check-ups), or null if it can. */
export function internalAuditCloseRefusal(status: InternalAuditStatus): string | null {
  if (status === "LAUNCHED") return null;
  if (status === "DRAFT") return "A draft Internal Audit can't be closed: it has no Check-ups. Delete it instead";
  return `This Internal Audit can't be closed: it is ${INTERNAL_AUDIT_STATUS_LABEL[status].toLowerCase()} already`;
}

/** The part of a Check-up the close rule needs. */
export type CloseCheckUp = {
  id: string;
  controlCode: string;
  /** The target System's name, or null for the Organization-level Check-up. */
  systemName: string | null;
  evaluated: boolean;
  withdrawn: boolean;
};

/** A Check-up that blocks closing: neither evaluated nor withdrawn, answered or not. */
export function isUnfinishedCheckUp(checkUp: { evaluated: boolean; withdrawn: boolean }): boolean {
  return !checkUp.evaluated && !checkUp.withdrawn;
}

/** "A.5.1 for System "Payroll"" or "A.5.1 for the Organization": how a Check-up is named to the auditor. */
export function describeUnfinishedCheckUp(checkUp: { controlCode: string; systemName: string | null }): string {
  return `${checkUp.controlCode} for ${checkUp.systemName === null ? "the Organization" : `System "${checkUp.systemName}"`}`;
}

const codeCollator = new Intl.Collator("en", { numeric: true });

/** The Check-ups that block closing, by Control code then target (Systems by name, the Organization last). */
export function unfinishedCheckUps<T extends CloseCheckUp>(checkUps: T[]): T[] {
  return checkUps
    .filter(isUnfinishedCheckUp)
    .sort(
      (a, b) =>
        codeCollator.compare(a.controlCode, b.controlCode) ||
        Number(a.systemName === null) - Number(b.systemName === null) ||
        (a.systemName ?? "").localeCompare(b.systemName ?? "", "en"),
    );
}

/** The refusal's one-line summary; the Check-ups themselves are listed one by one beside it. */
export function closeBlockedMessage(unfinishedCount: number): string {
  return `This Internal Audit can't be closed yet: ${unfinishedCount} ${unfinishedCount === 1 ? "Check-up is" : "Check-ups are"} neither evaluated nor withdrawn`;
}

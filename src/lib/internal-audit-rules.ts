import type { ControlApplicability, InternalAuditStatus, UserRole } from "@prisma/client";
import { hasOrganizationImplementation } from "@/lib/organization-implementation-rules";

/**
 * Who may do what with an Internal Audit, and what a draft must contain (PRD 0001
 * F-IA.1, #152). Pure and Prisma-free so the routes, the pages, the form and the unit
 * matrix share one definition. Nothing here writes a Change Event: drafting an audit
 * is not a compliance-relevant change (F-CE.1 logs a Check-up being evaluated).
 */

/**
 * Roles that create, edit and delete an Internal Audit. Only the Internal Auditor:
 * an Admin or Compliance Manager would be auditing their own work (ISO 27001 clause
 * 9.2), so they are refused too. Product-owner decision of 2026-10-13 (comment on
 * #152): any Internal Auditor may edit or delete any draft, not only its creator.
 */
export const ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS: UserRole[] = ["INTERNAL_AUDITOR"];

/**
 * Roles that may read the list and an audit. Product-owner decision of 2026-10-13
 * (comment on #152): the Internal Auditor, Admin, Compliance Manager and Risk Owner.
 * A System Owner meets an audit only through the Check-ups sent to them (#155), so
 * sees nothing here yet.
 */
export const ROLES_ALLOWED_TO_READ_INTERNAL_AUDITS: UserRole[] = [
  ...ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS,
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "RISK_OWNER",
];

export function canWriteInternalAudits(user: { role: UserRole }) {
  return ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS.includes(user.role);
}

export function canReadInternalAudits(user: { role: UserRole }) {
  return ROLES_ALLOWED_TO_READ_INTERNAL_AUDITS.includes(user.role);
}

export const INTERNAL_AUDIT_STATUS_LABEL: Record<InternalAuditStatus, string> = {
  DRAFT: "Draft",
  LAUNCHED: "Launched",
  CLOSED: "Closed",
};

/**
 * Why an Internal Audit in `status` can't be edited or deleted, or null if it can.
 * Only a draft can; launching (#154) freezes the audit, and closing (#158) ends it.
 * Any state other than DRAFT is refused, so those issues have nothing to add here.
 */
export function internalAuditEditRefusal(status: InternalAuditStatus): string | null {
  if (status === "DRAFT") return null;
  return `An Internal Audit can only be edited or deleted while it is a draft (this one is ${INTERNAL_AUDIT_STATUS_LABEL[status].toLowerCase()})`;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" to a UTC-midnight Date, or null if it isn't a real calendar date. */
export function parseCalendarDate(value: string): Date | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

/** A due date as the "YYYY-MM-DD" the API and the form use. */
export function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Why `dueDate` ("YYYY-MM-DD") isn't acceptable as an audit's due date, or null if it is:
 * not a real date, or before today (UTC; today itself is fine). Product-owner decision of
 * 2026-10-13 (comment on #152): refused when an audit is created and when its due date is
 * changed. Reusable by launch (#154).
 */
export function dueDateRefusal(dueDate: string, now: Date = new Date()): string | null {
  const parsed = parseCalendarDate(dueDate);
  if (!parsed) return "The due date must be a valid date (YYYY-MM-DD)";
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return parsed.getTime() < todayUtc ? "The due date can't be in the past" : null;
}

export type InternalAuditDraft = {
  title: string;
  controlIds: string[];
  systemIds: string[];
  includeOrganization: boolean;
  dueDate: string | null;
};

/**
 * What an Internal Audit still lacks, one message per missing thing (empty when valid): a
 * non-blank title, at least one target Control, a due date, and at least one System or the
 * Organization. Enforced on create and on every edit; the form runs the same function.
 * Whether the date is in the past is `dueDateRefusal`'s, since it applies only to a new
 * or changed date.
 */
export function validateInternalAudit(audit: InternalAuditDraft): string[] {
  const problems: string[] = [];
  if (audit.title.trim() === "") problems.push("A title is required");
  if (audit.controlIds.length === 0) problems.push("Pick at least one Control");
  if (!audit.dueDate) problems.push("A due date is required");
  if (audit.systemIds.length === 0 && !audit.includeOrganization) {
    problems.push("Pick at least one System or include the Organization");
  }
  return problems;
}

/**
 * Non-blocking notes on a draft that would generate nothing for one of its halves. They don't
 * stop the draft (launch, #154, deals with what generates nothing); the audit page shows them.
 */
export function internalAuditNotes(audit: {
  includeOrganization: boolean;
  systemCount: number;
  controls: { applicability: ControlApplicability }[];
}): string[] {
  const notes: string[] = [];
  if (audit.includeOrganization && !audit.controls.some((c) => hasOrganizationImplementation(c.applicability))) {
    notes.push(
      "The Organization is included, but none of the target Controls is Organizational or Both, so no Organization Control Implementation would be audited.",
    );
  }
  if (audit.systemCount > 0 && !audit.controls.some((c) => c.applicability !== "ORGANIZATIONAL")) {
    notes.push("Systems are picked, but none of the target Controls is Per-System or Both, so no System would be audited.");
  }
  return notes;
}

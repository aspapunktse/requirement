import type { UserRole } from "@prisma/client";

/**
 * Who may do what with Risks, as plain role lists. Free of Prisma and other server code, so client
 * components (the app header's navigation) share the one definition with the pages and routes.
 * `risks.ts` re-exports these.
 */

/**
 * The deep link to one Risk on its System's page (#360): `#risk-<id>` opens the Risks tab with that Risk's row expanded.
 * The Risk register and the Home task row use it.
 */
export function systemRiskHref(systemId: string, riskId: string) {
  return `/systems/${systemId}#risk-${riskId}`;
}

/** What an Organization Risk's "System" reads as wherever a System's name would be. */
export const ORGANIZATION_RISK_LABEL = "Organization";

/** Where a Risk Owner follows an Organization Risk. */
export const ORGANIZATION_RISKS_HREF = "/risks/organization";

/** Only these roles may change a Risk's status, regardless of who logged it. Not the Risk Facilitator (#362). */
export const ROLES_ALLOWED_TO_MANAGE_RISK_STATUS: UserRole[] = ["ADMIN", "RISK_OWNER"];

/**
 * Who may set, change or clear a Risk's owner, in a Risk Analysis and on an opened System Risk (#360, product-owner decision of
 * 2026-11-11): an Admin, a Risk Owner or a Risk Facilitator (#362). The System's owner and the Business System Owner may not, unless
 * they also hold one of these roles. Separate from the status list so the Risk Facilitator gets the owner right and nothing more.
 */
export const ROLES_ALLOWED_TO_ASSIGN_RISK_OWNER: UserRole[] = ["ADMIN", "RISK_OWNER", "RISK_FACILITATOR"];

/** Who may record, edit and complete a Risk Analysis on a System they don't own (#325, #362). */
export const ROLES_ALLOWED_TO_RECORD_RISK_ANALYSIS: UserRole[] = ["ADMIN", "RISK_OWNER", "RISK_FACILITATOR"];

/**
 * May `user` set, change or clear the owner of a Risk on `system`? A Risk Facilitator never does on a System they own (the rule
 * for recording a Risk Analysis); an Admin or a Risk Owner may, as they may change the Risk's status there.
 */
export function canAssignRiskOwner(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  if (!ROLES_ALLOWED_TO_ASSIGN_RISK_OWNER.includes(user.role)) return false;
  return user.role !== "RISK_FACILITATOR" || user.id !== system.ownerId;
}

/**
 * Risks opened by an Organization-level Nonconformity have no System (#157, product-owner decision of
 * 2026-10-12): they are read and managed by the Risk Owner and the Admin, and read by the Internal
 * Auditor. Nobody else sees them, and the Business Risk Owner's scoped views never list them
 * (`SYSTEM_RISK_WHERE` in `risks.ts`). Confirmed by decisions 24a and 25a of 2026-10-13 (comment on #157): exactly
 * these three roles, on `/risks/organization`. The Compliance Manager's read-only role doesn't extend to them.
 */
export const ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS: UserRole[] = [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, "INTERNAL_AUDITOR"];

export function canReadOrganizationRisks(user: { role: UserRole }) {
  return ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS.includes(user.role);
}

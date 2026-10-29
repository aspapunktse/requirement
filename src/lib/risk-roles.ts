import type { UserRole } from "@prisma/client";

/**
 * Who may do what with Risks, as plain role lists. Free of Prisma and other server code, so client
 * components (the app header's navigation) share the one definition with the pages and routes.
 * `risks.ts` re-exports these.
 */

/** Only these roles may change a Risk's status, regardless of who logged it. */
export const ROLES_ALLOWED_TO_MANAGE_RISK_STATUS: UserRole[] = ["ADMIN", "RISK_OWNER"];

/**
 * Risks opened by an Organization-level Nonconformity have no System (#157, product-owner decision of
 * 2026-10-12): they are read and managed by the Risk Owner and the Admin, and read by the Internal
 * Auditor. Nobody else sees them, and the Business Risk Owner's scoped views never list them
 * (`SYSTEM_RISK_WHERE` below). Confirmed by decisions 24a and 25a of 2026-10-13 (comment on #157): exactly
 * these three roles, on `/risks/organization`. The Compliance Manager's read-only role doesn't extend to them.
 */
export const ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS: UserRole[] = [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, "INTERNAL_AUDITOR"];

export function canReadOrganizationRisks(user: { role: UserRole }) {
  return ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS.includes(user.role);
}

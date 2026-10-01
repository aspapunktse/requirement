import type { ControlApplicability, ControlAssessmentStatus, UserRole } from "@prisma/client";

/**
 * Who may edit an Organization Control Implementation, and what an edit must
 * contain (PRD 0001 F-IN.1, #120). Pure and Prisma-free, so the routes, the
 * pages and the unit matrix share one definition. The data side (reading,
 * creating, the missing-row rule) is in `organization-implementation.ts`.
 */

type Actor = { id: string; role: UserRole };

/** Applicabilities whose Controls the Organization implements: every Organizational and Both Control, never Per-System. */
export const ORGANIZATION_IMPLEMENTED_APPLICABILITIES: ControlApplicability[] = ["ORGANIZATIONAL", "BOTH"];

/** Does a Control with this applicability have an Organization Control Implementation? */
export function hasOrganizationImplementation(applicability: ControlApplicability) {
  return ORGANIZATION_IMPLEMENTED_APPLICABILITIES.includes(applicability);
}

/** Roles that may edit any Control's implementation, whoever its Control Owner is. */
export const ROLES_ALLOWED_TO_EDIT_ANY_ORGANIZATION_IMPLEMENTATION: UserRole[] = ["COMPLIANCE_MANAGER", "ADMIN"];

/**
 * May `user` edit the Organization Control Implementation of `control`: its
 * Control Owner (`ownerId` alone, whatever their role, a Viewer included), a
 * Compliance Manager or an Admin. Anyone not named is refused, including roles
 * added in future (allow-list, not deny-list).
 */
export function canEditOrganizationImplementation(user: Actor, control: { ownerId: string | null }) {
  if (ROLES_ALLOWED_TO_EDIT_ANY_ORGANIZATION_IMPLEMENTATION.includes(user.role)) return true;
  return control.ownerId !== null && control.ownerId === user.id;
}

/**
 * The statuses that need a reason on record, i.e. a non-empty description.
 * Setting an implementation to Waived or Not Applicable takes the Control out of
 * what the Organization has to satisfy, so someone has to say why. One place to
 * change if the product owner decides otherwise (open question on #120).
 */
export const IMPLEMENTATION_STATUSES_REQUIRING_DESCRIPTION: ControlAssessmentStatus[] = ["WAIVED", "NOT_APPLICABLE"];

/**
 * Why an implementation with this status and description (the values it would
 * have after the edit) is refused, or null if it is fine. Applies to the
 * resulting values, so clearing the description of a Waived implementation is
 * refused too.
 */
export function implementationDescriptionRefusal(
  status: ControlAssessmentStatus,
  description: string | null | undefined,
): string | null {
  if (IMPLEMENTATION_STATUSES_REQUIRING_DESCRIPTION.includes(status) && !description?.trim()) {
    return "A description is required to set the status to Waived or Not Applicable";
  }
  return null;
}

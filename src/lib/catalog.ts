import type { UserRole } from "@prisma/client";

/** Who may create, edit, or retire entries in the catalogs Admin owns
 * (Deployment Facets, Business Units)
 * and assign a Business Risk Owner's portfolio: ADMIN only. */
export const ROLES_ALLOWED_TO_MANAGE_CATALOG: UserRole[] = ["ADMIN"];

/** Who may curate the requirement database — the Control Library
 * (Controls and their scoping) and the Framework catalog: the
 * COMPLIANCE_MANAGER, plus ADMIN as a superuser. See #71. */
export const ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

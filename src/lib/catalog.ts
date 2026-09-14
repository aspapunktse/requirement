import type { UserRole } from "@prisma/client";

/** Who may create, edit, or retire entries in the Requirement Catalog
 * (Requirements, Deployment Facets, Capabilities, Regulatory Overlays, and
 * their mappings): ADMIN only. */
export const ROLES_ALLOWED_TO_MANAGE_CATALOG: UserRole[] = ["ADMIN"];

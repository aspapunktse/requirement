import type { UserRole } from "@prisma/client";
import { READ_ONLY_SYSTEM_ROLES, ROLES_ALLOWED_TO_CREATE_SYSTEM } from "@/lib/system-permissions";

/** Admin -> Users (#364): the parts the page and the server share. No server imports, so a client component can use them. */

export const ALL_ROLES: UserRole[] = [
  "ADMIN",
  "RISK_OWNER",
  "SYSTEM_OWNER",
  "REVIEWER",
  "VIEWER",
  "BUSINESS_RISK_OWNER",
  "COMPLIANCE_MANAGER",
  "INTERNAL_AUDITOR",
  "RISK_FACILITATOR",
];

/** Dispatched on `window` after Admin -> Users saves a User, so the header's acting-user switcher refetches. */
export const USERS_CHANGED_EVENT = "users-changed";

export type AdminUser = { id: string; name: string; email: string; role: UserRole; createdAt: string };

export const roleName = (role: UserRole) =>
  role
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");

export type UserHoldings = {
  ownedSystems: number;
  businessOwnedSystems: number;
  businessUnitScopes: number;
  frameworkScopes: number;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The warning shown before saving a role change: what the User keeps that the new role doesn't use. Nothing is
 * cleared or moved (decision 1a). Empty when there is nothing to say.
 */
export function describeHoldings(holdings: UserHoldings, newRole: UserRole): string[] {
  const lines: string[] = [];
  // Ownership is `ownerId` alone, whatever the role (isSystemOwnerOrAdmin), except the read-only System roles, which can't act as owner.
  // The System-creating roles only matter when someone is newly assigned as owner (canBeSystemOwner).
  if (holdings.ownedSystems > 0 && newRole !== "ADMIN") {
    const systems = plural(holdings.ownedSystems, "System");
    const noNewOwnership = ROLES_ALLOWED_TO_CREATE_SYSTEM.includes(newRole) ? "" : " Can't be chosen as the new owner of other Systems.";
    lines.push(
      READ_ONLY_SYSTEM_ROLES.includes(newRole)
        ? `Stays the recorded owner of ${systems} but can no longer act on them as owner; an Admin can hand them over.${noNewOwnership}`
        : `Keeps owner rights on ${systems} (can still edit and submit them).${noNewOwnership}`,
    );
  }
  if (holdings.businessOwnedSystems > 0 && newRole !== "ADMIN") {
    lines.push(`Still the Business System Owner of ${plural(holdings.businessOwnedSystems, "System")}; that assignment stays.`);
  }
  if (newRole !== "BUSINESS_RISK_OWNER" && (holdings.businessUnitScopes > 0 || holdings.frameworkScopes > 0)) {
    const scopes = [
      ...(holdings.businessUnitScopes > 0 ? [plural(holdings.businessUnitScopes, "Business Unit")] : []),
      ...(holdings.frameworkScopes > 0 ? [plural(holdings.frameworkScopes, "Framework")] : []),
    ].join(" and ");
    lines.push(`Still assigned ${scopes} as a Business Risk Owner; the scope stays but stops applying.`);
  }
  return lines;
}

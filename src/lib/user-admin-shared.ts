import type { UserRole } from "@prisma/client";

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
  // A System's owner must have a System-creating role (system-permissions.ts); other roles keep the Systems but can't act on them as owner.
  const canOwn = newRole === "ADMIN" || newRole === "SYSTEM_OWNER" || newRole === "RISK_OWNER";
  if (!canOwn && holdings.ownedSystems > 0) {
    lines.push(`Still the owner of ${plural(holdings.ownedSystems, "System")}; the role can't create or own Systems, so they stay with this User until an Admin hands them over.`);
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

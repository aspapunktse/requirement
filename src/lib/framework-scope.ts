import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/**
 * Who may declare or undeclare a System's Framework Scope — which
 * Framework's audit/certification boundary it falls within (e.g. "in ISO
 * scope"): ADMIN, or the System's owner (`ownerId`, whatever their role) — at any point in the
 * System's lifecycle. Same reporting-only, not-Draft-locked rule as
 * Business Unit (canManageBusinessUnits) — declaring a Framework Scope has
 * no effect on the applicable Control set. See #55.
 */
export function canManageFrameworkScopes(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  return isSystemOwnerOrAdmin(user, system);
}

export function getSystemFrameworkScopes(systemId: string) {
  return prisma.framework.findMany({
    where: { scopedSystems: { some: { id: systemId } } },
    orderBy: { name: "asc" },
  });
}

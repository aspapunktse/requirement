import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Who may declare or undeclare a System's Framework Scope — which
 * Framework's audit/certification boundary it falls within (e.g. "in ISO
 * scope"): ADMIN, or the owning SYSTEM_OWNER — at any point in the
 * System's lifecycle. Same reporting-only, not-Draft-locked rule as
 * Business Unit (canManageBusinessUnits) — declaring a Framework Scope has
 * no effect on the applicable Requirement set. See #55.
 */
export function canManageFrameworkScopes(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  if (user.role === "ADMIN") return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

export function getSystemFrameworkScopes(systemId: string) {
  return prisma.framework.findMany({
    where: { scopedSystems: { some: { id: systemId } } },
    orderBy: { name: "asc" },
  });
}

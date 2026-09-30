import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/**
 * Who may declare or undeclare a Business Unit on a System: ADMIN, or the
 * System's owner (`ownerId`, whatever their role) — at any point in the System's lifecycle, not just
 * Draft. Unlike Deployment Facet/Impact Level/
 * Capability/Framework Scope, Business Unit is purely a reporting dimension (no effect on
 * the applicable Control set), so there's no reason to lock it to
 * Draft — a new Business Unit can start consuming an already-Onboarded
 * System. See #55.
 */
export function canManageBusinessUnits(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  return isSystemOwnerOrAdmin(user, system);
}

export function getSystemBusinessUnits(systemId: string) {
  return prisma.businessUnit.findMany({
    where: { systems: { some: { id: systemId } } },
    orderBy: { name: "asc" },
  });
}

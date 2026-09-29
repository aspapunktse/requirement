import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Who may declare or undeclare a Business Unit on a System: ADMIN, or the
 * owning SYSTEM_OWNER — at any point in the System's lifecycle, not just
 * Draft. Unlike Deployment Facet/Regulatory Overlay/Impact Level/
 * Capability, Business Unit is purely a reporting dimension (no effect on
 * the applicable Control set), so there's no reason to lock it to
 * Draft — a new Business Unit can start consuming an already-Onboarded
 * System. See #55.
 */
export function canManageBusinessUnits(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  if (user.role === "ADMIN") return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

export function getSystemBusinessUnits(systemId: string) {
  return prisma.businessUnit.findMany({
    where: { systems: { some: { id: systemId } } },
    orderBy: { name: "asc" },
  });
}

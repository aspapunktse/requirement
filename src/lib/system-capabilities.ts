import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/**
 * Who may declare or undeclare a Capability on a System: ADMIN, or the
 * System's owner (`ownerId`, whatever their role) — and only while the System is still Draft.
 */
export function canManageCapabilities(
  user: { id: string; role: UserRole },
  system: { ownerId: string; status: string },
) {
  if (system.status !== "DRAFT") return false;
  return isSystemOwnerOrAdmin(user, system);
}

export function getSystemCapabilities(systemId: string) {
  return prisma.capability.findMany({
    where: { systems: { some: { id: systemId } } },
    orderBy: { name: "asc" },
  });
}

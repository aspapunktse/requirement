import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Who may declare or undeclare a Capability on a System: ADMIN, or the
 * owning SYSTEM_OWNER — and only while the System is still Draft.
 */
export function canManageCapabilities(
  user: { id: string; role: UserRole },
  system: { ownerId: string; status: string },
) {
  if (system.status !== "DRAFT") return false;
  if (user.role === "ADMIN") return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

export function getSystemCapabilities(systemId: string) {
  return prisma.capability.findMany({
    where: { systems: { some: { id: systemId } } },
    orderBy: { name: "asc" },
  });
}

import type { UserRole } from "@prisma/client";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/** Who may mark an Approved System Onboarded: ADMIN, or the System's owner (whatever their role). */
export function canMarkOnboarded(
  user: { id: string; role: UserRole },
  system: { ownerId: string },
) {
  return isSystemOwnerOrAdmin(user, system);
}

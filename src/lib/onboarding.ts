import type { UserRole } from "@prisma/client";

/** Who may mark an Approved System Onboarded: ADMIN, or the owning SYSTEM_OWNER. */
export function canMarkOnboarded(
  user: { id: string; role: UserRole },
  system: { ownerId: string },
) {
  if (user.role === "ADMIN") return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

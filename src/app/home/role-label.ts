import type { UserRole } from "@prisma/client";

/** "SYSTEM_OWNER" -> "System Owner". */
export function roleLabel(role: UserRole): string {
  return role
    .split("_")
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(" ");
}

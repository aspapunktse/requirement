import type { UserRole } from "@prisma/client";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

type ActingUser = { role: UserRole } | null | undefined;

/**
 * Throws a ForbiddenError unless the acting user's role is one of `allowed`.
 */
export function requireRole(user: ActingUser, allowed: UserRole[]): void {
  if (!user) {
    throw new ForbiddenError("Not authenticated");
  }
  if (!allowed.includes(user.role)) {
    throw new ForbiddenError(`Requires role: ${allowed.join(", ")}`);
  }
}

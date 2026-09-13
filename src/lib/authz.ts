import type { UserRole } from "@prisma/client";

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The minimum shape any acting user carries: at least an id and a role. */
export type ActingUser = { id: string; role: UserRole } | null | undefined;

/**
 * Throws a ForbiddenError unless the acting user's role is one of `allowed`.
 */
export function requireRole(
  user: ActingUser,
  allowed: UserRole[],
): asserts user is { id: string; role: UserRole } {
  requireAuthenticated(user);
  if (!allowed.includes(user.role)) {
    throw new ForbiddenError(`Requires role: ${allowed.join(", ")}`);
  }
}

/**
 * Throws a ForbiddenError unless there is an acting user, regardless of role.
 */
export function requireAuthenticated(
  user: ActingUser,
): asserts user is { id: string; role: UserRole } {
  if (!user) {
    throw new ForbiddenError("Not authenticated");
  }
}

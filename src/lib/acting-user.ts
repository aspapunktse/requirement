import { cookies } from "next/headers";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const ACTING_USER_COOKIE = "acting-user-id";

/** The subset of a User's fields safe to expose for picking who to act as. */
export type PublicUser = { id: string; name: string; email: string; role: UserRole };

/**
 * The dev-only "acting as" mechanism (this route, the switcher, and the
 * seeded-user list) is disabled outside development so it can never become
 * the de facto production auth once real SSO/OIDC ships. `ALLOW_DEV_AUTH_STUB`
 * is a narrow, explicit escape hatch for a demo/staging deployment that
 * still builds with NODE_ENV=production (e.g. Vercel) but has no real auth
 * yet either — set it only on environments where that's a deliberate
 * choice, never on a real customer-facing production.
 */
export function isDevAuthStubEnabled() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_DEV_AUTH_STUB === "true";
}

export function resolveActingUser(userId: string | undefined) {
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

/**
 * The dev-only "acting as" user for the current session, read from a cookie.
 * Returns null when no user has been selected yet, or the cookie no longer
 * matches a seeded User.
 */
export async function getActingUser() {
  const store = await cookies();
  return resolveActingUser(store.get(ACTING_USER_COOKIE)?.value);
}

import type { NextRequest, NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import type { UserRole } from "@prisma/client";
import { ACTING_USER_COOKIE, resolveActingUser } from "@/lib/acting-user";
import { ActingUser, ForbiddenError, requireAuthenticated, requireRole } from "@/lib/authz";

type AuthResult = { user: NonNullable<ActingUser> } | { response: NextResponse };

function actingUserFromRequest(request: NextRequest) {
  return resolveActingUser(request.cookies.get(ACTING_USER_COOKIE)?.value);
}

function forbiddenResponse(user: ActingUser, error: ForbiddenError): NextResponse {
  return Res.json({ error: error.message }, { status: user ? 403 : 401 });
}

/** Resolves the acting user, requiring only that one exists (any role). */
export async function authenticate(request: NextRequest): Promise<AuthResult> {
  const user = await actingUserFromRequest(request);
  try {
    requireAuthenticated(user);
  } catch (error) {
    if (error instanceof ForbiddenError) return { response: forbiddenResponse(user, error) };
    throw error;
  }
  return { user };
}

/** Resolves the acting user, requiring their role to be one of `allowed`. */
export async function authorize(request: NextRequest, allowed: UserRole[]): Promise<AuthResult> {
  const user = await actingUserFromRequest(request);
  try {
    requireRole(user, allowed);
  } catch (error) {
    if (error instanceof ForbiddenError) return { response: forbiddenResponse(user, error) };
    throw error;
  }
  return { user };
}

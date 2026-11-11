import { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isDevAuthStubEnabled, type PublicUser } from "@/lib/acting-user";
import { authenticate, authorize } from "@/lib/api-authz";
import { createUser, createUserSchema } from "@/lib/user-admin";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";

/**
 * Two callers: the dev-only role switcher (unauthenticated, every user,
 * disabled outside development — see isDevAuthStubEnabled), and a signed-in
 * User who manages Users or the Control Library looking Users up: an ADMIN
 * (e.g. assigning a BUSINESS_RISK_OWNER's Business Unit/Framework scope —
 * see #55) or a role allowed to manage the Requirement Database, i.e. a
 * COMPLIANCE_MANAGER populating the Control Owner picker (#119). Optionally
 * filtered by role; works regardless of the dev stub since it's a real
 * authenticated request. Same PublicUser shape for all of them.
 */
export async function GET(request: NextRequest) {
  const roleFilter = new URL(request.url).searchParams.get("role") as UserRole | null;

  const auth = await authenticate(request);
  // ADMIN is one of these roles, so this still covers what an Admin could always do.
  if (!("response" in auth) && ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE.includes(auth.user.role)) {
    const users: PublicUser[] = await prisma.user.findMany({
      where: roleFilter ? { role: roleFilter } : undefined,
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ users });
  }

  if (!isDevAuthStubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const users: PublicUser[] = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}

/** Admin -> Users (#364): an Admin creates a User. Name, email (unique, case-insensitively) and role are required. */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;

  const parsed = createUserSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });

  const result = await createUser(auth.user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ user: result.user }, { status: 201 });
}

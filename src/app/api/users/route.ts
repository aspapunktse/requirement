import { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isDevAuthStubEnabled, type PublicUser } from "@/lib/acting-user";
import { authenticate } from "@/lib/api-authz";

/**
 * Two callers: the dev-only role switcher (unauthenticated, every user,
 * disabled outside development — see isDevAuthStubEnabled), and an ADMIN
 * looking up Users to manage (e.g. assigning a BUSINESS_RISK_OWNER's
 * Business Unit/Framework scope — see #55), optionally filtered by role,
 * which works regardless of the dev stub since it's a real authenticated
 * request.
 */
export async function GET(request: NextRequest) {
  const roleFilter = new URL(request.url).searchParams.get("role") as UserRole | null;

  const auth = await authenticate(request);
  if (!("response" in auth) && auth.user.role === "ADMIN") {
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

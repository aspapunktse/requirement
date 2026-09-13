import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE, isDevAuthStubEnabled, resolveActingUser } from "@/lib/acting-user";

function notFoundOutsideDev() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(request: NextRequest) {
  if (!isDevAuthStubEnabled()) return notFoundOutsideDev();

  const user = await resolveActingUser(request.cookies.get(ACTING_USER_COOKIE)?.value);
  return NextResponse.json({ user: user ?? null });
}

const setActingUserSchema = z.object({ userId: z.string().min(1) });

export async function POST(request: NextRequest) {
  if (!isDevAuthStubEnabled()) return notFoundOutsideDev();

  const parsed = setActingUserSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const response = NextResponse.json({ user });
  response.cookies.set(ACTING_USER_COOKIE, user.id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}

export async function DELETE() {
  if (!isDevAuthStubEnabled()) return notFoundOutsideDev();

  const response = NextResponse.json({ user: null });
  response.cookies.delete(ACTING_USER_COOKIE);
  return response;
}

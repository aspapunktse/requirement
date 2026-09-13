import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDevAuthStubEnabled, type PublicUser } from "@/lib/acting-user";

export async function GET() {
  if (!isDevAuthStubEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const users: PublicUser[] = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ users });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const requirements = await prisma.requirement.findMany({
    orderBy: { code: "asc" },
  });
  return NextResponse.json({ requirements });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const requirements = await prisma.requirement.findMany({
    orderBy: { code: "asc" },
    include: { systemTypes: true, capabilities: true },
  });
  return NextResponse.json({ requirements });
}

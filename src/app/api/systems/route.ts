import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystems } from "@/lib/system-visibility";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const systems = await getVisibleSystems(auth.user);
  return NextResponse.json({ systems });
}

const createSystemSchema = z.object({
  name: z.string().min(1),
  vendor: z.string().optional(),
  description: z.string().optional(),
  dataClassification: z.string().optional(),
  systemTypeId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const parsed = createSystemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "name and systemTypeId are required" },
      { status: 400 },
    );
  }

  const systemType = await prisma.systemType.findUnique({
    where: { id: parsed.data.systemTypeId },
  });
  if (!systemType) {
    return NextResponse.json({ error: "System Type not found" }, { status: 400 });
  }

  const system = await prisma.system.create({
    data: { ...parsed.data, ownerId: auth.user.id },
    include: { systemType: true, owner: true },
  });
  return NextResponse.json({ system }, { status: 201 });
}

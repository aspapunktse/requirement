import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const capabilities = await prisma.capability.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ capabilities });
}

const createCapabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;

  const parsed = createCapabilitySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const capability = await prisma.capability.create({ data: parsed.data });
    return NextResponse.json({ capability }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json(
        { error: "A Capability with that name already exists" },
        { status: 409 },
      );
    }
    throw error;
  }
}

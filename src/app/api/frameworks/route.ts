import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const frameworks = await prisma.framework.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ frameworks });
}

const createFrameworkSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  strictComplianceRequired: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const parsed = createFrameworkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const framework = await prisma.framework.create({ data: parsed.data });
    return NextResponse.json({ framework }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Framework with that name already exists" }, { status: 409 });
    }
    throw error;
  }
}

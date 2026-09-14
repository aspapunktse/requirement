import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/requirements/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const requirement = await prisma.requirement.findUnique({
    where: { id },
    include: { systemTypes: true, capabilities: true },
  });
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }
  return NextResponse.json({ requirement });
}

const updateMappingsSchema = z
  .object({
    systemTypeIds: z.array(z.string()).optional(),
    capabilityIds: z.array(z.string()).optional(),
  })
  .refine((data) => data.systemTypeIds !== undefined || data.capabilityIds !== undefined, {
    message: "Provide at least one of systemTypeIds or capabilityIds",
  });

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/requirements/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateMappingsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  const requirement = await prisma.requirement.findUnique({ where: { id } });
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  const { systemTypeIds, capabilityIds } = parsed.data;
  if (
    requirement.applicability === "ORGANIZATIONAL" &&
    systemTypeIds !== undefined &&
    systemTypeIds.length > 0
  ) {
    return NextResponse.json(
      { error: "ORGANIZATIONAL requirements cannot be scoped to System Types" },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.requirement.update({
      where: { id },
      data: {
        ...(systemTypeIds !== undefined && {
          systemTypes: { set: systemTypeIds.map((systemTypeId) => ({ id: systemTypeId })) },
        }),
        ...(capabilityIds !== undefined && {
          capabilities: { set: capabilityIds.map((capabilityId) => ({ id: capabilityId })) },
        }),
      },
      include: { systemTypes: true, capabilities: true },
    });
    return NextResponse.json({ requirement: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { error: "One or more System Type or Capability ids do not exist" },
        { status: 400 },
      );
    }
    throw error;
  }
}

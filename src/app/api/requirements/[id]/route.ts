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
    include: { deploymentFacets: true, capabilities: true },
  });
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }
  return NextResponse.json({ requirement });
}

const updateMappingsSchema = z
  .object({
    deploymentFacetIds: z.array(z.string()).optional(),
    capabilityIds: z.array(z.string()).optional(),
  })
  .refine((data) => data.deploymentFacetIds !== undefined || data.capabilityIds !== undefined, {
    message: "Provide at least one of deploymentFacetIds or capabilityIds",
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

  const { deploymentFacetIds, capabilityIds } = parsed.data;
  if (
    requirement.applicability === "ORGANIZATIONAL" &&
    deploymentFacetIds !== undefined &&
    deploymentFacetIds.length > 0
  ) {
    return NextResponse.json(
      { error: "ORGANIZATIONAL requirements cannot be scoped to Deployment Facets" },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.requirement.update({
      where: { id },
      data: {
        ...(deploymentFacetIds !== undefined && {
          deploymentFacets: { set: deploymentFacetIds.map((facetId) => ({ id: facetId })) },
        }),
        ...(capabilityIds !== undefined && {
          capabilities: { set: capabilityIds.map((capabilityId) => ({ id: capabilityId })) },
        }),
      },
      include: { deploymentFacets: true, capabilities: true },
    });
    return NextResponse.json({ requirement: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { error: "One or more Deployment Facet or Capability ids do not exist" },
        { status: 400 },
      );
    }
    throw error;
  }
}

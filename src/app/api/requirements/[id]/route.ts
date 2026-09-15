import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImpactLevel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";

const impactLevelSchema = z.nativeEnum(ImpactLevel).nullable();

export async function GET(request: NextRequest, ctx: RouteContext<"/api/requirements/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const requirement = await prisma.requirement.findUnique({
    where: { id },
    include: { deploymentFacets: true, regulatoryOverlays: true, capabilities: true, frameworks: true },
  });
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }
  return NextResponse.json({ requirement });
}

const updateRequirementSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    frameworkIds: z.array(z.string().min(1)).optional(),
    mandatory: z.boolean().optional(),
    question: z.string().nullable().optional(),
    intent: z.string().nullable().optional(),
    examples: z.array(z.string()).optional(),
    deploymentFacetIds: z.array(z.string()).optional(),
    regulatoryOverlayIds: z.array(z.string()).optional(),
    capabilityIds: z.array(z.string()).optional(),
    minConfidentialityImpactLevel: impactLevelSchema.optional(),
    minIntegrityImpactLevel: impactLevelSchema.optional(),
    minAvailabilityImpactLevel: impactLevelSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/requirements/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateRequirementSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  const requirement = await prisma.requirement.findUnique({ where: { id } });
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  const {
    title,
    description,
    category,
    frameworkIds,
    mandatory,
    question,
    intent,
    examples,
    deploymentFacetIds,
    regulatoryOverlayIds,
    capabilityIds,
    minConfidentialityImpactLevel,
    minIntegrityImpactLevel,
    minAvailabilityImpactLevel,
  } = parsed.data;
  if (
    requirement.applicability === "ORGANIZATIONAL" &&
    ((deploymentFacetIds !== undefined && deploymentFacetIds.length > 0) ||
      (regulatoryOverlayIds !== undefined && regulatoryOverlayIds.length > 0) ||
      minConfidentialityImpactLevel != null ||
      minIntegrityImpactLevel != null ||
      minAvailabilityImpactLevel != null)
  ) {
    return NextResponse.json(
      {
        error:
          "ORGANIZATIONAL requirements cannot be scoped to Deployment Facets, Regulatory Overlays, or Impact Level",
      },
      { status: 400 },
    );
  }

  try {
    const updated = await prisma.requirement.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(frameworkIds !== undefined && {
          frameworks: { set: frameworkIds.map((frameworkId) => ({ id: frameworkId })) },
        }),
        ...(mandatory !== undefined && { mandatory }),
        ...(question !== undefined && { question }),
        ...(intent !== undefined && { intent }),
        ...(examples !== undefined && { examples }),
        ...(deploymentFacetIds !== undefined && {
          deploymentFacets: { set: deploymentFacetIds.map((facetId) => ({ id: facetId })) },
        }),
        ...(regulatoryOverlayIds !== undefined && {
          regulatoryOverlays: { set: regulatoryOverlayIds.map((overlayId) => ({ id: overlayId })) },
        }),
        ...(capabilityIds !== undefined && {
          capabilities: { set: capabilityIds.map((capabilityId) => ({ id: capabilityId })) },
        }),
        ...(minConfidentialityImpactLevel !== undefined && { minConfidentialityImpactLevel }),
        ...(minIntegrityImpactLevel !== undefined && { minIntegrityImpactLevel }),
        ...(minAvailabilityImpactLevel !== undefined && { minAvailabilityImpactLevel }),
      },
      include: { deploymentFacets: true, regulatoryOverlays: true, capabilities: true, frameworks: true },
    });
    return NextResponse.json({ requirement: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json(
        { error: "One or more Deployment Facet, Regulatory Overlay, Capability, or Framework ids do not exist" },
        { status: 400 },
      );
    }
    throw error;
  }
}

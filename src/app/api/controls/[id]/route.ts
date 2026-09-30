import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImpactLevel, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { controlIncludeFor, redactDraftOrigin } from "@/lib/frameworks";
import { finishRecompute, prepareRecompute, scopeForControl } from "@/lib/applicability-recompute";

const impactLevelSchema = z.nativeEnum(ImpactLevel).nullable();

export async function GET(request: NextRequest, ctx: RouteContext<"/api/controls/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const control = await prisma.control.findUnique({
    where: { id },
    include: controlIncludeFor(auth.user),
  });
  if (!control) {
    return NextResponse.json({ error: "Control not found" }, { status: 404 });
  }
  return NextResponse.json({ control: redactDraftOrigin(auth.user, control) });
}

const updateControlSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    mandatory: z.boolean().optional(),
    question: z.string().nullable().optional(),
    intent: z.string().nullable().optional(),
    examples: z.array(z.string()).optional(),
    deploymentFacetIds: z.array(z.string()).optional(),
    capabilityIds: z.array(z.string()).optional(),
    minConfidentialityImpactLevel: impactLevelSchema.optional(),
    minIntegrityImpactLevel: impactLevelSchema.optional(),
    minAvailabilityImpactLevel: impactLevelSchema.optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

const sameIds = (a: string[], b: string[]) => new Set(a).size === new Set(b).size && a.every((id) => b.includes(id));

/**
 * Edits a Control. `applicability` and the mapping to Requirements aren't editable here, so the
 * fields that decide which Systems the Control applies to are its Deployment Facets and the three
 * Impact Level thresholds. When one of those actually changes (not merely
 * present in the body) every System that has in scope a Published Framework the Control is mapped
 * to is recomputed for this Control (F-AP.3, #87): Not Started Assessments appear where it now
 * applies, untouched ones go where it no longer does, touched ones are kept as stale.
 * `mandatory`, Capabilities and text edits don't change applicability, so they recompute nothing.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/controls/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateControlSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  const control = await prisma.control.findUnique({
    where: { id },
    include: { deploymentFacets: { select: { id: true } } },
  });
  if (!control) {
    return NextResponse.json({ error: "Control not found" }, { status: 404 });
  }

  const {
    title,
    description,
    category,
    mandatory,
    question,
    intent,
    examples,
    deploymentFacetIds,
    capabilityIds,
    minConfidentialityImpactLevel,
    minIntegrityImpactLevel,
    minAvailabilityImpactLevel,
  } = parsed.data;
  if (
    control.applicability === "ORGANIZATIONAL" &&
    ((deploymentFacetIds !== undefined && deploymentFacetIds.length > 0) ||
      minConfidentialityImpactLevel != null ||
      minIntegrityImpactLevel != null ||
      minAvailabilityImpactLevel != null)
  ) {
    return NextResponse.json(
      {
        error:
          "ORGANIZATIONAL controls cannot be scoped to Deployment Facets or Impact Level",
      },
      { status: 400 },
    );
  }

  const scopingChanged =
    (deploymentFacetIds !== undefined &&
      !sameIds(deploymentFacetIds, control.deploymentFacets.map((f) => f.id))) ||
    (minConfidentialityImpactLevel !== undefined &&
      minConfidentialityImpactLevel !== control.minConfidentialityImpactLevel) ||
    (minIntegrityImpactLevel !== undefined && minIntegrityImpactLevel !== control.minIntegrityImpactLevel) ||
    (minAvailabilityImpactLevel !== undefined && minAvailabilityImpactLevel !== control.minAvailabilityImpactLevel);
  // Snapshot before the write, so the recompute can tell what just stopped applying.
  const pending = scopingChanged ? await prepareRecompute(await scopeForControl(id), { snapshot: true }) : null;

  try {
    const updated = await prisma.control.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(category !== undefined && { category }),
        ...(mandatory !== undefined && { mandatory }),
        ...(question !== undefined && { question }),
        ...(intent !== undefined && { intent }),
        ...(examples !== undefined && { examples }),
        ...(deploymentFacetIds !== undefined && {
          deploymentFacets: { set: deploymentFacetIds.map((facetId) => ({ id: facetId })) },
        }),
        ...(capabilityIds !== undefined && {
          capabilities: { set: capabilityIds.map((capabilityId) => ({ id: capabilityId })) },
        }),
        ...(minConfidentialityImpactLevel !== undefined && { minConfidentialityImpactLevel }),
        ...(minIntegrityImpactLevel !== undefined && { minIntegrityImpactLevel }),
        ...(minAvailabilityImpactLevel !== undefined && { minAvailabilityImpactLevel }),
      },
      include: controlIncludeFor(auth.user),
    });
    await finishRecompute(pending, `Control ${control.code} scoping edited`);
    return NextResponse.json({ control: updated });
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

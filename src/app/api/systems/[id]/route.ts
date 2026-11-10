import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canChangeSystemClassification, changeSystemClassification } from "@/lib/system-classification-change";
import { sensitivityLevelSchema } from "@/lib/sensitivity-level";
import { ClassificationRefused } from "@/lib/system-information-types";
import { refuseIfSystemClosed } from "@/lib/system-closed";

const impactLevelSchema = z.nativeEnum(ImpactLevel).nullable();

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }
  return NextResponse.json({ system });
}

const updateSystemSchema = z
  .object({
    deploymentFacetIds: z.array(z.string().min(1)).min(1).optional(),
    // The Information Types the System declares: the whole set (#304). The level must meet their floor, in the same request.
    informationTypeIds: z.array(z.string().min(1)).max(500).optional(),
    sensitivityLevel: sensitivityLevelSchema.optional(),
    integrityImpactLevel: impactLevelSchema.optional(),
    availabilityImpactLevel: impactLevelSchema.optional(),
  })
  .refine(
    (data) =>
      data.deploymentFacetIds !== undefined ||
      data.informationTypeIds !== undefined ||
      data.sensitivityLevel !== undefined ||
      data.integrityImpactLevel !== undefined ||
      data.availabilityImpactLevel !== undefined,
    { message: "Provide at least one of deploymentFacetIds, informationTypeIds, sensitivityLevel or an Impact Level axis" },
  );

/**
 * Changes a System's classification — its declared Deployment Facets
 * and/or self-declared Impact Levels, any combination in one request — at any
 * lifecycle stage (ADR 0006), and recomputes its applicable Control Assessment
 * set to match (see #15, #47, #49, #50). The recompute never changes the
 * System's onboarding status. Framework Scope declare/remove has its own endpoint
 * (`/api/systems/[id]/framework-scopes`) since it's a single-item
 * connect/disconnect rather than a "set" like these two axes, but goes
 * through the same recompute logic underneath.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/systems/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canChangeSystemClassification(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can change this System's classification" },
      { status: 403 },
    );
  }

  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const parsed = updateSystemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "At least one of deploymentFacetIds, informationTypeIds, sensitivityLevel (1 to 5 or null) or an Impact Level axis is required" },
      { status: 400 },
    );
  }

  const { deploymentFacetIds, informationTypeIds, sensitivityLevel, integrityImpactLevel, availabilityImpactLevel } =
    parsed.data;

  if (deploymentFacetIds !== undefined) {
    const matchingFacets = await prisma.deploymentFacet.count({ where: { id: { in: deploymentFacetIds } } });
    if (matchingFacets !== deploymentFacetIds.length) {
      return NextResponse.json({ error: "One or more Deployment Facet ids do not exist" }, { status: 400 });
    }
  }

  let result: Awaited<ReturnType<typeof changeSystemClassification>>;
  try {
    result = await changeSystemClassification(
      system,
      {
        deploymentFacetIds,
        informationTypeIds: informationTypeIds && [...new Set(informationTypeIds)],
        sensitivityLevel,
        integrityImpactLevel,
        availabilityImpactLevel,
      },
      auth.user.id,
    );
  } catch (error) {
    // A level below the Information Types' floor, or an unknown type: nothing was written (the transaction rolled back).
    if (error instanceof ClassificationRefused) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  const { added, removed } = result;

  const updated = await prisma.system.findUnique({
    where: { id: system.id },
    include: { deploymentFacets: true, owner: true, informationTypes: true },
  });

  return NextResponse.json({ system: updated, added, removed });
}

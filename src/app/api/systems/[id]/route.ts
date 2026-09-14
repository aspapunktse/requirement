import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canChangeDeploymentFacets, changeDeploymentFacets } from "@/lib/deployment-facet-change";

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
    confidentialityImpactLevel: impactLevelSchema.optional(),
    integrityImpactLevel: impactLevelSchema.optional(),
    availabilityImpactLevel: impactLevelSchema.optional(),
  })
  .refine(
    (data) =>
      data.deploymentFacetIds !== undefined ||
      data.confidentialityImpactLevel !== undefined ||
      data.integrityImpactLevel !== undefined ||
      data.availabilityImpactLevel !== undefined,
    { message: "Provide at least one of deploymentFacetIds or an Impact Level axis" },
  );

/**
 * Changes a Draft System's declared Deployment Facets and/or self-declared
 * Impact Levels (see #15, #47, #49). Impact Level changes here only set the
 * fields — they don't yet recompute the applicable Requirement set the way
 * a Deployment Facet change does; that generalization across every
 * classification axis is #50.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/systems/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canChangeDeploymentFacets(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can change this System's classification" },
      { status: 403 },
    );
  }

  if (system.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only a Draft System's classification can be changed" },
      { status: 400 },
    );
  }

  const parsed = updateSystemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "At least one of deploymentFacetIds or an Impact Level axis is required" },
      { status: 400 },
    );
  }

  const { deploymentFacetIds, confidentialityImpactLevel, integrityImpactLevel, availabilityImpactLevel } =
    parsed.data;

  let added = 0;
  let removed = 0;
  if (deploymentFacetIds !== undefined) {
    const matchingFacets = await prisma.deploymentFacet.count({ where: { id: { in: deploymentFacetIds } } });
    if (matchingFacets !== deploymentFacetIds.length) {
      return NextResponse.json({ error: "One or more Deployment Facet ids do not exist" }, { status: 400 });
    }
    ({ added, removed } = await changeDeploymentFacets(system, deploymentFacetIds));
  }

  if (
    confidentialityImpactLevel !== undefined ||
    integrityImpactLevel !== undefined ||
    availabilityImpactLevel !== undefined
  ) {
    await prisma.system.update({
      where: { id: system.id },
      data: {
        ...(confidentialityImpactLevel !== undefined && { confidentialityImpactLevel }),
        ...(integrityImpactLevel !== undefined && { integrityImpactLevel }),
        ...(availabilityImpactLevel !== undefined && { availabilityImpactLevel }),
      },
    });
  }

  const updated = await prisma.system.findUnique({
    where: { id: system.id },
    include: { deploymentFacets: true, regulatoryOverlays: true, owner: true },
  });

  return NextResponse.json({ system: updated, added, removed });
}

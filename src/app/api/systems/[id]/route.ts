import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canChangeSystemClassification, changeSystemClassification } from "@/lib/system-classification-change";

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
 * Changes a Draft System's classification — its declared Deployment Facets
 * and/or self-declared Impact Levels, any combination in one request — and
 * recomputes its applicable Control Assessment set to match (see #15,
 * #47, #49, #50). Regulatory Overlay declare/undeclare has its own endpoint
 * (`/api/systems/[id]/regulatory-overlays`) since it's a single-item
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

  if (deploymentFacetIds !== undefined) {
    const matchingFacets = await prisma.deploymentFacet.count({ where: { id: { in: deploymentFacetIds } } });
    if (matchingFacets !== deploymentFacetIds.length) {
      return NextResponse.json({ error: "One or more Deployment Facet ids do not exist" }, { status: 400 });
    }
  }

  const { added, removed } = await changeSystemClassification(
    system,
    {
      deploymentFacetIds,
      confidentialityImpactLevel,
      integrityImpactLevel,
      availabilityImpactLevel,
    },
    auth.user.id,
  );

  const updated = await prisma.system.findUnique({
    where: { id: system.id },
    include: { deploymentFacets: true, regulatoryOverlays: true, owner: true },
  });

  return NextResponse.json({ system: updated, added, removed });
}

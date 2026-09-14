import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canChangeDeploymentFacets, changeDeploymentFacets } from "@/lib/deployment-facet-change";

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

const updateSystemSchema = z.object({ deploymentFacetIds: z.array(z.string().min(1)).min(1) });

/** Currently only supports changing a Draft System's Deployment Facets (see #15, #47). */
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
      { error: "Only the System Owner or an Admin can change this System's Deployment Facets" },
      { status: 403 },
    );
  }

  if (system.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only a Draft System's Deployment Facets can be changed" },
      { status: 400 },
    );
  }

  const parsed = updateSystemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "At least one deploymentFacetId is required" }, { status: 400 });
  }

  const matchingFacets = await prisma.deploymentFacet.count({
    where: { id: { in: parsed.data.deploymentFacetIds } },
  });
  if (matchingFacets !== parsed.data.deploymentFacetIds.length) {
    return NextResponse.json({ error: "One or more Deployment Facet ids do not exist" }, { status: 400 });
  }

  const { added, removed } = await changeDeploymentFacets(system, parsed.data.deploymentFacetIds);

  const updated = await prisma.system.findUnique({
    where: { id: system.id },
    include: { deploymentFacets: true, owner: true },
  });

  return NextResponse.json({ system: updated, added, removed });
}

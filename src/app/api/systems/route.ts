import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { canWriteSystems, getVisibleSystems } from "@/lib/system-visibility";

const impactLevelSchema = z.nativeEnum(ImpactLevel).optional();

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const systems = await getVisibleSystems(auth.user);
  return NextResponse.json({ systems });
}

const createSystemSchema = z.object({
  name: z.string().min(1),
  vendor: z.string().optional(),
  description: z.string().optional(),
  confidentialityImpactLevel: impactLevelSchema,
  integrityImpactLevel: impactLevelSchema,
  availabilityImpactLevel: impactLevelSchema,
  deploymentFacetIds: z.array(z.string().min(1)).min(1),
});

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!canWriteSystems(auth.user)) {
    return NextResponse.json({ error: "Your role can read Systems but not change them" }, { status: 403 });
  }

  const parsed = createSystemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "name and at least one deploymentFacetId are required" },
      { status: 400 },
    );
  }

  const { deploymentFacetIds, ...rest } = parsed.data;

  const matchingFacets = await prisma.deploymentFacet.count({
    where: { id: { in: deploymentFacetIds } },
  });
  if (matchingFacets !== deploymentFacetIds.length) {
    return NextResponse.json({ error: "One or more Deployment Facet ids do not exist" }, { status: 400 });
  }

  const system = await prisma.system.create({
    data: {
      ...rest,
      ownerId: auth.user.id,
      deploymentFacets: { connect: deploymentFacetIds.map((id) => ({ id })) },
    },
    include: { deploymentFacets: true, regulatoryOverlays: true, owner: true },
  });
  return NextResponse.json({ system }, { status: 201 });
}

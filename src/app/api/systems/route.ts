import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystems } from "@/lib/system-visibility";
import { canCreateSystem } from "@/lib/system-permissions";
import { logChangeEvent } from "@/lib/change-events";
import { applyFrameworkScopeDeclaredIn } from "@/lib/framework-scope";
import { declareProviderDependencyIn } from "@/lib/provider-dependencies";
import { lockProvider, PROVIDER_TRANSACTION_TIMEOUT_MS } from "@/lib/provider-inheritance";

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
  // The onboarding interview's Laws and standards and Relies on answers (#258).
  frameworkScopeIds: z.array(z.string().min(1)).max(200).optional(),
  providerIds: z.array(z.string().min(1)).max(200).optional(),
});

/** A refusal found inside the create transaction: thrown to roll everything back, then answered as `status`. */
class CreateRefused extends Error {
  constructor(
    readonly status: 400,
    message: string,
  ) {
    super(message);
  }
}

const NOT_PUBLISHED_FRAMEWORKS = "Every Framework Scope id must be a Published Framework that is not the base Framework";
const NOT_PROVIDERS = "Every Provider id must be a System that is marked as a Provider";

export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!canCreateSystem(auth.user)) {
    return NextResponse.json(
      { error: "Only a System Owner, Risk Owner or Admin can create a System" },
      { status: 403 },
    );
  }

  const parsed = createSystemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "name and at least one deploymentFacetId are required" },
      { status: 400 },
    );
  }

  const { deploymentFacetIds, frameworkScopeIds = [], providerIds = [], ...rest } = parsed.data;
  const scopeIds = [...new Set(frameworkScopeIds)];
  const dependencyIds = [...new Set(providerIds)].sort();

  const matchingFacets = await prisma.deploymentFacet.count({
    where: { id: { in: deploymentFacetIds } },
  });
  if (matchingFacets !== deploymentFacetIds.length) {
    return NextResponse.json({ error: "One or more Deployment Facet ids do not exist" }, { status: 400 });
  }

  // The System, its Framework Scope, its Provider dependencies and all their Change Events commit
  // together (#245, #258), with the same result as creating the System and then declaring the scope
  // and the dependencies on its Profile and Providers tabs, in that order: the same helpers, run on `tx`.
  // Every query inside is on `tx` (a global-client query would need a second connection and could
  // deadlock a small pool behind the Provider locks).
  try {
    const system = await prisma.$transaction(
      async (tx) => {
        const frameworks = await tx.framework.findMany({
          where: { id: { in: scopeIds }, status: "PUBLISHED", isBase: false },
          select: { id: true, name: true, version: true },
        });
        if (frameworks.length !== scopeIds.length) throw new CreateRefused(400, NOT_PUBLISHED_FRAMEWORKS);
        const providers = await tx.system.count({ where: { id: { in: dependencyIds }, isProvider: true } });
        if (providers !== dependencyIds.length) throw new CreateRefused(400, NOT_PROVIDERS);

        // Provider locks first, in sorted id order, as `declareProviderDependencyIn` asks of a caller declaring several.
        for (const providerId of dependencyIds) await lockProvider(tx, providerId);

        const created = await tx.system.create({
          data: {
            ...rest,
            ownerId: auth.user.id,
            deploymentFacets: { connect: deploymentFacetIds.map((id) => ({ id })) },
          },
          include: { deploymentFacets: true, owner: true },
        });
        await logChangeEvent(created.id, "SYSTEM_CREATED", `Created the System "${created.name}"`, auth.user.id, tx);

        // Framework Scope in the order asked for, each declaration seeing the ones before it.
        const declared: { id: string }[] = [];
        for (const frameworkId of scopeIds) {
          const framework = frameworks.find((f) => f.id === frameworkId)!;
          await applyFrameworkScopeDeclaredIn(tx, { ...created, frameworkScopes: declared }, framework, auth.user.id);
          declared.push({ id: framework.id });
        }

        for (const providerId of dependencyIds) {
          const result = await declareProviderDependencyIn(tx, created, providerId, auth.user);
          if (!result.ok) throw new CreateRefused(400, NOT_PROVIDERS);
        }

        return tx.system.findUniqueOrThrow({ where: { id: created.id }, include: { deploymentFacets: true, owner: true } });
      },
      { timeout: PROVIDER_TRANSACTION_TIMEOUT_MS },
    );
    return NextResponse.json({ system }, { status: 201 });
  } catch (error) {
    if (error instanceof CreateRefused) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

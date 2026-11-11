import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ImpactLevel } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystems } from "@/lib/system-visibility";
import { canCreateSystem } from "@/lib/system-permissions";
import { sensitivityLevelSchema } from "@/lib/sensitivity-level";
import { logChangeEvent } from "@/lib/change-events";
import { readStagedEvaluationEnabled } from "@/lib/app-settings";
import { BSO_UNKNOWN_USER_REFUSAL } from "@/lib/business-system-owner";
import { applyFrameworkScopeDeclaredIn } from "@/lib/framework-scope";
import { declareProviderDependencyIn } from "@/lib/provider-dependencies";
import {
  assertMeetsInformationTypeFloor,
  ClassificationRefused,
  describeTypesChange,
  readInformationTypesOrRefuse,
} from "@/lib/system-information-types";
import { lockProvider, PROVIDER_TRANSACTION_TIMEOUT_MS } from "@/lib/provider-inheritance";
import { SUGGESTING_TYPE_SELECT, declinesForCreate } from "@/lib/framework-suggestions-data";
import { VENDOR_DETAILS_REQUIRED_MESSAGE, missingVendorDetails } from "@/lib/vendor-detail-labels";
import { VENDOR_DETAIL_KEYS, dayDate, vendorDetailFields } from "@/lib/vendor-details";

const impactLevelSchema = z.nativeEnum(ImpactLevel).optional();


export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const systems = await getVisibleSystems(auth.user);
  return NextResponse.json({ systems });
}

const createSystemSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  // The "About the system" details (#357): vendor name, URLs, data location, contract. All optional here;
  // vendor and service URL are required once a declared Deployment Facet needs vendor details (below).
  ...vendorDetailFields,
  sensitivityLevel: sensitivityLevelSchema.optional(),
  // The Information Types the new System declares (#304); the level must meet their floor.
  informationTypeIds: z.array(z.string().min(1)).max(500).optional(),
  integrityImpactLevel: impactLevelSchema,
  availabilityImpactLevel: impactLevelSchema,
  deploymentFacetIds: z.array(z.string().min(1)).min(1),
  // The onboarding interview's Laws and standards and Relies on answers (#258).
  frameworkScopeIds: z.array(z.string().min(1)).max(200).optional(),
  // Suggested Frameworks the owner answered No to (ADR 0013): each must be one a declared Information Type suggests.
  declinedFrameworkIds: z.array(z.string().min(1)).max(200).optional(),
  providerIds: z.array(z.string().min(1)).max(200).optional(),
  // The optional Business System Owner picked in the interview (#321): any User but the creator, who becomes the owner.
  businessSystemOwnerId: z.string().min(1).nullish(),
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
const NOT_SUGGESTED = "Every declined Framework id must be a Framework that one of the System's Information Types suggests, and not in its Framework Scope";
const BSO_IS_CREATOR = "The Business System Owner can't be you: you become the System's owner";
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
    const issue = parsed.error.issues[0];
    const aboutDetail = typeof issue?.path[0] === "string" && (VENDOR_DETAIL_KEYS as string[]).includes(issue.path[0]);
    return NextResponse.json(
      { error: aboutDetail ? issue.message : "name and at least one deploymentFacetId are required" },
      { status: 400 },
    );
  }

  const { deploymentFacetIds, frameworkScopeIds = [], providerIds = [], informationTypeIds = [], declinedFrameworkIds = [], businessSystemOwnerId = null, ...rest } = parsed.data;
  const scopeIds = [...new Set(frameworkScopeIds)];
  const dependencyIds = [...new Set(providerIds)].sort();

  const facets = await prisma.deploymentFacet.findMany({
    where: { id: { in: deploymentFacetIds } },
    select: { requiresVendorDetails: true },
  });
  if (facets.length !== deploymentFacetIds.length) {
    return NextResponse.json({ error: "One or more Deployment Facet ids do not exist" }, { status: 400 });
  }
  // A System declaring a Facet that needs vendor details can't be created without its vendor name and service URL.
  if (facets.some((facet) => facet.requiresVendorDetails) && missingVendorDetails(rest).length > 0) {
    return NextResponse.json({ error: VENDOR_DETAILS_REQUIRED_MESSAGE }, { status: 400 });
  }

  // The System, its Framework Scope, its Provider dependencies and all their Change Events commit
  // together (#245, #258), with the same result as creating the System and then declaring the scope
  // and the dependencies on its Profile and Providers tabs, in that order: the same helpers, run on `tx`.
  // Every query inside is on `tx` (a global-client query would need a second connection and could
  // deadlock a small pool behind the Provider locks).
  try {
    const system = await prisma.$transaction(
      async (tx) => {
        // The creator becomes the owner, so can't also be the Business System Owner (#321); the User must exist.
        if (businessSystemOwnerId === auth.user.id) throw new CreateRefused(400, BSO_IS_CREATOR);
        const businessSystemOwner = businessSystemOwnerId
          ? await tx.user.findUnique({ where: { id: businessSystemOwnerId }, select: { id: true, name: true } })
          : null;
        if (businessSystemOwnerId && !businessSystemOwner) throw new CreateRefused(400, BSO_UNKNOWN_USER_REFUSAL);

        const frameworks = await tx.framework.findMany({
          where: { id: { in: scopeIds }, status: "PUBLISHED", isBase: false },
          select: { id: true, name: true, version: true },
        });
        if (frameworks.length !== scopeIds.length) throw new CreateRefused(400, NOT_PUBLISHED_FRAMEWORKS);
        const providers = await tx.system.count({ where: { id: { in: dependencyIds }, isProvider: true } });
        if (providers !== dependencyIds.length) throw new CreateRefused(400, NOT_PROVIDERS);

        // The floor on the types the System is created with (ADR 0012): refused before anything is written.
        const types = await readInformationTypesOrRefuse(tx, informationTypeIds);
        await assertMeetsInformationTypeFloor(tx, rest.sensitivityLevel ?? null, types);

        // The declines are checked against what the declared types really suggest, never against the client's word.
        const declines =
          declinedFrameworkIds.length === 0
            ? []
            : declinesForCreate(
                await tx.informationType.findMany({ where: { id: { in: types.map((type) => type.id) } }, select: SUGGESTING_TYPE_SELECT }),
                declinedFrameworkIds,
                scopeIds,
              );
        if (declines === null) throw new CreateRefused(400, NOT_SUGGESTED);

        // Provider locks first, in sorted id order, as `declareProviderDependencyIn` asks of a caller declaring several.
        for (const providerId of dependencyIds) await lockProvider(tx, providerId);

        // The App Setting decides the flow for this System, once, here: on, it starts in its first round (staged evaluation, #328).
        const staged = await readStagedEvaluationEnabled(tx);

        const created = await tx.system.create({
          data: {
            ...rest,
            ...(rest.contractRenewalDate ? { contractRenewalDate: dayDate(rest.contractRenewalDate) } : { contractRenewalDate: null }),
            ownerId: auth.user.id,
            ...(staged && { evaluationStage: "FIRST_ROUND" as const, evaluationStageEnteredAt: new Date() }),
            ...(businessSystemOwner && { businessSystemOwnerId: businessSystemOwner.id }),
            deploymentFacets: { connect: deploymentFacetIds.map((id) => ({ id })) },
            ...(types.length > 0 && { informationTypes: { connect: types.map((type) => ({ id: type.id })) } }),
          },
          include: { deploymentFacets: true, owner: true },
        });
        await logChangeEvent(
          created.id,
          "SYSTEM_CREATED",
          `Created the System "${created.name}"`,
          auth.user.id,
          tx,
        );
        // A Business System Owner picked in the interview is its own event (old none, new the pick), in the same transaction.
        if (staged) await logChangeEvent(created.id, "EVALUATION_STAGE_CHANGED", "Staged evaluation started: first round", auth.user.id, tx);
        if (businessSystemOwner) {
          await logChangeEvent(
            created.id,
            "BUSINESS_SYSTEM_OWNER_CHANGED",
            `Business System Owner changed from none to ${businessSystemOwner.name}`,
            auth.user.id,
            tx,
          );
        }
        if (types.length > 0) await logChangeEvent(created.id, "CLASSIFICATION_CHANGED", describeTypesChange([], types), auth.user.id, tx);

        // Framework Scope in the order asked for, each declaration seeing the ones before it.
        const declared: { id: string }[] = [];
        for (const frameworkId of scopeIds) {
          const framework = frameworks.find((f) => f.id === frameworkId)!;
          await applyFrameworkScopeDeclaredIn(tx, { ...created, frameworkScopes: declared }, framework, auth.user.id);
          declared.push({ id: framework.id });
        }

        // The Suggested Frameworks the owner left out, in the same transaction as the System.
        if (declines.length > 0) {
          await tx.frameworkSuggestionDecline.createMany({ data: declines.map((decline) => ({ systemId: created.id, ...decline })) });
        }

        for (const providerId of dependencyIds) {
          const result = await declareProviderDependencyIn(tx, created, providerId, auth.user);
          if (!result.ok) throw new CreateRefused(400, NOT_PROVIDERS);
        }

        return tx.system.findUniqueOrThrow({ where: { id: created.id }, include: { deploymentFacets: true, owner: true, informationTypes: true } });
      },
      { timeout: PROVIDER_TRANSACTION_TIMEOUT_MS },
    );
    return NextResponse.json({ system }, { status: 201 });
  } catch (error) {
    if (error instanceof ClassificationRefused) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof CreateRefused) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

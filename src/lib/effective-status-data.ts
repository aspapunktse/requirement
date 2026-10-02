import type { ControlAssessmentStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OwnAssessment, ProviderSource } from "@/lib/effective-status";
import { controlAppliesToSystem } from "@/lib/control-applicability";

/**
 * Loaders for the inputs of `resolveEffectiveStatus` (issues #121 and #124); the
 * rules themselves are the pure functions in `effective-status.ts`. A constant
 * number of queries each, however many Controls or Systems, so the bulk readers
 * keep their constant number of queries.
 */

type OrganizationDb = Pick<Prisma.TransactionClient, "organizationControlImplementation">;

/**
 * The Organization's recorded status for each of `controlIds`, by Control id. A
 * Control with no row is absent from the map and reads as Not Started
 * (`inheritanceSourcesFor`; the missing-row rule of #120).
 */
export async function loadOrganizationStatuses(
  controlIds: string[],
  db: OrganizationDb = prisma,
): Promise<Map<string, ControlAssessmentStatus>> {
  if (controlIds.length === 0) return new Map();
  const rows = await db.organizationControlImplementation.findMany({
    where: { controlId: { in: controlIds } },
    select: { controlId: true, status: true },
  });
  return new Map(rows.map((row) => [row.controlId, row.status]));
}

/** A stored Control Assessment as `resolveEffectiveStatus` wants it: a person set it when `assessedById` is not null. */
export function toOwnAssessment(row: { status: ControlAssessmentStatus; assessedById: string | null }): NonNullable<OwnAssessment> {
  return { status: row.status, personSet: row.assessedById !== null };
}

type ProviderDb = Pick<Prisma.TransactionClient, "providerDependency" | "controlOffering" | "controlAssessment" | "control">;

/** The Provider Offerings that reach each System, by System id and then Control id (#124). */
export type ProviderSourcesBySystem = Map<string, Map<string, ProviderSource[]>>;

/**
 * The Provider sources of many Systems for `controlIds`, in a constant number of
 * queries however many Systems or Providers there are (#124, F-IN.3-F-IN.4):
 *
 * 1. the dependencies of `systemIds`, with each Provider's name, status and
 *    classification;
 * 2. those Providers' Offerings of `controlIds` (Full and Shared, so Shared ones
 *    can be listed);
 * 3. the Providers' OWN Control Assessment statuses for the offered (Provider,
 *    Control) pairs: never their effective statuses, so nothing is inherited
 *    through a chain;
 * 4. the offered Controls with what applicability needs, so whether each still
 *    applies to its Provider is decided in memory (`controlAppliesToSystem`).
 *
 * A System with no dependency is absent from the map, and so is a Control no
 * Provider of the System offers. Each Control's list is in the order
 * `inheritanceSourcesFor` imposes, so callers just pass it on. Pass a
 * transaction client to read inside the transaction of the change being recorded.
 */
export async function loadProviderSources(
  systemIds: string[],
  controlIds: string[],
  db: ProviderDb = prisma,
): Promise<ProviderSourcesBySystem> {
  const result: ProviderSourcesBySystem = new Map();
  if (systemIds.length === 0 || controlIds.length === 0) return result;

  const dependencies = await db.providerDependency.findMany({
    where: { dependentId: { in: systemIds } },
    select: {
      dependentId: true,
      provider: {
        select: {
          id: true,
          name: true,
          status: true,
          confidentialityImpactLevel: true,
          integrityImpactLevel: true,
          availabilityImpactLevel: true,
          deploymentFacets: { select: { id: true } },
          frameworkScopes: { select: { id: true } },
        },
      },
    },
  });
  if (dependencies.length === 0) return result;
  const providers = new Map(dependencies.map((dependency) => [dependency.provider.id, dependency.provider]));

  const offerings = await db.controlOffering.findMany({
    where: { providerId: { in: [...providers.keys()] }, controlId: { in: controlIds } },
    select: { providerId: true, controlId: true, type: true, customerResponsibility: true },
  });
  if (offerings.length === 0) return result;
  const offeredControlIds = [...new Set(offerings.map((offering) => offering.controlId))];

  const [assessments, controls] = await Promise.all([
    db.controlAssessment.findMany({
      where: { systemId: { in: [...providers.keys()] }, controlId: { in: offeredControlIds } },
      select: { systemId: true, controlId: true, status: true },
    }),
    db.control.findMany({
      where: { id: { in: offeredControlIds } },
      select: {
        id: true,
        applicability: true,
        minConfidentialityImpactLevel: true,
        minIntegrityImpactLevel: true,
        minAvailabilityImpactLevel: true,
        deploymentFacets: { select: { id: true } },
        mappings: { select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } } },
      },
    }),
  ]);
  const statusByPair = new Map(assessments.map((a) => [`${a.systemId}|${a.controlId}`, a.status]));
  const controlById = new Map(controls.map((control) => [control.id, control]));

  const sourcesByProvider = new Map<string, Map<string, ProviderSource>>();
  for (const offering of offerings) {
    const provider = providers.get(offering.providerId);
    const control = controlById.get(offering.controlId);
    if (!provider || !control) continue;
    const bySystemControl = sourcesByProvider.get(provider.id) ?? new Map<string, ProviderSource>();
    bySystemControl.set(control.id, {
      kind: "PROVIDER",
      type: offering.type,
      status: statusByPair.get(`${provider.id}|${control.id}`) ?? "NOT_STARTED",
      provider: { id: provider.id, name: provider.name },
      providerOnboarded: provider.status === "ONBOARDED",
      appliesToProvider: controlAppliesToSystem(control, provider),
      customerResponsibility: offering.customerResponsibility,
    });
    sourcesByProvider.set(provider.id, bySystemControl);
  }

  for (const dependency of dependencies) {
    const offered = sourcesByProvider.get(dependency.provider.id);
    if (!offered) continue;
    const bySystem = result.get(dependency.dependentId) ?? new Map<string, ProviderSource[]>();
    for (const [controlId, source] of offered) {
      bySystem.set(controlId, [...(bySystem.get(controlId) ?? []), source]);
    }
    result.set(dependency.dependentId, bySystem);
  }
  return result;
}

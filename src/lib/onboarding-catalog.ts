import { prisma } from "@/lib/prisma";
import { controlAppliesToSystem } from "@/lib/control-applicability";
import { loadOrganizationStatuses } from "@/lib/effective-status-data";
import type { OnboardingCatalog, OnboardingControl, OnboardingOffering } from "@/lib/onboarding-interview";

/**
 * Everything the System onboarding interview (#258) needs to work out, in the browser, which
 * Controls would apply to a System with a given set of answers and who would do the work. The rules
 * are the pure ones in `onboarding-interview.ts`; this is the one read behind them.
 *
 * All of it is read in one RepeatableRead transaction, every query on `tx`, so the Control library,
 * the Organization's statuses and the Providers' Offerings are one consistent snapshot even while
 * a catalog edit or an unmark commits (`loadStatementOfApplicability` is the pattern).
 *
 * Provider visibility: the interview shows a Provider by name and whether it is Onboarded, and the
 * Offerings that count for grouping. So:
 * - every System marked as a Provider is listed (id, name, Onboarded), as the Providers tab's picker does;
 * - only an Onboarded Provider's Offerings are included (a not-Onboarded Provider's don't count, F-IN.4),
 *   and only those whose Control still applies to the Provider (an Offering is kept, without credit,
 *   when it stops);
 * - of the Provider's own state, only whether its Assessment of a Fully offered Control is Fulfilled
 *   is carried (a boolean, never the status, evidence or classification).
 */
export async function loadOnboardingCatalog(): Promise<OnboardingCatalog> {
  return prisma.$transaction(
    async (tx) => {
      // Sequential: one connection.
      const deploymentFacets = await tx.deploymentFacet.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, description: true },
      });
      const frameworks = await tx.framework.findMany({
        where: { status: "PUBLISHED" },
        orderBy: [{ name: "asc" }, { version: "asc" }],
        select: { id: true, name: true, version: true, description: true, isBase: true, onboardingQuestion: true, onboardingHint: true },
      });
      const providerSystems = await tx.system.findMany({
        where: { isProvider: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
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
      });
      const controls = await tx.control.findMany({
        where: { applicability: { in: ["PER_SYSTEM", "BOTH"] } },
        orderBy: { code: "asc" },
        select: {
          id: true,
          code: true,
          title: true,
          applicability: true,
          minConfidentialityImpactLevel: true,
          minIntegrityImpactLevel: true,
          minAvailabilityImpactLevel: true,
          deploymentFacets: { select: { id: true } },
          mappings: { select: { requirement: { select: { framework: { select: { id: true, status: true, isBase: true } } } } } },
        },
      });
      const controlIds = controls.map((control) => control.id);
      const organizationStatuses = await loadOrganizationStatuses(
        controls.filter((control) => control.applicability === "BOTH").map((control) => control.id),
        tx,
      );

      const onboarded = providerSystems.filter((provider) => provider.status === "ONBOARDED");
      const offerings =
        onboarded.length === 0
          ? []
          : await tx.controlOffering.findMany({
              where: { providerId: { in: onboarded.map((provider) => provider.id) }, controlId: { in: controlIds } },
              select: { providerId: true, controlId: true, type: true, customerResponsibility: true },
            });
      const fullyOffered = offerings.filter((offering) => offering.type === "FULL");
      const fulfilled =
        fullyOffered.length === 0
          ? []
          : await tx.controlAssessment.findMany({
              where: {
                systemId: { in: [...new Set(fullyOffered.map((offering) => offering.providerId))] },
                controlId: { in: [...new Set(fullyOffered.map((offering) => offering.controlId))] },
                status: "FULFILLED",
              },
              select: { systemId: true, controlId: true },
            });
      const fulfilledPairs = new Set(fulfilled.map((row) => `${row.systemId}|${row.controlId}`));

      const providersById = new Map(onboarded.map((provider) => [provider.id, provider]));
      const controlsById = new Map(controls.map((control) => [control.id, control]));
      const offeringsByControl = new Map<string, OnboardingOffering[]>();
      for (const offering of offerings) {
        const provider = providersById.get(offering.providerId);
        const control = controlsById.get(offering.controlId);
        if (!provider || !control || !controlAppliesToSystem(control, provider)) continue;
        const list = offeringsByControl.get(control.id) ?? [];
        list.push({
          providerId: provider.id,
          type: offering.type,
          customerResponsibility: offering.type === "SHARED" ? offering.customerResponsibility : null,
          fulfilled: offering.type === "FULL" && fulfilledPairs.has(`${provider.id}|${control.id}`),
        });
        offeringsByControl.set(control.id, list);
      }

      return {
        deploymentFacets,
        frameworks,
        providers: providerSystems.map((provider) => ({ id: provider.id, name: provider.name, onboarded: provider.status === "ONBOARDED" })),
        controls: controls.map(
          (control): OnboardingControl => ({
            id: control.id,
            code: control.code,
            title: control.title,
            applicability: control.applicability === "BOTH" ? "BOTH" : "PER_SYSTEM",
            deploymentFacetIds: control.deploymentFacets.map((facet) => facet.id),
            minConfidentialityImpactLevel: control.minConfidentialityImpactLevel,
            minIntegrityImpactLevel: control.minIntegrityImpactLevel,
            minAvailabilityImpactLevel: control.minAvailabilityImpactLevel,
            frameworkIds: [
              ...new Set(
                control.mappings
                  .map((mapping) => mapping.requirement.framework)
                  .filter((framework) => framework.status === "PUBLISHED")
                  .map((framework) => framework.id),
              ),
            ],
            organizationFulfilled: control.applicability === "BOTH" && organizationStatuses.get(control.id) === "FULFILLED",
            offerings: offeringsByControl.get(control.id) ?? [],
          }),
        ),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 30_000 },
  );
}

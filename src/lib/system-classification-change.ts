import type { ImpactLevel, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getApplicableRequirements,
  diffApplicabilityOps,
  type SystemClassification,
} from "@/lib/requirement-assessments";

/**
 * Who may change a System's classification — its declared Deployment
 * Facets, declared Regulatory Overlays, or Impact Level axes: ADMIN, or the
 * owning SYSTEM_OWNER. Callers still need to check the System is Draft
 * separately (kept out of here, like `canMarkOnboarded`'s Approved check,
 * so a caller can report "wrong role" vs "wrong status" as distinct errors).
 * One shared rule across all three axes — see ADR 0003.
 *
 * Draft-only (not merely "not yet Onboarded") is a deliberate, confirmed
 * choice (#51): it matches Capability's existing rule (`canManageCapabilities`
 * in system-capabilities.ts) and Regulatory Overlay's (`canManageRegulatoryOverlays`
 * in system-overlays.ts), so all four mechanisms are locked from the moment
 * a System leaves Draft (submitted for review) rather than only once
 * Onboarded — trivially satisfies "locked once Onboarded" as a strict
 * subset, and keeps one consistent rule instead of each mechanism picking
 * its own lifecycle cutoff.
 */
export function canChangeSystemClassification(
  user: { id: string; role: UserRole },
  system: { ownerId: string },
) {
  if (user.role === "ADMIN") return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

export type ClassificationChanges = {
  deploymentFacetIds?: string[];
  confidentialityImpactLevel?: ImpactLevel | null;
  integrityImpactLevel?: ImpactLevel | null;
  availabilityImpactLevel?: ImpactLevel | null;
};

/**
 * Change a Draft System's classification — any combination of Deployment
 * Facets and/or Impact Level axes in one call — and recompute its
 * Requirement Assessment set to match: create NOT_STARTED rows for newly-
 * applicable Requirements, and remove rows for no-longer-applicable ones —
 * but only if untouched (still NOT_STARTED and never manually edited, i.e.
 * assessedById is null). A Requirement Assessment a human has already
 * worked on is left in place even though it's no longer applicable; it
 * becomes visible via getStaleAssessments so the System Owner can resolve
 * it manually.
 *
 * The diff is computed once against the *combined* old -> new transition
 * (not once per changed axis), so a request that changes both Facets and an
 * Impact Level at once produces one correct recompute rather than two
 * partially-overlapping ones. Regulatory Overlay declare/undeclare goes
 * through the same diffApplicabilityOps helper via
 * `src/lib/system-overlays.ts` instead of this function, since it has its
 * own single-item connect/disconnect API shape — but the recompute logic
 * itself is shared. This is the generalization of the old System-Type-only
 * `changeSystemType`/`changeDeploymentFacets` to every classification axis
 * — see ADR 0003 and #29/#47's original invariant.
 *
 * A Hybrid System declaring both On-Prem and Cloud simply gets the union of
 * what each facet requires — see ADR 0003.
 */
export async function changeSystemClassification(
  system: SystemClassification & { id: string },
  changes: ClassificationChanges,
) {
  const newClassification: SystemClassification = {
    deploymentFacets:
      changes.deploymentFacetIds !== undefined
        ? changes.deploymentFacetIds.map((id) => ({ id }))
        : system.deploymentFacets,
    regulatoryOverlays: system.regulatoryOverlays,
    confidentialityImpactLevel:
      changes.confidentialityImpactLevel !== undefined
        ? changes.confidentialityImpactLevel
        : system.confidentialityImpactLevel,
    integrityImpactLevel:
      changes.integrityImpactLevel !== undefined ? changes.integrityImpactLevel : system.integrityImpactLevel,
    availabilityImpactLevel:
      changes.availabilityImpactLevel !== undefined
        ? changes.availabilityImpactLevel
        : system.availabilityImpactLevel,
  };

  const [oldApplicable, newApplicable] = await Promise.all([
    getApplicableRequirements(system),
    getApplicableRequirements(newClassification),
  ]);

  const { added, deleteOp, createOp } = diffApplicabilityOps(system.id, oldApplicable, newApplicable);

  const [, removed] = await prisma.$transaction([
    prisma.system.update({
      where: { id: system.id },
      data: {
        ...(changes.deploymentFacetIds !== undefined && {
          deploymentFacets: { set: changes.deploymentFacetIds.map((id) => ({ id })) },
        }),
        ...(changes.confidentialityImpactLevel !== undefined && {
          confidentialityImpactLevel: changes.confidentialityImpactLevel,
        }),
        ...(changes.integrityImpactLevel !== undefined && {
          integrityImpactLevel: changes.integrityImpactLevel,
        }),
        ...(changes.availabilityImpactLevel !== undefined && {
          availabilityImpactLevel: changes.availabilityImpactLevel,
        }),
      },
    }),
    deleteOp,
    createOp,
  ]);

  return { added, removed: removed.count };
}

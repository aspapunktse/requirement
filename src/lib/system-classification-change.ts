import type { ImpactLevel, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  getApplicableControls,
  diffApplicabilityOps,
  type SystemClassification,
} from "@/lib/control-assessments";
import { logChangeEvent } from "@/lib/change-events";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/**
 * Who may change a System's classification — its declared Deployment
 * Facets, declared Regulatory Overlays, or Impact Level axes: ADMIN, or the
 * System's owner (`ownerId`, whatever their role — see
 * `isSystemOwnerOrAdmin`). One shared rule across all three axes — see
 * ADR 0003.
 *
 * There is no lifecycle check: classification can change at any stage
 * (ADR 0006 removed the Draft-only lock that #51/ADR 0003 had put on it,
 * along with the matching locks on Capabilities, Regulatory Overlays and
 * Framework Scope). A System lives for years after onboarding and what
 * applies to it keeps changing, so the change is recorded and the recompute
 * runs; it never touches the System's status or its Approval history.
 */
export function canChangeSystemClassification(
  user: { id: string; role: UserRole },
  system: { ownerId: string },
) {
  return isSystemOwnerOrAdmin(user, system);
}

export type ClassificationChanges = {
  deploymentFacetIds?: string[];
  confidentialityImpactLevel?: ImpactLevel | null;
  integrityImpactLevel?: ImpactLevel | null;
  availabilityImpactLevel?: ImpactLevel | null;
};

/**
 * Change a System's classification (at any lifecycle stage, ADR 0006) — any combination of Deployment
 * Facets and/or Impact Level axes in one call — and recompute its
 * Control Assessment set to match: create NOT_STARTED rows for newly-
 * applicable Controls, and remove rows for no-longer-applicable ones —
 * but only if untouched (still NOT_STARTED and never manually edited, i.e.
 * assessedById is null). A Control Assessment a human has already
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
 *
 * Only the classification and the Assessment rows are written. The System's
 * `status`, `onboardedAt` and Approval history are never touched, so an
 * Approved or Onboarded System stays that way while its newly applicable
 * Controls show up as Not Started (F-AP.4).
 */
export async function changeSystemClassification(
  system: SystemClassification & { id: string },
  changes: ClassificationChanges,
  actorId: string,
) {
  const newClassification: SystemClassification = {
    deploymentFacets:
      changes.deploymentFacetIds !== undefined
        ? changes.deploymentFacetIds.map((id) => ({ id }))
        : system.deploymentFacets,
    regulatoryOverlays: system.regulatoryOverlays,
    frameworkScopes: system.frameworkScopes,
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
    getApplicableControls(system),
    getApplicableControls(newClassification),
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

  await logChangeEvent(
    system.id,
    "CLASSIFICATION_CHANGED",
    `Classification changed (+${added}/-${removed.count} Control Assessment(s))`,
    actorId,
  );

  return { added, removed: removed.count };
}

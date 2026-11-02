import type { ImpactLevel, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffApplicabilityOps, getApplicableControls, type SystemClassification } from "@/lib/control-assessments";
import { logChangeEvent } from "@/lib/change-events";
import { reconcileReviewSteps } from "@/lib/review-steps";
import { recordProviderChange } from "@/lib/provider-inheritance";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

/**
 * Who may change a System's classification — its declared Deployment
 * Facets, Sensitivity Level or Impact Level axes: ADMIN, or the System's owner (`ownerId`,
 * whatever their role — see `isSystemOwnerOrAdmin`). One shared rule across
 * the axes — see ADR 0003.
 *
 * There is no lifecycle check: classification can change at any stage
 * (ADR 0006 removed the Draft-only lock that #51/ADR 0003 had put on it,
 * along with the matching locks on Framework Scope). A System lives for years after onboarding and what
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
  /** The System's Sensitivity Level, 1 to 5 (ADR 0011). */
  sensitivityLevel?: number | null;
  integrityImpactLevel?: ImpactLevel | null;
  availabilityImpactLevel?: ImpactLevel | null;
};

/**
 * Change a System's classification (at any lifecycle stage, ADR 0006) — any combination of Deployment
 * Facets, Sensitivity Level and/or Impact Level axes in one call — and recompute its
 * Control Assessment set to match: create rows for newly-applicable Controls
 * (NOT_STARTED), and remove rows for no-longer-applicable ones —
 * but only if untouched (still NOT_STARTED and never manually edited, i.e.
 * assessedById is null). A Control Assessment a human has already
 * worked on is left in place even though it's no longer applicable; it
 * becomes visible via getStaleAssessments so the System Owner can resolve
 * it manually.
 *
 * The diff is computed once against the *combined* old -> new transition
 * (not once per changed axis), so a request that changes both Facets and an
 * Impact Level at once produces one correct recompute rather than two
 * partially-overlapping ones. Framework Scope declare/remove goes through the
 * same diffApplicabilityOps helper via `src/lib/framework-scope.ts` instead of
 * this function, since it has its own single-item connect/disconnect API
 * shape — but the recompute logic itself is shared. This is the generalization of the old System-Type-only
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
  system: SystemClassification & { id: string; isProvider?: boolean },
  changes: ClassificationChanges,
  actorId: string,
) {
  // A Provider's Offerings can start or stop applying to it, which moves its dependents (#124, F-IN.7).
  return recordProviderChange(system, () => applyClassificationChange(system, changes, actorId));
}

/** "Sensitive" for 3, "not set" for null; falls back to the number if the row is missing. */
async function levelLabel(tx: Pick<Prisma.TransactionClient, "sensitivityLevel">, level: number | null) {
  if (level === null) return "not set";
  const row = await tx.sensitivityLevel.findUnique({ where: { level }, select: { label: true } });
  return row?.label ?? String(level);
}

async function applyClassificationChange(
  system: SystemClassification & { id: string },
  changes: ClassificationChanges,
  actorId: string,
) {
  const newClassification: SystemClassification = {
    deploymentFacets:
      changes.deploymentFacetIds !== undefined
        ? changes.deploymentFacetIds.map((id) => ({ id }))
        : system.deploymentFacets,
    frameworkScopes: system.frameworkScopes,
    sensitivityLevel: changes.sensitivityLevel !== undefined ? changes.sensitivityLevel : system.sensitivityLevel,
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

  // The classification, the Assessment rows and the Change Event commit together; every query uses `tx`.
  const { added, removed } = await prisma.$transaction(async (tx) => {
    const { added, deleteOp, createOp } = diffApplicabilityOps(system.id, oldApplicable, newApplicable, tx);
    const before = await tx.system.findUniqueOrThrow({ where: { id: system.id }, select: { sensitivityLevel: true } });
    await tx.system.update({
      where: { id: system.id },
      data: {
        ...(changes.deploymentFacetIds !== undefined && {
          deploymentFacets: { set: changes.deploymentFacetIds.map((id) => ({ id })) },
        }),
        ...(changes.sensitivityLevel !== undefined && { sensitivityLevel: changes.sensitivityLevel }),
        ...(changes.integrityImpactLevel !== undefined && {
          integrityImpactLevel: changes.integrityImpactLevel,
        }),
        ...(changes.availabilityImpactLevel !== undefined && {
          availabilityImpactLevel: changes.availabilityImpactLevel,
        }),
      },
    });
    const removed = await deleteOp;
    await createOp;

    let detail = `Classification changed (+${added}/-${removed.count} Control Assessment(s))`;
    if (changes.sensitivityLevel !== undefined && changes.sensitivityLevel !== before.sensitivityLevel) {
      detail += `; Sensitivity Level: ${await levelLabel(tx, before.sensitivityLevel)} → ${await levelLabel(tx, changes.sensitivityLevel)}`;
    }
    await logChangeEvent(system.id, "CLASSIFICATION_CHANGED", detail, actorId, tx);
    return { added, removed };
  });

  // A Deployment Facet or Impact Level change can move a Review Group's remit while In Review (#199).
  await reconcileReviewSteps(system.id);

  return { added, removed: removed.count };
}

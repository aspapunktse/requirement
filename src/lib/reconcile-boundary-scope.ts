import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffApplicabilityOps, getApplicableControls } from "@/lib/control-assessments";
import { SYSTEM_ACTOR, logChangeEvent } from "@/lib/change-events";
import { readClassification, startOrWidenChangeReview } from "@/lib/change-review";
import { beginScopeChangeFrom } from "@/lib/framework-scope";
import { reconcileReviewSteps } from "@/lib/review-steps";

/**
 * One-off reconciliation for Compliance Boundaries that had members before their Frameworks took effect (#418 shipped first,
 * #419 made a Boundary's Frameworks part of each member's effective Framework Scope). From that deploy on the members' applicable
 * Controls widen at once, but nothing had synced their Assessments or started a Change Review. This does it, per System in its own
 * transaction, like the scope change it stands for: the "before" is the declared-only scope (the effective scope without the
 * Frameworks only a Boundary brings), the "after" is the effective scope.
 *
 * Idempotent: it counts the Assessment rows actually created and deleted, logs the Change Event and starts or widens a Change
 * Review only when rows were created, so a second run finds everything in place and changes nothing.
 */

export type ReconcileSystemResult = { systemId: string; name: string; added: number; removed: number; changeReview: "none" | "started or widened" };
export type ReconcileSummary = { applied: boolean; systems: ReconcileSystemResult[]; added: number; removed: number; reviews: number };

/** Thrown to roll a dry run back after it has computed what it would write. */
class DryRunRollback extends Error {}

async function reconcileSystem(tx: Prisma.TransactionClient, systemId: string, name: string): Promise<ReconcileSystemResult> {
  const before = await beginScopeChangeFrom(tx, systemId, async (current) => {
    const declared = await tx.system.findUniqueOrThrow({ where: { id: systemId }, select: { frameworkScopes: { select: { id: true } } } });
    return { ...current, frameworkScopes: declared.frameworkScopes };
  });
  const classification = await readClassification(tx, systemId);
  const applicable = await getApplicableControls(classification, {}, tx);
  const { deleteOp, createOp } = diffApplicabilityOps(systemId, before.applicable, applicable, tx, SYSTEM_ACTOR);
  const removed = (await deleteOp).count;
  const added = (await createOp).count;
  if (added === 0 && removed === 0) return { systemId, name, added, removed, changeReview: "none" };
  await logChangeEvent(
    systemId,
    "CLASSIFICATION_CHANGED",
    `Framework Scope reconciled for Compliance Boundary membership (+${added}/-${removed} Control Assessment(s))`,
    SYSTEM_ACTOR,
    tx,
  );
  const review = added > 0 ? await startOrWidenChangeReview(tx, systemId, before.classification, SYSTEM_ACTOR) : null;
  return { systemId, name, added, removed, changeReview: review ? "started or widened" : "none" };
}

/** Every System with a Boundary membership (or only `onlySystemIds` of them, for tests), one transaction each; with `apply` false each is rolled back after it computed its result. */
export async function reconcileBoundaryScope({ apply, onlySystemIds }: { apply: boolean; onlySystemIds?: string[] }): Promise<ReconcileSummary> {
  const members = await prisma.system.findMany({
    where: { boundaryMemberships: { some: {} }, ...(onlySystemIds ? { id: { in: onlySystemIds } } : {}) }, select: { id: true, name: true },
    orderBy: { id: "asc" },
  });
  const systems: ReconcileSystemResult[] = [];
  for (const { id, name } of members) {
    let result: ReconcileSystemResult | undefined;
    try {
      await prisma.$transaction(
        async (tx) => {
          result = await reconcileSystem(tx, id, name);
          if (!apply) throw new DryRunRollback();
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    } catch (error) {
      if (!(error instanceof DryRunRollback)) throw error;
    }
    if (result) {
      systems.push(result);
      if (apply && (result.added > 0 || result.removed > 0)) await reconcileReviewSteps(id);
    }
  }
  return {
    applied: apply,
    systems,
    added: systems.reduce((sum, system) => sum + system.added, 0),
    removed: systems.reduce((sum, system) => sum + system.removed, 0),
    reviews: systems.filter((system) => system.changeReview !== "none").length,
  };
}

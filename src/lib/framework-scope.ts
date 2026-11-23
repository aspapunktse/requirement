import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffApplicability, diffApplicabilityOps, getApplicableControls, type SystemClassification } from "@/lib/control-assessments";
import { frameworksInScopeOfSystem, systemsWithFrameworkInScope } from "@/lib/effective-framework-scope";
import { logChangeEvent } from "@/lib/change-events";
import { reconcileReviewSteps, reconcileReviewStepsIn } from "@/lib/review-steps";
import { readClassification, startOrWidenChangeReview } from "@/lib/change-review";
import { lockSystem } from "@/lib/system-lock";
import { recordProviderChange, recordProvidersChange } from "@/lib/provider-inheritance";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";
import { declinesForRemoval } from "@/lib/framework-suggestions-data";

/**
 * Who may declare or undeclare a System's Framework Scope: ADMIN, or the
 * System's owner (`ownerId`, whatever their role), at any lifecycle stage.
 * Framework Scope *drives* which Controls apply to the System (ADR 0007), so
 * this is one of the applicability-changing mechanisms whose Draft-only lock
 * ADR 0006 removed; every change goes through the same recompute and never
 * touches the System's onboarding status.
 */
export function canManageFrameworkScopes(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  return isSystemOwnerOrAdmin(user, system);
}

/**
 * A System's *effective* Framework Scope as shown to users: the Frameworks it declares, the Frameworks of every Compliance
 * Boundary it is in (#419), and the base Framework, which is always in scope whether or not a row is stored for it (each item
 * carries `isBase` so the UI can show it as fixed). Declared rows pointing at a Draft Framework are included too (they're inert,
 * see getApplicableControls) so a Compliance Manager can still see and remove them. Pass a transaction client to read in the
 * caller's snapshot.
 */
export async function getSystemFrameworkScopes(systemId: string, db: Pick<Prisma.TransactionClient, "framework"> = prisma) {
  return db.framework.findMany({
    where: { OR: [{ isBase: true }, frameworksInScopeOfSystem(systemId)] },
    orderBy: [{ name: "asc" }, { version: "asc" }],
  });
}

/** Where one Framework in a System's effective scope comes from: declared on the System, held by Boundaries it is in, or both. */
export type FrameworkScopeSource = {
  framework: { id: string; name: string; version: string; status: string; isBase: boolean };
  declared: boolean;
  boundaries: { id: string; name: string }[];
};

/**
 * Each Framework in the System's effective scope with its source (#419): the Profile tab shows a Boundary-only one as "via
 * <Boundary>" (the owner can't remove it), and a declared one that no Boundary holds as "Prepared for <Framework> · in no
 * Boundary". The base Framework is listed too, with `declared` true only if a row is stored for it. Sorted like
 * `getSystemFrameworkScopes`. Pass a transaction client to read in the caller's snapshot.
 */
export async function getSystemFrameworkScopeSources(
  systemId: string,
  db: Pick<Prisma.TransactionClient, "framework" | "system"> = prisma,
): Promise<FrameworkScopeSource[]> {
  // Sequential, so it is also safe on a transaction client (one connection).
  const frameworks = await getSystemFrameworkScopes(systemId, db);
  const row = await db.system.findUnique({
    where: { id: systemId },
    select: {
      frameworkScopes: { select: { id: true } },
      boundaryMemberships: {
        select: { boundary: { select: { id: true, name: true, frameworks: { select: { frameworkId: true } } } } },
        orderBy: { boundary: { name: "asc" } },
      },
    },
  });
  const declared = new Set((row?.frameworkScopes ?? []).map((framework) => framework.id));
  const memberships = row?.boundaryMemberships ?? [];
  return frameworks.map((framework) => ({
    framework: { id: framework.id, name: framework.name, version: framework.version, status: framework.status, isBase: framework.isBase },
    declared: declared.has(framework.id),
    boundaries: memberships
      .filter(({ boundary }) => boundary.frameworks.some((held) => held.frameworkId === framework.id))
      .map(({ boundary }) => ({ id: boundary.id, name: boundary.name })),
  }));
}

/**
 * The shape the Framework Scope routes return and the Profile tab reads: each Framework in the effective scope with where it
 * comes from (#419). `boundaries` is empty for a declared-only Framework, `declared` false for a Boundary-only one (the owner
 * can't remove it). The base Framework is exempt from the "in no Boundary" note, the UI shows it as always in scope.
 */
export async function getSystemFrameworkScopeItems(systemId: string, db: Pick<Prisma.TransactionClient, "framework" | "system"> = prisma) {
  return (await getSystemFrameworkScopeSources(systemId, db)).map((source) => ({
    ...source.framework,
    declared: source.declared,
    boundaries: source.boundaries,
  }));
}

/**
 * Systems with `framework` in their *effective* Framework Scope: the ones that declared it, the ones in a Compliance Boundary
 * that holds it (#419), or every System when it's the base Framework (always in scope, whether or not a row is stored for it,
 * see getSystemFrameworkScopes). The one definition of "Systems in scope of Framework F", shared by the applicability
 * recompute and the Business Risk Owner views / Compliance Percentage (#90).
 */
export function systemsInScopeOf(framework: { id: string; isBase: boolean }): Prisma.SystemWhereInput {
  return framework.isBase ? {} : systemsWithFrameworkInScope({ id: framework.id });
}

/**
 * The Compliance Boundaries of the System that hold `frameworkId`, when the System has not declared it: the Framework is in its
 * scope only through them, so its owner can't remove it (#419); leaving the Boundary, or the Boundary dropping it, is the only
 * way out. Empty when the Framework is declared (it stays while either holds), or no Boundary of the System holds it.
 */
export async function boundariesBringingOnly(
  systemId: string,
  frameworkId: string,
  db: Pick<Prisma.TransactionClient, "system" | "complianceBoundary"> = prisma,
): Promise<{ id: string; name: string }[]> {
  // Sequential, so it is also safe on a transaction client (one connection).
  const declared = await db.system.count({ where: { id: systemId, frameworkScopes: { some: { id: frameworkId } } } });
  if (declared > 0) return [];
  return db.complianceBoundary.findMany({
    where: { frameworks: { some: { frameworkId } }, systems: { some: { systemId } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** The 409 text for removing a Framework that only a Compliance Boundary brings into the System's scope. */
export const boundaryOnlyRefusal = (boundaries: { name: string }[]) =>
  `That Framework is in this System's Framework Scope through ${boundaries.length === 1 ? "the Compliance Boundary" : "the Compliance Boundaries"} ${boundaries.map((boundary) => `"${boundary.name}"`).join(", ")} and isn't declared on the System. It leaves the scope only when the System leaves ${boundaries.length === 1 ? "that Boundary" : "those Boundaries"} or ${boundaries.length === 1 ? "it drops" : "they drop"} the Framework`;

type ScopeSystem = { id: string; isProvider?: boolean };

/** The System as it stands before a scope change: its locked, effective classification and the Controls applicable under it. */
export type ScopeBefore = { classification: SystemClassification; applicable: { id: string }[] };

/**
 * First half of a scope change, inside the caller's transaction (every query on `tx`): takes the System lock, then reads the
 * classification (its effective Framework Scope included) and the applicable Controls as they are now. Do the change, then call
 * `finishScopeChange` with what this returned. A fan-out over several Systems locks them in id order first.
 */
export async function beginScopeChange(tx: Prisma.TransactionClient, systemId: string): Promise<ScopeBefore> {
  return beginScopeChangeFrom(tx, systemId, async (current) => current);
}

/**
 * `beginScopeChange` for a change that already happened and was never reconciled (the one-off
 * `scripts/reconcile-boundary-scope.ts`): the "before" is not the locked state but the state that should have been in force, which
 * `assume` derives from it (it runs after the System lock, on `tx`). The same lock, the same applicable-Controls read.
 */
export async function beginScopeChangeFrom(
  tx: Prisma.TransactionClient,
  systemId: string,
  assume: (current: SystemClassification) => Promise<SystemClassification>,
): Promise<ScopeBefore> {
  await lockSystem(tx, systemId);
  return readScopeBefore(tx, systemId, assume); // the locked state, for the Change Review (#334)
}

/** The classification (assumed through `assume`) and the Controls applicable under it, with no lock taken: the read half of `beginScopeChangeFrom`. */
async function readScopeBefore(
  tx: Prisma.TransactionClient,
  systemId: string,
  assume: (current: SystemClassification) => Promise<SystemClassification>,
): Promise<ScopeBefore> {
  const classification = await assume(await readClassification(tx, systemId));
  return { classification, applicable: await getApplicableControls(classification, {}, tx) };
}

/**
 * The System's classification as it would be with `frameworkIds` added to its effective Framework Scope: the same sorted,
 * de-duplicated id list `readClassification` yields once a Boundary holding them has the System as a member.
 */
export function withFrameworksInScope(classification: SystemClassification, frameworkIds: string[]): SystemClassification {
  const ids = [...new Set([...classification.frameworkScopes.map((framework) => framework.id), ...frameworkIds])].sort();
  return { ...classification, frameworkScopes: ids.map((id) => ({ id })) };
}

/**
 * What adding `frameworkIds` to the System's effective Framework Scope would do, computed read-only (no lock, no write; #423):
 * the classification and applicable Controls as they are (`before`, read exactly as `beginScopeChange` reads them) and with the
 * Frameworks added (`after`, from the same `getApplicableControls` that `finishScopeChange` recomputes with). `joinBoundaryIn`
 * writes what this predicts, so the join preview and the real join can't disagree on the Controls. Run it in a RepeatableRead
 * transaction so both reads see one snapshot.
 */
export async function previewScopeAddition(tx: Prisma.TransactionClient, systemId: string, frameworkIds: string[]) {
  const before = await readScopeBefore(tx, systemId, async (current) => current);
  const afterClassification = withFrameworksInScope(before.classification, frameworkIds);
  const afterApplicable = await getApplicableControls(afterClassification, {}, tx);
  const { newlyApplicableIds } = diffApplicability(before.applicable, afterApplicable);
  const newIds = new Set(newlyApplicableIds);
  return {
    before,
    afterClassification,
    newlyApplicable: afterApplicable.filter((control) => newIds.has(control.id)),
  };
}

const sameIds = (a: { id: string }[], b: { id: string }[]) => a.length === b.length && a.every((item, i) => item.id === b[i].id);

export type ScopeChangeResult = { added: number; removed: number; changed: boolean };

/**
 * Second half of a scope change, after the change itself was written on `tx`: reads the effective scope again, syncs the
 * Assessment rows the way a classification change does (`diffApplicabilityOps`: untouched ones of Controls that stopped
 * applying are removed, touched ones are kept and show as stale; new ones start Not Started), logs the Change Event
 * and starts or widens a Change Review on an Onboarded System (#334), all on `tx`. `describe` words the Change Event; with
 * `logUnchanged` false nothing is logged when the applicable Controls did not change (a Boundary change that moved nothing here).
 * The caller reconciles Review Steps after the commit (`reconcileReviewSteps`).
 */
export async function finishScopeChange(
  tx: Prisma.TransactionClient,
  systemId: string,
  before: ScopeBefore,
  actorId: string,
  options: { describe: (added: number, removed: number) => string; logUnchanged: boolean },
): Promise<ScopeChangeResult> {
  const classification = await readClassification(tx, systemId);
  // A Boundary change that left this System's effective scope as it was changes nothing here: skip the recompute.
  if (!options.logUnchanged && sameIds(before.classification.frameworkScopes, classification.frameworkScopes)) {
    return { added: 0, removed: 0, changed: false };
  }
  const newApplicable = await getApplicableControls(classification, {}, tx);
  const { added, deleteOp, createOp } = diffApplicabilityOps(systemId, before.applicable, newApplicable, tx);
  const removed = (await deleteOp).count;
  await createOp;
  const changed = added > 0 || diffApplicability(before.applicable, newApplicable).noLongerApplicableIds.length > 0;
  if (changed || options.logUnchanged) {
    await logChangeEvent(systemId, "CLASSIFICATION_CHANGED", options.describe(added, removed), actorId, tx);
  }
  await startOrWidenChangeReview(tx, systemId, before.classification, actorId);
  return { added, removed, changed };
}

/**
 * Declaring a Framework Scope can widen the applicable Control set (every Control mapped to a Requirement of the Framework, if
 * it's Published). Syncs Assessment rows the same way a classification change does (see `finishScopeChange`), with the scope
 * row, the deletes and the creates in one transaction. Declaring a Framework that's already in effective scope (declared, or
 * held by one of the System's Boundaries) is a no-op diff: the declared row is still added.
 */
export async function applyFrameworkScopeDeclared(system: ScopeSystem, framework: { id: string; name: string }, actorId: string) {
  // A Provider's Offerings can start or stop applying to it, which moves its dependents (#124, F-IN.7).
  return recordProviderChange(system, () => declareFrameworkScope(system, framework, actorId));
}

async function declareFrameworkScope(system: ScopeSystem, framework: { id: string; name: string }, actorId: string) {
  // The scope row, the Assessment sync, the Change Event and any Change Review (#334) commit together; every query uses `tx`.
  const result = await prisma.$transaction(async (tx) => {
    const before = await beginScopeChange(tx, system.id);
    await tx.system.update({ where: { id: system.id }, data: { frameworkScopes: { connect: { id: framework.id } } } });
    return finishScopeChange(tx, system.id, before, actorId, {
      describe: (added, removed) => describeFrameworkScopeAdded(framework.name, added, removed),
      logUnchanged: true,
    });
  });
  await reconcileReviewSteps(system.id);

  return { added: result.added, removed: result.removed };
}

/**
 * `applyFrameworkScopeDeclared` inside a transaction the caller holds (the onboarding create, #258): the same recompute,
 * Assessment sync, Change Event and Review Step reconciliation, every query on `tx` (a query on the global client inside an
 * interactive transaction needs a second connection and deadlocks a small pool). Refuses a System that is a Provider: recording
 * what the change moved on its dependents (`recordProviderChange`) is not atomic with the change, so it can't run inside one; a
 * System being created is never a Provider and has no dependents.
 */
export async function applyFrameworkScopeDeclaredIn(
  tx: Prisma.TransactionClient,
  system: ScopeSystem,
  framework: { id: string; name: string },
  actorId: string,
) {
  if (system.isProvider) throw new Error("applyFrameworkScopeDeclaredIn does not support a System that is a Provider");
  const before = await beginScopeChange(tx, system.id);
  await tx.system.update({ where: { id: system.id }, data: { frameworkScopes: { connect: { id: framework.id } } } });
  const { added, removed } = await finishScopeChange(tx, system.id, before, actorId, {
    describe: (addedCount, removedCount) => describeFrameworkScopeAdded(framework.name, addedCount, removedCount),
    logUnchanged: true,
  });
  await reconcileReviewStepsIn(tx, system.id);

  return { added, removed };
}

/** The Change Event wording of a declared Framework Scope, shared by both ways of declaring one. */
function describeFrameworkScopeAdded(frameworkName: string, added: number, removed: number) {
  return `Framework Scope "${frameworkName}" added (+${added}/-${removed} Control Assessment(s))`;
}

/**
 * Removing a Framework from a System's declared scope can narrow the applicable Control set. An untouched Assessment for a
 * Control that's no longer applicable is removed; one a human has already worked on is left in place and surfaced via
 * getStaleAssessments. The caller must have refused the base Framework first (it can't be removed, F-FW.3) and a Framework
 * that only a Compliance Boundary brings in (it isn't declared; #419). A Framework that is both declared and held by a Boundary
 * stays in effective scope, so nothing changes but the declared row.
 */
export async function applyFrameworkScopeRemoved(system: ScopeSystem, framework: { id: string; name: string }, actorId: string) {
  // See applyFrameworkScopeDeclared.
  return recordProviderChange(system, () => removeFrameworkScope(system, framework, actorId));
}

/** Thrown inside the removal transaction (so it rolls back, nothing written) when a Boundary alone holds the Framework. The route answers 409. */
export class BoundaryOnlyFrameworkError extends Error {
  constructor(boundaries: { name: string }[]) {
    super(boundaryOnlyRefusal(boundaries));
  }
}

async function removeFrameworkScope(system: ScopeSystem, framework: { id: string; name: string }, actorId: string) {
  // The scope row, the Assessment sync, the decline, the Change Event and any Change Review (#334) commit together; every query uses `tx`.
  const result = await prisma.$transaction(async (tx) => {
    const before = await beginScopeChange(tx, system.id);
    // Checked under the System lock, on `tx`: a concurrent leave or Framework drop can't slip between this check and the removal (#419).
    const viaBoundaries = await boundariesBringingOnly(system.id, framework.id, tx);
    if (viaBoundaries.length > 0) throw new BoundaryOnlyFrameworkError(viaBoundaries);
    // Taking out a Framework a declared Information Type suggests is the owner's decision (ADR 0013): it is recorded in the same
    // transaction, so the System is not flagged for what the owner just removed.
    const declines = await declinesForRemoval(tx, system.id, framework.id);
    await tx.system.update({ where: { id: system.id }, data: { frameworkScopes: { disconnect: { id: framework.id } } } });
    const result = await finishScopeChange(tx, system.id, before, actorId, {
      describe: (added, removed) => `Framework Scope "${framework.name}" removed (+${added}/-${removed} Control Assessment(s))`,
      logUnchanged: true,
    });
    await tx.frameworkSuggestionDecline.createMany({ data: declines, skipDuplicates: true });
    return result;
  });
  await reconcileReviewSteps(system.id);

  return { added: result.added, removed: result.removed };
}

/**
 * The Systems that are Providers among `systemIds`, wrapped around `change` with one `recordProvidersChange` (#124), so a pair
 * reached through several Providers logs one event: a scope change on a Provider moves the effective status its dependents inherit. Not atomic with `change`, as
 * `recordProviderChange` says.
 */
export async function recordProviderChanges<T>(systemIds: string[], change: () => Promise<T>): Promise<T> {
  const providers = systemIds.length === 0 ? [] : await prisma.system.findMany({ where: { id: { in: systemIds }, isProvider: true }, select: { id: true, isProvider: true } });
  return recordProvidersChange(providers, change);
}

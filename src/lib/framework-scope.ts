import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { diffApplicabilityOps, getApplicableControls, type SystemClassification } from "@/lib/control-assessments";
import { logChangeEvent } from "@/lib/change-events";
import { reconcileReviewSteps } from "@/lib/review-steps";
import { recordProviderChange } from "@/lib/provider-inheritance";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";

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
 * A System's Framework Scope as shown to users: every declared scope row, plus
 * the base Framework, which is always in scope whether or not a row is stored
 * for it (each item carries `isBase` so the UI can show it as fixed). Declared
 * rows pointing at a Draft Framework are included too (they're inert, see
 * getApplicableControls) so a Compliance Manager can still see and remove them.
 */
export async function getSystemFrameworkScopes(systemId: string) {
  const [declared, base] = await Promise.all([
    prisma.framework.findMany({ where: { scopedSystems: { some: { id: systemId } } } }),
    prisma.framework.findFirst({ where: { isBase: true } }),
  ]);
  const frameworks = base && !declared.some((f) => f.id === base.id) ? [...declared, base] : declared;
  return frameworks.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

/**
 * Systems with `framework` in their *effective* Framework Scope: the ones that
 * declared it, or every System when it's the base Framework (always in scope,
 * whether or not a row is stored for it, see getSystemFrameworkScopes). The one
 * definition of "Systems in scope of Framework F", shared by the applicability
 * recompute and the Business Risk Owner views / Compliance Percentage (#90).
 */
export function systemsInScopeOf(framework: { id: string; isBase: boolean }): Prisma.SystemWhereInput {
  return framework.isBase ? {} : { frameworkScopes: { some: { id: framework.id } } };
}

type ScopeSystem = SystemClassification & { id: string; isProvider?: boolean };

/**
 * Declaring a Framework Scope can widen the applicable Control set (every
 * Control mapped to a Requirement of the Framework, if it's Published). Syncs
 * Assessment rows the same way a classification change does — see
 * diffApplicabilityOps — with the scope row, the deletes and the creates in
 * one transaction. Declaring a Framework that's already in scope is a no-op diff.
 */
export async function applyFrameworkScopeDeclared(
  system: ScopeSystem,
  framework: { id: string; name: string },
  actorId: string,
) {
  // A Provider's Offerings can start or stop applying to it, which moves its dependents (#124, F-IN.7).
  return recordProviderChange(system, () => declareFrameworkScope(system, framework, actorId));
}

async function declareFrameworkScope(system: ScopeSystem, framework: { id: string; name: string }, actorId: string) {
  const newScopeIds = [...new Set([...system.frameworkScopes.map((f) => f.id), framework.id])];

  const [oldApplicable, newApplicable] = await Promise.all([
    getApplicableControls(system),
    getApplicableControls({ ...system, frameworkScopes: newScopeIds.map((id) => ({ id })) }),
  ]);

  const { added, deleteOp, createOp } = diffApplicabilityOps(system.id, oldApplicable, newApplicable);
  const [, removed] = await prisma.$transaction([
    prisma.system.update({
      where: { id: system.id },
      data: { frameworkScopes: { connect: { id: framework.id } } },
    }),
    deleteOp,
    createOp,
  ]);

  await logChangeEvent(
    system.id,
    "CLASSIFICATION_CHANGED",
    `Framework Scope "${framework.name}" added (+${added}/-${removed.count} Control Assessment(s))`,
    actorId,
  );
  await reconcileReviewSteps(system.id);

  return { added, removed: removed.count };
}

/**
 * Removing a Framework from a System's scope can narrow the applicable
 * Control set. An untouched Assessment for a Control that's no longer
 * applicable is removed; one a human has already worked on is left in place
 * and surfaced via getStaleAssessments. The caller must have refused the base
 * Framework first — it can't be removed (F-FW.3).
 */
export async function applyFrameworkScopeRemoved(
  system: ScopeSystem,
  framework: { id: string; name: string },
  actorId: string,
) {
  // See applyFrameworkScopeDeclared.
  return recordProviderChange(system, () => removeFrameworkScope(system, framework, actorId));
}

async function removeFrameworkScope(system: ScopeSystem, framework: { id: string; name: string }, actorId: string) {
  const newScopeIds = system.frameworkScopes.map((f) => f.id).filter((id) => id !== framework.id);

  const [oldApplicable, newApplicable] = await Promise.all([
    getApplicableControls(system),
    getApplicableControls({ ...system, frameworkScopes: newScopeIds.map((id) => ({ id })) }),
  ]);

  const { added, deleteOp, createOp } = diffApplicabilityOps(system.id, oldApplicable, newApplicable);
  const [, removed] = await prisma.$transaction([
    prisma.system.update({
      where: { id: system.id },
      data: { frameworkScopes: { disconnect: { id: framework.id } } },
    }),
    deleteOp,
    createOp,
  ]);

  await logChangeEvent(
    system.id,
    "CLASSIFICATION_CHANGED",
    `Framework Scope "${framework.name}" removed (+${added}/-${removed.count} Control Assessment(s))`,
    actorId,
  );
  await reconcileReviewSteps(system.id);

  return { added, removed: removed.count };
}

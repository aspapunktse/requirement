import type { OnboardingStatus, Prisma, UserRole } from "@prisma/client";
import { userCanDecideStep } from "@/lib/approvals";
import { prisma } from "@/lib/prisma";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";
import { APPLICABILITY_SCOPING } from "@/lib/control-assessments";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";
import {
  APPLICABLE_APPLICABILITIES,
  meetsAllImpactThresholds,
  type SystemClassification,
} from "@/lib/control-applicability";

/**
 * Review Rounds and Review Steps (CONTEXT.md, ADR 0010).
 *
 * A Review Round is stored (one per submission). Its Review Steps are not: they are
 * derived live from the System's Framework Scope and applicable Controls, so a scope
 * change while In Review adds or drops steps at once.
 */

export const BASE_REVIEW_STEP_NAME = "Base review";

export type ReviewStepStatus = "OPEN" | "APPROVED" | "REJECTED";

export type ReviewStep = {
  /** Null for the base Review Step, otherwise the Review Group whose step it is. */
  reviewGroupId: string | null;
  name: string;
  status: ReviewStepStatus;
  /** Set on an Open step that had approved and was reopened by an edit to its remit (#200): when, and why. */
  reopened?: { at: Date; reason: string };
};

/** What a Control must look like for `isBaseControl`: its mappings and the Framework of each Requirement. */
type ControlWithFrameworks = { mappings: { requirement: { framework: { isBase: boolean } } }[] };

/**
 * A **Base Control**: one mapped, at any Coverage, to at least one Requirement of the base
 * Framework (`Framework.isBase`). Base Controls always stay in the base Review Step's remit,
 * even when they also satisfy a Framework with a Review Group, so an Annex A Control is
 * never judged twice. Everything else is a non-base Control (in practice a Supplementary one).
 * This is the single definition of "base" for Review Steps; change it here only.
 */
export function isBaseControl(control: ControlWithFrameworks): boolean {
  return control.mappings.some(({ requirement }) => requirement.framework.isBase);
}


const CONTROL_FOR_REMIT = {
  mappings: {
    select: {
      requirement: {
        select: {
          framework: {
            select: {
              id: true,
              isBase: true,
              status: true,
              reviewGroup: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ControlInclude;

type ControlForRemit = Prisma.ControlGetPayload<{ include: typeof CONTROL_FOR_REMIT }>;

/**
 * Which Review Steps a Control belongs to, given the System's declared Framework Scope: the single
 * rule behind both "which groups have remit on a System" and "which steps does an edit to this
 * Control reopen". A base Control belongs to the base step only. Any other Control belongs to the
 * step of each Review Group tied to a Published, declared Framework it is mapped to, and to the base
 * step if it is also mapped to such a Framework with no group (those fall to the base step).
 * Applicability (facets, Impact Levels) is not looked at here.
 */
function stepsOfControl(control: ControlForRemit, declaredScopeIds: Set<string>) {
  const groups = new Map<string, string>();
  if (isBaseControl(control)) return { base: true, groups };
  let base = false;
  for (const { requirement } of control.mappings) {
    const { framework } = requirement;
    if (framework.status !== "PUBLISHED" || !declaredScopeIds.has(framework.id)) continue;
    if (framework.reviewGroup) groups.set(framework.reviewGroup.id, framework.reviewGroup.name);
    else base = true;
  }
  return { base, groups };
}

/**
 * The Review Groups that have at least one Control in their remit on the System: a non-base
 * Control that applies to the System (same rules as `getApplicableControls`: applicability,
 * Deployment Facets, Impact Levels, a Published Framework in scope) and is mapped to a
 * Requirement of a Published Framework of the group that is in the System's *declared*
 * Framework Scope. Two such Frameworks sharing a group give one entry. A Framework with no
 * group adds none; its non-base Controls fall to the base step.
 *
 * Takes the transaction client so the reads see one snapshot (see `loadReviewRounds`).
 */
export async function groupsWithRemit(tx: Prisma.TransactionClient, system: SystemClassification) {
  const controls = await tx.control.findMany({
    where: {
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(system),
    },
    include: CONTROL_FOR_REMIT,
  });

  const declaredScopeIds = new Set(system.frameworkScopes.map((framework) => framework.id));
  const groups = new Map<string, string>();
  for (const control of controls) {
    if (!meetsAllImpactThresholds(system, control)) continue;
    for (const [id, name] of stepsOfControl(control, declaredScopeIds).groups) groups.set(id, name);
  }
  return groups;
}

/**
 * Open question 2 on #200: a *stale* Control (no longer applicable, so in no live remit) whose
 * mappings point at no declared Published Framework reopens the base step when this is true (the
 * default, "2a"), and nothing when false. The one place to change it.
 */
const STALE_CONTROL_FALLS_BACK_TO_BASE_STEP = true;

/**
 * The ids of the Review Steps (`null` is the base step) whose remit contains `controlId` on the System,
 * by the same rule as `groupsWithRemit` but for one Control and without its applicability test: an
 * edit can be to a stale Control too (one a facet change left behind). Whether those steps are live
 * is for the caller to check against the current steps.
 */
export async function stepsContainingControl(tx: Tx, system: SystemClassification, controlId: string) {
  const control = await tx.control.findUnique({ where: { id: controlId }, include: CONTROL_FOR_REMIT });
  const ids = new Set<string | null>();
  if (!control) return ids;
  const { base, groups } = stepsOfControl(control, new Set(system.frameworkScopes.map((framework) => framework.id)));
  if (base) ids.add(null);
  for (const id of groups.keys()) ids.add(id);
  if (ids.size === 0 && STALE_CONTROL_FALLS_BACK_TO_BASE_STEP) ids.add(null);
  return ids;
}

type Tx = Prisma.TransactionClient;

type StepApproval = {
  reviewGroupId: string | null;
  decision: OnboardingStatus;
  decidedAt: Date;
  id: string;
  voidedAt?: Date | null;
  voidReason?: string | null;
};

/** The status of one step from the round's Approvals. Voided Approvals (a dropped step's) never count. */
function stepStatus(approvals: StepApproval[], reviewGroupId: string | null): ReviewStepStatus {
  const decisions = approvals
    .filter((approval) => approval.reviewGroupId === reviewGroupId && !approval.voidedAt)
    .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime() || a.id.localeCompare(b.id));
  const latest = decisions.at(-1);
  if (latest?.decision === "APPROVED") return "APPROVED";
  if (latest?.decision === "REJECTED") return "REJECTED";
  return "OPEN";
}

const SYSTEM_FOR_STEPS = {
  deploymentFacets: { select: { id: true } },
  frameworkScopes: { select: { id: true } },
} satisfies Prisma.SystemInclude;

/** The base step plus one step per live group (sorted by name), with statuses from `approvals`. */
function buildSteps(groups: Map<string, string>, approvals: StepApproval[]): ReviewStep[] {
  const step = (reviewGroupId: string | null, name: string): ReviewStep => {
    const status = stepStatus(approvals, reviewGroupId);
    if (status !== "OPEN") return { reviewGroupId, name, status };
    // An Open step whose latest void was an edit's (a reason is recorded) was reopened (#200).
    const reopening = approvals
      .filter((approval) => approval.reviewGroupId === reviewGroupId && approval.voidedAt && approval.voidReason)
      .sort((a, b) => a.voidedAt!.getTime() - b.voidedAt!.getTime())
      .at(-1);
    return reopening
      ? { reviewGroupId, name, status, reopened: { at: reopening.voidedAt!, reason: reopening.voidReason! } }
      : { reviewGroupId, name, status };
  };
  return [
    step(null, BASE_REVIEW_STEP_NAME),
    ...[...groups].sort(([, a], [, b]) => a.localeCompare(b)).map(([reviewGroupId, name]) => step(reviewGroupId, name)),
  ];
}

/**
 * Takes a row lock on the System, so decisions and reconciliations on it run one after another.
 * Call it first in a READ COMMITTED transaction (a REPEATABLE READ snapshot would be taken before
 * the wait and miss what the previous holder committed).
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: lockers still exclude each other, but the holder doesn't
 * block other transactions' inserts that reference the System (Change Events on a dependent of a
 * Provider), which would let two Provider transactions wait on each other's System rows (#200).
 */
export async function lockSystem(tx: Tx, systemId: string) {
  await tx.$queryRaw`SELECT "id" FROM "System" WHERE "id" = ${systemId} FOR NO KEY UPDATE`;
}

/**
 * The current Review Round and its live steps, read on `tx` and written to nothing. Null unless the
 * System exists and is In Review. An In Review System with no round (it should not happen after the
 * #198 migration) reads as all steps open.
 */
export async function readCurrentSteps(tx: Tx, systemId: string) {
  const system = await tx.system.findUnique({ where: { id: systemId }, include: SYSTEM_FOR_STEPS });
  if (!system || system.status !== "IN_REVIEW") return null;
  const round = await tx.reviewRound.findFirst({
    where: { systemId },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    include: { approvals: { orderBy: [{ decidedAt: "asc" }, { id: "asc" }] } },
  });
  const groups = await groupsWithRemit(tx, system);
  return { system, round, groups, steps: buildSteps(groups, round?.approvals ?? []) };
}

/**
 * Brings the current round in line with the live steps, on a System row the caller has locked
 * (`lockSystem`):
 * - a group's Approvals in the round whose step is no longer live are voided, so the step comes back
 *   Open if its remit returns during the same round (product-owner decision on #198/#199). Steps have
 *   no event of their own when they disappear, so this runs after every change that can move a
 *   System's remit (see `reconcileReviewSteps`) and again before every decision;
 * - when every remaining live step has approved, the System becomes Approved at once (a dropped step
 *   was the only thing left to wait for).
 * Returns the System's status afterwards. A System that isn't In Review is left alone.
 */
export async function settleReviewSteps(tx: Tx, systemId: string) {
  const current = await readCurrentSteps(tx, systemId);
  if (!current) return { status: null as null | "APPROVED" | "IN_REVIEW", current: null };
  const { round, groups } = current;
  if (round) {
    const liveIds = [...groups.keys()];
    await tx.approval.updateMany({
      where: {
        reviewRoundId: round.id,
        voidedAt: null,
        reviewGroupId: { not: null, notIn: liveIds },
      },
      data: { voidedAt: new Date() },
    });
  }
  const after = round ? await readCurrentSteps(tx, systemId) : current;
  if (after && after.steps.every((step) => step.status === "APPROVED")) {
    const moved = await tx.system.updateMany({ where: { id: systemId, status: "IN_REVIEW" }, data: { status: "APPROVED" } });
    if (moved.count > 0) {
      await logChangeEvent(
        systemId,
        "APPROVAL_DECIDED",
        "Approved: every remaining Review Step has approved",
        SYSTEM_ACTOR,
        tx,
      );
      return { status: "APPROVED" as const, current: after };
    }
  }
  return { status: "IN_REVIEW" as const, current: after };
}

/** `settleReviewSteps` for one System, in its own transaction. Call it right after a change to the System's remit. */
export async function reconcileReviewSteps(systemId: string) {
  try {
    await prisma.$transaction(async (tx) => {
      await lockSystem(tx, systemId);
      await settleReviewSteps(tx, systemId);
    });
  } catch (error) {
    // The change that called us has committed; a failure here must not turn it into a 500. The next
    // decision on the System settles again before it counts anything.
    console.error(`Could not reconcile the Review Steps of System ${systemId}`, error);
  }
}

/** `reconcileReviewSteps` for every System In Review, for a change to the catalog (Frameworks, Controls, ties). */
export async function reconcileAllReviewSteps() {
  const inReview = await prisma.system.findMany({ where: { status: "IN_REVIEW" }, select: { id: true } });
  for (const { id } of inReview) await reconcileReviewSteps(id);
}

/**
 * A System's Review Rounds (by id; its status and classification are re-read in the snapshot), newest first, each with its Approvals (oldest first), plus the
 * derived steps of the current round. The current round is the System's latest round, and only
 * while the System is In Review; otherwise `steps` is empty and `currentRoundId` null.
 *
 * One REPEATABLE READ transaction with every query on `tx`: the steps read several tables and a
 * nested include runs as several statements, so a concurrent delete would otherwise throw.
 * Approvals carry their deciding User (`approver`): the caller redacts it per viewer.
 */
export async function loadReviewRounds(systemId: string) {
  return prisma.$transaction(
    async (tx) => {
      const system = await tx.system.findUnique({ where: { id: systemId }, include: SYSTEM_FOR_STEPS });
      if (!system) return { rounds: [], currentRoundId: null, steps: [] as ReviewStep[] };

      const rounds = await tx.reviewRound.findMany({
        where: { systemId },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        include: {
          approvals: {
            orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
            include: { approver: { select: { id: true, name: true } }, reviewGroup: { select: { id: true, name: true } } },
          },
        },
      });

      if (system.status !== "IN_REVIEW") return { rounds, currentRoundId: null, steps: [] as ReviewStep[] };

      const current = rounds[0] ?? null;
      const groups = await groupsWithRemit(tx, system);
      return { rounds, currentRoundId: current?.id ?? null, steps: buildSteps(groups, current?.approvals ?? []) };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/**
 * The open Review Steps `user` can decide, for "My tasks": on Systems In Review that the user
 * doesn't own, the base step for a Reviewer or Admin, a group's step for a member of the group,
 * any open step for an Admin. One entry per System and step.
 */
export async function getOpenStepsForUser(user: { id: string; role: UserRole }) {
  const groupIds = (await prisma.reviewGroup.findMany({ where: { members: { some: { id: user.id } } }, select: { id: true } })).map(
    (group) => group.id,
  );
  const decidesAny = user.role === "ADMIN" || user.role === "REVIEWER";
  if (!decidesAny && groupIds.length === 0) return [];
  return prisma.$transaction(
    async (tx) => {
      const systems = await tx.system.findMany({
        where: {
          status: "IN_REVIEW",
          ownerId: { not: user.id },
          ...(decidesAny ? {} : { frameworkScopes: { some: { reviewGroupId: { in: groupIds } } } }),
        },
        orderBy: { updatedAt: "asc" },
        include: SYSTEM_FOR_STEPS,
      });
      const tasks: { system: (typeof systems)[number]; step: ReviewStep }[] = [];
      for (const system of systems) {
        const round = await tx.reviewRound.findFirst({
          where: { systemId: system.id },
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
          include: { approvals: true },
        });
        const steps = buildSteps(await groupsWithRemit(tx, system), round?.approvals ?? []);
        for (const step of steps) {
          if (step.status !== "OPEN") continue;
          if (userCanDecideStep(user, system.ownerId, groupIds, step.reviewGroupId)) tasks.push({ system, step });
        }
      }
      return tasks;
    },
    { isolationLevel: "RepeatableRead" },
  );
}

/**
 * Whose edit reopens an approved step (open question 1 on #200). Default ("1a"): any person's, so the
 * owner's, an Admin's and a Risk Owner's waive / Not Applicable. To narrow it to the owner and Admins
 * ("1b"), make this `isSystemOwnerOrAdmin(actor, system)` alone. The `"system"` actor is not a
 * person and never gets here (see `reopenStepsForEdit`).
 */
const ANY_PERSONS_EDIT_REOPENS = true as boolean;
export function editReopensSteps(actor: { id: string; role: UserRole }, system: { ownerId: string }) {
  return ANY_PERSONS_EDIT_REOPENS || isSystemOwnerOrAdmin(actor, system);
}

/**
 * A person has just changed the Control Assessment of `control` on a System (#200). Every approved
 * step of the current Review Round whose remit contains the Control goes back to Open, so the approval
 * no longer vouches for an answer that is gone: the step's live Approvals are voided with the reason
 * (they stay in the history) and one Change Event per reopened step is written on the System, actor
 * the editor, all on `tx`.
 *
 * The caller has already called `lockSystem(tx, systemId)` (first, in a READ COMMITTED transaction),
 * so this serialises with step decisions and with `settleReviewSteps`, and calls this only for an
 * edit that really changed the Assessment (`assessmentValuesChanged`, a reset to inherited, a stale
 * removal) by a person `editReopensSteps` allows. Not edits, so never calling this: inheritance
 * moving, a Nonconformity's `"system"` set-back, an applicability recompute, a reviewer raising a Query.
 * Does nothing unless the System is In Review. Returns the names of the steps it reopened.
 */
export async function reopenStepsForEdit(
  tx: Tx,
  systemId: string,
  control: { id: string; code: string },
  actorId: string,
) {
  const current = await readCurrentSteps(tx, systemId);
  if (!current || !current.round) return [];
  const remit = await stepsContainingControl(tx, current.system, control.id);
  const reopened: string[] = [];
  const reason = `${control.code} changed after approval`;
  const voidedAt = new Date();
  for (const step of current.steps) {
    if (step.status !== "APPROVED" || !remit.has(step.reviewGroupId)) continue;
    await tx.approval.updateMany({
      where: { reviewRoundId: current.round.id, reviewGroupId: step.reviewGroupId, voidedAt: null },
      data: { voidedAt, voidReason: reason },
    });
    await logChangeEvent(
      systemId,
      "REVIEW_STEP_REOPENED",
      `${step.reviewGroupId === null ? "Base review step" : `${step.name} Review Group step`} reopened: ${reason}`,
      actorId,
      tx,
    );
    reopened.push(step.name);
  }
  return reopened;
}

type StoredAssessment = {
  status: string;
  evidence: string | null;
  notes: string | null;
  selfAssessmentAnswer: string | null;
  assessedById: string | null;
} | null;

/**
 * Whether a person's save changes the Assessment, for `reopenStepsForEdit` (#200). Fields the save
 * leaves out (`undefined`) are not changed. Saving over a row nobody has worked on yet (no row, or one
 * not person-set) counts, because it makes the Assessment person-set, which overrides what the Control
 * inherits; re-sending the stored values of a person-set row does not.
 */
export function assessmentValuesChanged(
  previous: StoredAssessment,
  next: { status: string; evidence?: string | null; notes?: string | null; selfAssessmentAnswer?: string | null },
) {
  if (!previous || previous.assessedById === null) return true;
  return (
    previous.status !== next.status ||
    (next.evidence !== undefined && next.evidence !== previous.evidence) ||
    (next.notes !== undefined && next.notes !== previous.notes) ||
    (next.selfAssessmentAnswer !== undefined && next.selfAssessmentAnswer !== previous.selfAssessmentAnswer)
  );
}

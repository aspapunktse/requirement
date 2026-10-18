import type { OnboardingStatus, Prisma, UserRole } from "@prisma/client";
import { userCanDecideStep } from "@/lib/approvals";
import { prisma } from "@/lib/prisma";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";
import { APPLICABILITY_SCOPING } from "@/lib/control-assessments";
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

/**
 * The Review Groups in whose remit each Control of the System sits, keyed by Control id (a Control
 * in no group's remit is absent). A Control is in a group's remit when it is a non-base Control
 * that applies to the System (same rules as `getApplicableControls`: applicability, Deployment
 * Facets, Impact Levels, a Published Framework in scope) and is mapped to a Requirement of a
 * Published Framework of the group that is in the System's *declared* Framework Scope. A Framework
 * with no group adds none; its non-base Controls fall to the base step. This is the single
 * definition of a group's remit: `groupsWithRemit` and `groupsWhoseRemitIncludes` both read it.
 *
 * Takes the transaction client so the reads see one snapshot (see `loadReviewRounds`). `controlId`
 * narrows the read to one Control.
 */
export async function remitGroupsByControl(
  tx: Pick<Prisma.TransactionClient, "control">,
  system: SystemClassification,
  controlId?: string,
) {
  const controls = await tx.control.findMany({
    where: {
      ...(controlId !== undefined && { id: controlId }),
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(system),
    },
    include: CONTROL_FOR_REMIT,
  });

  const declaredScopeIds = new Set(system.frameworkScopes.map((framework) => framework.id));
  const byControl = new Map<string, Map<string, string>>();
  for (const control of controls) {
    if (!meetsAllImpactThresholds(system, control) || isBaseControl(control)) continue;
    for (const { requirement } of control.mappings) {
      const { framework } = requirement;
      if (framework.status !== "PUBLISHED" || !declaredScopeIds.has(framework.id) || !framework.reviewGroup) continue;
      const groups = byControl.get(control.id) ?? new Map<string, string>();
      groups.set(framework.reviewGroup.id, framework.reviewGroup.name);
      byControl.set(control.id, groups);
    }
  }
  return byControl;
}

/**
 * The Review Groups that have at least one Control in their remit on the System (id to name). Two
 * Frameworks sharing a group give one entry. See `remitGroupsByControl` for what a remit is.
 */
export async function groupsWithRemit(tx: Prisma.TransactionClient, system: SystemClassification) {
  const groups = new Map<string, string>();
  for (const forControl of (await remitGroupsByControl(tx, system)).values()) {
    for (const [id, name] of forControl) groups.set(id, name);
  }
  return groups;
}

/** The Review Groups (id to name) whose remit on the System includes the Control; empty for a base Control or one that doesn't apply. */
export async function groupsWhoseRemitIncludes(
  tx: Pick<Prisma.TransactionClient, "control">,
  system: SystemClassification,
  controlId: string,
) {
  return (await remitGroupsByControl(tx, system, controlId)).get(controlId) ?? new Map<string, string>();
}

type Tx = Prisma.TransactionClient;

type StepApproval = { reviewGroupId: string | null; decision: OnboardingStatus; decidedAt: Date; id: string };

/** The status of one step from the round's Approvals. Voided Approvals (a dropped step's) never count. */
function stepStatus(approvals: (StepApproval & { voidedAt?: Date | null })[], reviewGroupId: string | null): ReviewStepStatus {
  const decisions = approvals
    .filter((approval) => approval.reviewGroupId === reviewGroupId && !approval.voidedAt)
    .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime() || a.id.localeCompare(b.id));
  const latest = decisions.at(-1);
  if (latest?.decision === "APPROVED") return "APPROVED";
  if (latest?.decision === "REJECTED") return "REJECTED";
  return "OPEN";
}

/** What the remit and step reads need of a System: its Deployment Facets and declared Framework Scope. */
export const SYSTEM_FOR_STEPS = {
  deploymentFacets: { select: { id: true } },
  frameworkScopes: { select: { id: true } },
} satisfies Prisma.SystemInclude;

/** The base step plus one step per live group (sorted by name), with statuses from `approvals`. */
function buildSteps(
  groups: Map<string, string>,
  approvals: (StepApproval & { voidedAt?: Date | null })[],
): ReviewStep[] {
  return [
    { reviewGroupId: null, name: BASE_REVIEW_STEP_NAME, status: stepStatus(approvals, null) },
    ...[...groups]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([reviewGroupId, name]) => ({ reviewGroupId, name, status: stepStatus(approvals, reviewGroupId) })),
  ];
}

/**
 * Takes a row lock on the System, so decisions and reconciliations on it run one after another.
 * Call it first in a READ COMMITTED transaction (a REPEATABLE READ snapshot would be taken before
 * the wait and miss what the previous holder committed).
 */
export async function lockSystem(tx: Tx, systemId: string) {
  await tx.$queryRaw`SELECT "id" FROM "System" WHERE "id" = ${systemId} FOR UPDATE`;
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

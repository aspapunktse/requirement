import type { OnboardingStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
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
 * The Review Groups that have at least one Control in their remit on the System: a non-base
 * Control that applies to the System (same rules as `getApplicableControls`: applicability,
 * Deployment Facets, Impact Levels, a Published Framework in scope) and is mapped to a
 * Requirement of a Published Framework of the group that is in the System's *declared*
 * Framework Scope. Two such Frameworks sharing a group give one entry. A Framework with no
 * group adds none; its non-base Controls fall to the base step.
 *
 * Takes the transaction client so the reads see one snapshot (see `loadReviewRounds`).
 */
async function groupsWithRemit(tx: Prisma.TransactionClient, system: SystemClassification) {
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
    if (!meetsAllImpactThresholds(system, control) || isBaseControl(control)) continue;
    for (const { requirement } of control.mappings) {
      const { framework } = requirement;
      if (framework.status !== "PUBLISHED" || !declaredScopeIds.has(framework.id) || !framework.reviewGroup) continue;
      groups.set(framework.reviewGroup.id, framework.reviewGroup.name);
    }
  }
  return groups;
}

function stepStatus(
  approvals: { reviewGroupId: string | null; decision: OnboardingStatus; decidedAt: Date; id: string }[],
  reviewGroupId: string | null,
): ReviewStepStatus {
  const decisions = approvals
    .filter((approval) => approval.reviewGroupId === reviewGroupId)
    .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime() || a.id.localeCompare(b.id));
  const latest = decisions.at(-1);
  if (latest?.decision === "APPROVED") return "APPROVED";
  if (latest?.decision === "REJECTED") return "REJECTED";
  return "OPEN";
}

/**
 * A System's Review Rounds (by id; its status and classification are re-read in the snapshot), newest first, each with its Approvals (oldest first), plus the
 * derived steps of the current round. The current round is the System's latest round, and only
 * while the System is In Review; otherwise `steps` is empty and `currentRoundId` null. An In
 * Review System with no round (it should not happen after the #198 migration) reads as all
 * steps open.
 *
 * One REPEATABLE READ transaction with every query on `tx`: the steps read several tables and a
 * nested include runs as several statements, so a concurrent delete would otherwise throw.
 */
export async function loadReviewRounds(systemId: string) {
  return prisma.$transaction(
    async (tx) => {
      // Status and classification are read here, inside the snapshot, so the steps never mix
      // an older System with newer rounds. Visibility is the caller's check.
      const system = await tx.system.findUnique({
        where: { id: systemId },
        include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } },
      });
      if (!system) return { rounds: [], currentRoundId: null, steps: [] as ReviewStep[] };

      const rounds = await tx.reviewRound.findMany({
        where: { systemId },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        include: {
          approvals: {
            orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
            include: { approver: true, reviewGroup: { select: { id: true, name: true } } },
          },
        },
      });

      if (system.status !== "IN_REVIEW") return { rounds, currentRoundId: null, steps: [] as ReviewStep[] };

      const current = rounds[0] ?? null;
      const currentApprovals = current?.approvals ?? [];
      const groups = await groupsWithRemit(tx, system);
      const groupSteps: ReviewStep[] = [...groups]
        .sort(([, a], [, b]) => a.localeCompare(b))
        .map(([reviewGroupId, name]) => ({ reviewGroupId, name, status: stepStatus(currentApprovals, reviewGroupId) }));

      return {
        rounds,
        currentRoundId: current?.id ?? null,
        steps: [
          { reviewGroupId: null, name: BASE_REVIEW_STEP_NAME, status: stepStatus(currentApprovals, null) },
          ...groupSteps,
        ],
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}

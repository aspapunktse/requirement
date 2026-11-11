import type { EvaluationStage, EvaluationTrack, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { TaskRow } from "@/components/ui/TaskTable";
import { OPEN_RISK_STATUS } from "@/lib/risk-analysis";
import { effectiveRiskAnalysisLead, RISK_ANALYSIS_TASK_FALLS_BACK_TO_ALL, ROLES_ELIGIBLE_AS_RISK_ANALYSIS_LEAD } from "@/lib/risk-analysis-lead";
import { STRICTLY_READ_ONLY_ROLES } from "@/lib/system-permissions";
import { visibleSystemsWhere } from "@/lib/system-visibility";

/**
 * The "My tasks" rows for conducting a Risk Analysis (#361, product-owner decisions of 2026-11-11): one per staged System at a point where
 * one is due. Who gets it follows the System's Risk Analysis lead (`risk-analysis-lead.ts`): the lead alone once one is named; while none is
 * named (or the stored one no longer qualifies), every Risk Owner and Risk Facilitator who is not the System's owner, asked to name one
 * (`RISK_ANALYSIS_TASK_FALLS_BACK_TO_ALL`). Admins never get the row by role. Each decision is one constant or one small function.
 */

/** The stored stages at which a Risk Analysis can be due: the first round (the one before OG1) and the one before OG3. */
export const RISK_ANALYSIS_DUE_STAGES: EvaluationStage[] = ["FIRST_ROUND", "RISK_ANALYSIS_2"];

export type RiskAnalysisStep = "FIRST_ROUND" | "BEFORE_OG3";

export function riskAnalysisTaskRoleApplies(user: { role: UserRole }) {
  return ROLES_ELIGIBLE_AS_RISK_ANALYSIS_LEAD.includes(user.role) && !STRICTLY_READ_ONLY_ROLES.includes(user.role);
}

/** What the row says about the lead: "lead" (the user is the lead), "none" (no lead; the fallback), or null (not theirs). */
export function riskAnalysisTaskRelation(user: { id: string }, effectiveLeadId: string | null, fallsBack = RISK_ANALYSIS_TASK_FALLS_BACK_TO_ALL): "lead" | "none" | null {
  if (effectiveLeadId === user.id) return "lead";
  return effectiveLeadId === null && fallsBack ? "none" : null;
}

/**
 * Is a Risk Analysis due on a System, and for which step? Pure.
 * - First round: from the moment the first Requirement Round begins (stage `FIRST_ROUND`, no Track yet) until a Risk Analysis has been
 *   completed since then, the rule the stepper's `RISK_ANALYSIS_1` uses. Submitting the first round already needs one.
 * - Before OG3: while the stored stage is `RISK_ANALYSIS_2` (either Track) and none has been completed since the stage began. Completing
 *   one moves the System on in the same transaction (`advanceAfterRiskAnalysis`), so the stage alone would do; the check is kept so a
 *   System never shows a task for an analysis that is already done.
 * A System without a stage (the classic flow), a closed one, or one with no stage-entered time (nothing to compare against) has none.
 */
export function dueRiskAnalysisStep(
  system: { evaluationStage: EvaluationStage | null; evaluationTrack: EvaluationTrack | null; evaluationClosedAt: Date | null; evaluationStageEnteredAt: Date | null },
  completedSinceStageEntered: boolean,
): RiskAnalysisStep | null {
  if (system.evaluationClosedAt !== null || system.evaluationStageEnteredAt === null) return null;
  if (completedSinceStageEntered) return null;
  if (system.evaluationStage === "FIRST_ROUND") return "FIRST_ROUND";
  if (system.evaluationStage === "RISK_ANALYSIS_2" && system.evaluationTrack !== null) return "BEFORE_OG3";
  return null;
}

const STEP_LABEL: Record<RiskAnalysisStep, string> = { FIRST_ROUND: "First round", BEFORE_OG3: "Before OG3" };

/** Where the row goes: the System's Risks tab, which holds the Risk Analyses card. */
export const systemRiskAnalysesHref = (systemId: string) => `/systems/${systemId}#risks`;

/** The row's id: the System and the step, so it never collides with another module's row or with the other step. */
export const riskAnalysisTaskId = (systemId: string, step: RiskAnalysisStep) => `${systemId}:risk-analysis:${step}`;

/**
 * The rows for `user`: due Systems they can see and do not own, and are the lead of (or have no lead, see above), three reads whatever the number of Systems (the Systems, their Risk
 * Analyses, the Open Risks without an owner). A role outside `ROLES_ELIGIBLE_AS_RISK_ANALYSIS_LEAD` gets none.
 */
export async function getRiskAnalysisTasks(user: { id: string; role: UserRole }): Promise<TaskRow[]> {
  if (!riskAnalysisTaskRoleApplies(user)) return [];
  const visible = await visibleSystemsWhere(user);
  const systems = await prisma.system.findMany({
    where: {
      AND: [visible, { evaluationStage: { in: RISK_ANALYSIS_DUE_STAGES }, evaluationClosedAt: null, ownerId: { not: user.id } }],
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      evaluationStage: true,
      evaluationTrack: true,
      evaluationClosedAt: true,
      evaluationStageEnteredAt: true,
      riskAnalysisLead: { select: { id: true, role: true } },
    },
    orderBy: { evaluationStageEnteredAt: "asc" },
  });
  if (systems.length === 0) return [];
  const ids = systems.map((system) => system.id);
  const analyses = await prisma.riskAnalysis.findMany({ where: { systemId: { in: ids } }, select: { systemId: true, completedAt: true } });

  const due = systems.flatMap((system) => {
    const since = system.evaluationStageEnteredAt;
    // The rule of `hasCompletedRiskAnalysisSince`: completed at or after the moment the stage began.
    const completed = since !== null && analyses.some((a) => a.systemId === system.id && a.completedAt !== null && a.completedAt >= since);
    const step = dueRiskAnalysisStep(system, completed);
    const relation = riskAnalysisTaskRelation(user, effectiveRiskAnalysisLead(system));
    return step && relation ? [{ system, step, relation, inProgress: analyses.some((a) => a.systemId === system.id && a.completedAt === null) }] : [];
  });
  if (due.length === 0) return [];

  const inProgressIds = due.filter((entry) => entry.inProgress).map((entry) => entry.system.id);
  const unowned =
    inProgressIds.length === 0
      ? []
      : await prisma.risk.groupBy({ by: ["systemId"], where: { systemId: { in: inProgressIds }, status: OPEN_RISK_STATUS, ownerId: null }, _count: { _all: true } });
  const unownedBySystem = new Map(unowned.map((group) => [group.systemId, group._count._all]));

  return due.map(({ system, step, relation, inProgress }): TaskRow => {
    const count = unownedBySystem.get(system.id) ?? 0;
    const progress = inProgress
      ? `analysis in progress, ${count === 0 ? "every Open Risk has an owner" : `${count} Open ${count === 1 ? "Risk" : "Risks"} without an owner`}`
      : "no analysis recorded yet";
    return {
      id: riskAnalysisTaskId(system.id, step),
      kind: "Risk Analysis",
      title: `${relation === "none" ? "Name a lead and conduct" : "Conduct"} the Risk Analysis for ${system.name}`,
      subtitle: `${STEP_LABEL[step]} · ${progress}`,
      tone: inProgress ? "accent" : "warn",
      status: inProgress ? "In progress" : "Due",
      updatedAt: system.evaluationStageEnteredAt ?? undefined,
      href: systemRiskAnalysesHref(system.id),
    };
  });
}

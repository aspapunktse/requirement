import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { canRecordRiskAnalysis, RISK_ANALYSIS_REFUSED } from "@/lib/risk-analysis";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { SYSTEM_CLOSED_REFUSAL } from "@/lib/system-closed";

/**
 * The Risk Analysis lead of a System (#361, product-owner decision of 2026-11-11, CONTEXT.md "Risk Analysis lead"): the one person given
 * the "Conduct the Risk Analysis" task on Home. Each rule below is one constant or one small function, so a change is a one-line edit.
 */

/** Who may be the lead: a Risk Owner or a Risk Facilitator (#362), and never the System's owner. Admins may conduct the analysis but are not picked. */
export const ROLES_ELIGIBLE_AS_RISK_ANALYSIS_LEAD: UserRole[] = ["RISK_OWNER", "RISK_FACILITATOR"];

/**
 * While a Risk Analysis is due and no lead is named (or the named one is no longer eligible), do all the Risk Owners and Risk Facilitators
 * who are not the System's owner get the task, asked to name a lead? False: nobody gets it until a lead is named.
 */
export const RISK_ANALYSIS_TASK_FALLS_BACK_TO_ALL = true;

export function isEligibleAsRiskAnalysisLead(user: { id: string; role: UserRole }, system: { ownerId: string }) {
  return ROLES_ELIGIBLE_AS_RISK_ANALYSIS_LEAD.includes(user.role) && user.id !== system.ownerId;
}

/**
 * The lead the task goes by: the stored one, or null when none is named or the stored one is no longer eligible (lost the role, or became the
 * System's owner). The stored value is never deleted for that.
 */
export function effectiveRiskAnalysisLead(system: { ownerId: string; riskAnalysisLead: { id: string; role: UserRole } | null }) {
  return system.riskAnalysisLead && isEligibleAsRiskAnalysisLead(system.riskAnalysisLead, system) ? system.riskAnalysisLead.id : null;
}

export const RISK_ANALYSIS_LEAD_NOT_STAGED = "Only a System evaluated in stages has a Risk Analysis lead";
export const RISK_ANALYSIS_LEAD_INELIGIBLE = "The Risk Analysis lead must be a Risk Owner or a Risk Facilitator who is not the System's owner";

export type RiskAnalysisLeadResult =
  | { ok: true; changed: boolean; lead: { id: string; name: string } | null }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

/**
 * Names, changes or clears (null) the lead of `systemId`. One transaction, every query on `tx`. 404 for a System the actor cannot see,
 * 403 for one who may not record a Risk Analysis on it (the System's owner, any role but Risk Owner, Risk Facilitator and Admin), 409 for a
 * closed System, 400 for a System without a stage, an unknown User or an ineligible one. Nothing is written when refused. The write is guarded
 * on the lead read (409 on a concurrent change). Exactly one RISK_ANALYSIS_LEAD_CHANGED Change Event, in the same transaction; saving the
 * value it already has writes nothing.
 */
export async function changeRiskAnalysisLead(actor: { id: string; role: UserRole }, systemId: string, leadId: string | null): Promise<RiskAnalysisLeadResult> {
  class Abort extends Error {
    constructor(readonly result: Extract<RiskAnalysisLeadResult, { ok: false }>) {
      super(result.error);
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const system = await tx.system.findFirst({
        where: { AND: [{ id: systemId }, await visibleSystemsWhere(actor, tx)] },
        select: { id: true, ownerId: true, evaluationStage: true, evaluationClosedAt: true, riskAnalysisLead: { select: { id: true, name: true } } },
      });
      if (!system) throw new Abort({ ok: false, status: 404, error: "System not found" });
      if (!canRecordRiskAnalysis(actor, system)) throw new Abort({ ok: false, status: 403, error: RISK_ANALYSIS_REFUSED });
      if (system.evaluationClosedAt) throw new Abort({ ok: false, status: 409, error: SYSTEM_CLOSED_REFUSAL });
      if (system.evaluationStage === null) throw new Abort({ ok: false, status: 400, error: RISK_ANALYSIS_LEAD_NOT_STAGED });

      let next: { id: string; name: string } | null = null;
      if (leadId !== null) {
        const candidate = await tx.user.findUnique({ where: { id: leadId }, select: { id: true, name: true, role: true } });
        if (!candidate || !isEligibleAsRiskAnalysisLead(candidate, system)) throw new Abort({ ok: false, status: 400, error: RISK_ANALYSIS_LEAD_INELIGIBLE });
        next = { id: candidate.id, name: candidate.name };
      }
      const current = system.riskAnalysisLead;
      if ((current?.id ?? null) === (next?.id ?? null)) return { ok: true as const, changed: false, lead: current };

      const updated = await tx.system.updateMany({
        where: { id: system.id, riskAnalysisLeadId: current?.id ?? null, ownerId: system.ownerId },
        data: { riskAnalysisLeadId: next?.id ?? null },
      });
      if (updated.count !== 1) throw new Abort({ ok: false, status: 409, error: "The Risk Analysis lead or the System's owner changed while saving; try again" });
      await logChangeEvent(
        system.id,
        "RISK_ANALYSIS_LEAD_CHANGED",
        `Risk Analysis lead changed from ${current?.name ?? "none"} to ${next?.name ?? "none"}`,
        actor.id,
        tx,
      );
      return { ok: true as const, changed: true, lead: next };
    });
  } catch (error) {
    if (error instanceof Abort) return error.result;
    throw error;
  }
}

/** Every User who may be picked as a lead on a System: the eligible roles, minus the System's owner. */
export function listRiskAnalysisLeadCandidates(system: { ownerId: string }) {
  return prisma.user.findMany({
    where: { role: { in: ROLES_ELIGIBLE_AS_RISK_ANALYSIS_LEAD }, id: { not: system.ownerId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

import { prisma } from "@/lib/prisma";
import type { ControlAssessmentStatus } from "@prisma/client";
import { applicableControlsOf, loadControlsForApplicability } from "@/lib/control-applicability-data";
import { inheritanceSourcesFor, resolveEffectiveStatus } from "@/lib/effective-status";
import { loadOrganizationStatuses, loadProviderSources, toOwnAssessment } from "@/lib/effective-status-data";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { RISK_INCLUDE, SYSTEM_RISK_WHERE } from "@/lib/risks";
import { EFFECTIVE_SCOPE_SELECT, withEffectiveScope } from "@/lib/effective-framework-scope";

export type AttentionSystem =
  | { id: string; name: string; reason: "stale" | "rejected" }
  /** `count` applicable mandatory Controls with no touched Assessment (newly applicable, on a non-Draft System). */
  | { id: string; name: string; reason: "needs-assessment"; count: number };

/**
 * Systems owned by `ownerId` that need the owner's attention. Keyed on the
 * owner alone, whatever their role, so any role's "My tasks" can reuse it
 * (#98).
 *
 * Draft Systems: either previously Rejected and returned to Draft for
 * revision (a REJECTED entry exists in Approval history — checked first since
 * it's the cheaper query), or carrying a ControlAssessment left stale by a
 * later classification or Framework Scope change (see getStaleAssessments).
 * See issue #54.
 *
 * Non-Draft Systems (In Review, Approved, Onboarded; continuous compliance,
 * ADR 0006): `needs-assessment`, with the number of applicable mandatory
 * Controls that have no touched Assessment. The submission check guarantees
 * there are none when a System leaves Draft, so a non-zero count means a
 * later change (classification, Framework Scope, a Provider dependency) made
 * Controls newly applicable; the System's status is never touched by that
 * (F-AP.4). A non-Draft System also gets `stale` when it carries stale
 * Assessments (product-owner decision on #86), so it can have both reasons;
 * each is its own entry, so neither hides the other. The result therefore
 * holds at most one entry per System and reason, not one per System.
 */
export async function getSystemsNeedingAttention(ownerId: string): Promise<AttentionSystem[]> {
  // One snapshot: the Controls load their required Framework relations, which a concurrent delete could
  // otherwise remove between statements (#387).
  return prisma.$transaction(async (tx) => {
    const systems = (await tx.system.findMany({
      where: { ownerId, evaluationClosedAt: null },
      orderBy: { createdAt: "asc" },
      include: {
        deploymentFacets: true,
        ...EFFECTIVE_SCOPE_SELECT,
        approvals: { where: { decision: "REJECTED" }, take: 1 },
      },
    })).map(withEffectiveScope);

    const nonDraftIds = systems.filter((system) => system.status !== "DRAFT").map((system) => system.id);
    // Set-based, whatever the number of Systems: the Controls, and the owner's Assessments, are read once and
    // judged per System in memory (the in-memory twin of the applicability rules, `controlAppliesToSystem`).
    const controls =
      systems.length === 0
        ? []
        : await loadControlsForApplicability(tx);
    const assessments =
      systems.length === 0
        ? []
        : await tx.controlAssessment.findMany({
            where: { systemId: { in: systems.map((system) => system.id) } },
            select: { systemId: true, controlId: true, status: true, assessedById: true },
          });
    const assessmentsBySystem = new Map<string, Map<string, { status: ControlAssessmentStatus; assessedById: string | null }>>();
    for (const assessment of assessments) {
      const own = assessmentsBySystem.get(assessment.systemId) ?? new Map();
      own.set(assessment.controlId, assessment);
      assessmentsBySystem.set(assessment.systemId, own);
    }
    const applicableBySystem = new Map(systems.map((system) => [system.id, applicableControlsOf(controls, system)]));
    // What `getUnaddressedMandatoryControls` needs beyond the Controls, for the non-Draft Systems only.
    const mandatoryIds = [...new Set(nonDraftIds.flatMap((id) => (applicableBySystem.get(id) ?? []).filter((control) => control.mandatory).map((control) => control.id)))];
    const organizationStatuses = await loadOrganizationStatuses(
      controls.filter((control) => control.applicability === "BOTH" && mandatoryIds.includes(control.id)).map((control) => control.id),
      tx,
    );
    const providerSources = await loadProviderSources(nonDraftIds, mandatoryIds, tx);

    const results: AttentionSystem[] = [];
    for (const system of systems) {
      const applicable = applicableBySystem.get(system.id) ?? [];
      const own = assessmentsBySystem.get(system.id) ?? new Map();
      if (system.status !== "DRAFT") {
        const unaddressed = applicable.filter((control) => {
          if (!control.mandatory) return false;
          const assessment = own.get(control.id);
          const effective = resolveEffectiveStatus(
            assessment ? toOwnAssessment(assessment) : null,
            inheritanceSourcesFor(control, organizationStatuses.get(control.id), providerSources.get(system.id)?.get(control.id)),
          );
          return effective.status === "NOT_STARTED";
        });
        if (unaddressed.length > 0) {
          results.push({ id: system.id, name: system.name, reason: "needs-assessment", count: unaddressed.length });
        }
      } else if (system.approvals.length > 0) {
        results.push({ id: system.id, name: system.name, reason: "rejected" });
        continue;
      }
      // Stale: a recorded Assessment whose Control no longer applies (`getStaleAssessments`).
      const applicableIds = new Set(applicable.map((control) => control.id));
      if ([...own.keys()].some((controlId) => !applicableIds.has(controlId))) {
        results.push({ id: system.id, name: system.name, reason: "stale" });
      }
    }
    return results;
}, READ_SNAPSHOT);
}

/**
 * Every open Risk across every System, newest first, with its System's name. `systemOnly` leaves out Organization Risks (no System),
 * for a role that may not read them (the Risk Facilitator, #362).
 */
export function getAllOpenRisks({ systemOnly = false }: { systemOnly?: boolean } = {}) {
  return prisma.risk.findMany({
    where: { status: "OPEN", ...(systemOnly && SYSTEM_RISK_WHERE) },
    include: { ...RISK_INCLUDE, system: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

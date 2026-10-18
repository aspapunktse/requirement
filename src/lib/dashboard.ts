import { prisma } from "@/lib/prisma";
import { getStaleAssessments, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { RISK_INCLUDE } from "@/lib/risks";

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
  const systems = await prisma.system.findMany({
    where: { ownerId },
    orderBy: { createdAt: "asc" },
    include: {
      deploymentFacets: true,
      frameworkScopes: { select: { id: true } },
      approvals: { where: { decision: "REJECTED" }, take: 1 },
    },
  });

  const results: AttentionSystem[] = [];
  for (const system of systems) {
    if (system.status !== "DRAFT") {
      const unaddressed = await getUnaddressedMandatoryControls(system);
      if (unaddressed.length > 0) {
        results.push({ id: system.id, name: system.name, reason: "needs-assessment", count: unaddressed.length });
      }
    } else if (system.approvals.length > 0) {
      results.push({ id: system.id, name: system.name, reason: "rejected" });
      continue;
    }
    const stale = await getStaleAssessments(system);
    if (stale.length > 0) {
      results.push({ id: system.id, name: system.name, reason: "stale" });
    }
  }
  return results;
}

/** Every open Risk across every System, newest first, with its System's name. */
export function getAllOpenRisks() {
  return prisma.risk.findMany({
    where: { status: "OPEN" },
    include: { ...RISK_INCLUDE, system: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

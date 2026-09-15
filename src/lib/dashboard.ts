import { prisma } from "@/lib/prisma";
import { getStaleAssessments } from "@/lib/requirement-assessments";
import { RISK_INCLUDE } from "@/lib/risks";

export type AttentionSystem = { id: string; name: string; reason: "stale" | "rejected" };

/**
 * Draft Systems owned by `userId` that need the owner's attention: either
 * previously Rejected and returned to Draft for revision (a REJECTED entry
 * exists in Approval history — checked first since it's the cheaper query),
 * or carrying a RequirementAssessment left stale by a later facet/overlay/
 * impact-level change (see getStaleAssessments). See issue #54.
 */
export async function getSystemsNeedingAttention(userId: string): Promise<AttentionSystem[]> {
  const drafts = await prisma.system.findMany({
    where: { ownerId: userId, status: "DRAFT" },
    include: {
      deploymentFacets: true,
      regulatoryOverlays: true,
      approvals: { where: { decision: "REJECTED" }, take: 1 },
    },
  });

  const results: AttentionSystem[] = [];
  for (const system of drafts) {
    if (system.approvals.length > 0) {
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

/** Systems currently IN_REVIEW, awaiting a REVIEWER/ADMIN Approval decision. */
export function getSystemsAwaitingApproval() {
  return prisma.system.findMany({
    where: { status: "IN_REVIEW" },
    orderBy: { updatedAt: "asc" },
  });
}

/** Every open Risk across every System, newest first, with its System's name. */
export function getAllOpenRisks() {
  return prisma.risk.findMany({
    where: { status: "OPEN" },
    include: { ...RISK_INCLUDE, system: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
}

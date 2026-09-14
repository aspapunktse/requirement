import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getApplicableRequirements } from "@/lib/requirement-assessments";

/**
 * Who may change a System's declared Deployment Facets: ADMIN, or the
 * owning SYSTEM_OWNER. Callers still need to check the System is Draft
 * separately (kept out of here, like `canMarkOnboarded`'s Approved check,
 * so a caller can report "wrong role" vs "wrong status" as distinct errors).
 */
export function canChangeDeploymentFacets(
  user: { id: string; role: UserRole },
  system: { ownerId: string },
) {
  if (user.role === "ADMIN") return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

/**
 * Change a Draft System's declared Deployment Facets and recompute its
 * Requirement Assessment set: create NOT_STARTED rows for newly-applicable
 * Requirements, and remove rows for no-longer-applicable ones — but only if
 * untouched (still NOT_STARTED and never manually edited, i.e. assessedById
 * is null). A Requirement Assessment a human has already worked on is left
 * in place even though it's no longer applicable; it becomes visible via
 * getStaleAssessments so the System Owner can resolve it manually.
 *
 * A Hybrid System declaring both On-Prem and Cloud simply gets the union of
 * what each facet requires — see ADR 0003.
 */
export async function changeDeploymentFacets(
  system: { id: string; deploymentFacets: { id: string }[] },
  newFacetIds: string[],
) {
  const oldFacetIds = system.deploymentFacets.map((f) => f.id);
  const [oldApplicable, newApplicable] = await Promise.all([
    getApplicableRequirements(oldFacetIds),
    getApplicableRequirements(newFacetIds),
  ]);

  const newIds = new Set(newApplicable.map((r) => r.id));
  const oldIds = new Set(oldApplicable.map((r) => r.id));

  const newlyApplicable = newApplicable.filter((r) => !oldIds.has(r.id));
  const noLongerApplicableIds = oldApplicable.filter((r) => !newIds.has(r.id)).map((r) => r.id);

  const [, removed] = await prisma.$transaction([
    prisma.system.update({
      where: { id: system.id },
      data: { deploymentFacets: { set: newFacetIds.map((id) => ({ id })) } },
    }),
    prisma.requirementAssessment.deleteMany({
      where: {
        systemId: system.id,
        requirementId: { in: noLongerApplicableIds },
        status: "NOT_STARTED",
        assessedById: null,
      },
    }),
    prisma.requirementAssessment.createMany({
      data: newlyApplicable.map((r) => ({ systemId: system.id, requirementId: r.id })),
      skipDuplicates: true,
    }),
  ]);

  return { added: newlyApplicable.length, removed: removed.count };
}

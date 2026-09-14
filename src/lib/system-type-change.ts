import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getApplicableRequirements } from "@/lib/requirement-assessments";

/**
 * Who may change a System's Type: ADMIN, or the owning SYSTEM_OWNER.
 * Callers still need to check the System is Draft separately (kept out of
 * here, like `canMarkOnboarded`'s Approved check, so a caller can report
 * "wrong role" vs "wrong status" as distinct errors).
 */
export function canChangeSystemType(
  user: { id: string; role: UserRole },
  system: { ownerId: string },
) {
  if (user.role === "ADMIN") return true;
  return user.role === "SYSTEM_OWNER" && system.ownerId === user.id;
}

/**
 * Change a Draft System's SystemType and recompute its Requirement
 * Assessment set: create NOT_STARTED rows for newly-applicable Requirements,
 * and remove rows for no-longer-applicable ones — but only if untouched
 * (still NOT_STARTED and never manually edited, i.e. assessedById is null).
 * A Requirement Assessment a human has already worked on is left in place
 * even though it's no longer applicable; it becomes visible via
 * getStaleAssessments so the System Owner can resolve it manually.
 */
export async function changeSystemType(
  system: { id: string; systemTypeId: string },
  newSystemTypeId: string,
) {
  const [oldApplicable, newApplicable] = await Promise.all([
    getApplicableRequirements(system.systemTypeId),
    getApplicableRequirements(newSystemTypeId),
  ]);

  const newIds = new Set(newApplicable.map((r) => r.id));
  const oldIds = new Set(oldApplicable.map((r) => r.id));

  const newlyApplicable = newApplicable.filter((r) => !oldIds.has(r.id));
  const noLongerApplicableIds = oldApplicable.filter((r) => !newIds.has(r.id)).map((r) => r.id);

  const [, removed] = await prisma.$transaction([
    prisma.system.update({ where: { id: system.id }, data: { systemTypeId: newSystemTypeId } }),
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

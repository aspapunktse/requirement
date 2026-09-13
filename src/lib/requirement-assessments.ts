import { prisma } from "@/lib/prisma";

const APPLICABLE_APPLICABILITIES = ["PER_SYSTEM", "BOTH"] as const;

/**
 * Requirements that apply to a System of the given SystemType: scoped
 * PER_SYSTEM or BOTH, and either unscoped by System Type (applies to every
 * Type) or explicitly scoped to include this one. ORGANIZATIONAL-scoped
 * Requirements are never assessed per System, so they're excluded here.
 */
export function getApplicableRequirements(systemTypeId: string) {
  return prisma.requirement.findMany({
    where: {
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      OR: [{ systemTypes: { none: {} } }, { systemTypes: { some: { id: systemTypeId } } }],
    },
    orderBy: { code: "asc" },
  });
}

/**
 * Every Requirement applicable to a System, each paired with its current
 * RequirementAssessment — a not-yet-touched Requirement is paired with a
 * default NOT_STARTED placeholder rather than a missing row.
 */
export async function getSystemAssessments(system: { id: string; systemTypeId: string }) {
  const [requirements, assessments] = await Promise.all([
    getApplicableRequirements(system.systemTypeId),
    prisma.requirementAssessment.findMany({
      where: { systemId: system.id },
      include: { assessedBy: true },
    }),
  ]);

  const assessmentByRequirementId = new Map(assessments.map((a) => [a.requirementId, a]));

  return requirements.map((requirement) => ({
    requirement,
    assessment: assessmentByRequirementId.get(requirement.id) ?? null,
  }));
}

/**
 * The Requirement `requirementId`, if it's applicable to `system` — null if
 * it doesn't exist or isn't scoped to this System's Type/applicability.
 */
export function getApplicableRequirement(system: { systemTypeId: string }, requirementId: string) {
  return prisma.requirement.findFirst({
    where: {
      id: requirementId,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      OR: [{ systemTypes: { none: {} } }, { systemTypes: { some: { id: system.systemTypeId } } }],
    },
  });
}

/**
 * The mandatory Requirements applicable to `system` that haven't been
 * addressed yet — no RequirementAssessment row at all, or one still sitting
 * at NOT_STARTED. This is the gate for submitting a System for review: it
 * only cares that each has been touched, not that it's Fulfilled.
 */
export async function getUnaddressedMandatoryRequirements(system: {
  id: string;
  systemTypeId: string;
}) {
  const mandatoryRequirements = await prisma.requirement.findMany({
    where: {
      mandatory: true,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      OR: [{ systemTypes: { none: {} } }, { systemTypes: { some: { id: system.systemTypeId } } }],
    },
  });
  if (mandatoryRequirements.length === 0) return [];

  const addressedAssessments = await prisma.requirementAssessment.findMany({
    where: {
      systemId: system.id,
      requirementId: { in: mandatoryRequirements.map((r) => r.id) },
      NOT: { status: "NOT_STARTED" },
    },
    select: { requirementId: true },
  });
  const addressedIds = new Set(addressedAssessments.map((a) => a.requirementId));

  return mandatoryRequirements.filter((requirement) => !addressedIds.has(requirement.id));
}

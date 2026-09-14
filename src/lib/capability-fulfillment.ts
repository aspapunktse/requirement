import { prisma } from "@/lib/prisma";
import { getApplicableRequirements } from "@/lib/requirement-assessments";

async function getApplicableRequirementsForCapability(
  system: { deploymentFacets: { id: string }[] },
  capabilityId: string,
) {
  const [applicable, mapped] = await Promise.all([
    getApplicableRequirements(system.deploymentFacets.map((f) => f.id)),
    prisma.requirement.findMany({ where: { capabilities: { some: { id: capabilityId } } } }),
  ]);
  const applicableIds = new Set(applicable.map((r) => r.id));
  return mapped.filter((r) => applicableIds.has(r.id));
}

/**
 * Declaring a Capability auto-fulfills every applicable Requirement it's
 * mapped to — unless a human has already touched that specific Assessment
 * (assessedById set), in which case it's left alone. Builds on the same
 * RequirementAssessment rows the #15 recompute path manages, rather than a
 * second mechanism.
 */
export async function applyCapabilityDeclared(
  system: { id: string; deploymentFacets: { id: string }[] },
  capability: { id: string; name: string },
) {
  const requirements = await getApplicableRequirementsForCapability(system, capability.id);
  if (requirements.length === 0) return;

  const existing = await prisma.requirementAssessment.findMany({
    where: { systemId: system.id, requirementId: { in: requirements.map((r) => r.id) } },
  });
  const existingByRequirementId = new Map(existing.map((a) => [a.requirementId, a]));

  const toCreateRequirementIds: string[] = [];
  const toUpdateAssessmentIds: string[] = [];
  for (const requirement of requirements) {
    const current = existingByRequirementId.get(requirement.id);
    if (!current) {
      toCreateRequirementIds.push(requirement.id);
    } else if (current.assessedById === null) {
      toUpdateAssessmentIds.push(current.id);
    }
    // else: a human already touched this Assessment — leave it alone.
  }

  const note = `Inherited via ${capability.name}`;
  await prisma.$transaction([
    ...(toCreateRequirementIds.length > 0
      ? [
          prisma.requirementAssessment.createMany({
            data: toCreateRequirementIds.map((requirementId) => ({
              systemId: system.id,
              requirementId,
              status: "FULFILLED" as const,
              notes: note,
              fulfilledByCapabilityId: capability.id,
              assessedAt: new Date(),
            })),
          }),
        ]
      : []),
    ...(toUpdateAssessmentIds.length > 0
      ? [
          prisma.requirementAssessment.updateMany({
            where: { id: { in: toUpdateAssessmentIds } },
            data: {
              status: "FULFILLED",
              notes: note,
              fulfilledByCapabilityId: capability.id,
              assessedAt: new Date(),
            },
          }),
        ]
      : []),
  ]);
}

/**
 * Un-declaring a Capability reverts each Assessment it had auto-fulfilled
 * back to Not Started — unless another Capability the System still
 * declares also fulfills that Requirement (OR semantics: any one Capability
 * suffices), in which case the Assessment stays Fulfilled, re-attributed to
 * that surviving Capability.
 */
export async function applyCapabilityRemoved(system: { id: string }, capabilityId: string) {
  const affected = await prisma.requirementAssessment.findMany({
    where: { systemId: system.id, fulfilledByCapabilityId: capabilityId },
    include: { requirement: { include: { capabilities: true } } },
  });
  if (affected.length === 0) return;

  const stillDeclared = await prisma.capability.findMany({
    where: { systems: { some: { id: system.id } } },
    select: { id: true, name: true },
  });
  const stillDeclaredById = new Map(stillDeclared.map((c) => [c.id, c]));

  const revertIds: string[] = [];
  const repoint: { id: string; capabilityId: string; capabilityName: string }[] = [];

  for (const assessment of affected) {
    const alternative = assessment.requirement.capabilities.find(
      (c) => c.id !== capabilityId && stillDeclaredById.has(c.id),
    );
    if (alternative) {
      repoint.push({ id: assessment.id, capabilityId: alternative.id, capabilityName: alternative.name });
    } else {
      revertIds.push(assessment.id);
    }
  }

  await prisma.$transaction([
    ...(revertIds.length > 0
      ? [
          prisma.requirementAssessment.updateMany({
            where: { id: { in: revertIds } },
            data: { status: "NOT_STARTED", notes: null, fulfilledByCapabilityId: null, assessedAt: null },
          }),
        ]
      : []),
    ...repoint.map((r) =>
      prisma.requirementAssessment.update({
        where: { id: r.id },
        data: { notes: `Inherited via ${r.capabilityName}`, fulfilledByCapabilityId: r.capabilityId },
      }),
    ),
  ]);
}

import { prisma } from "@/lib/prisma";
import { getApplicableControls, type SystemClassification } from "@/lib/control-assessments";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";

async function getApplicableControlsForCapability(system: SystemClassification, capabilityId: string) {
  const [applicable, mapped] = await Promise.all([
    getApplicableControls(system),
    prisma.control.findMany({ where: { capabilities: { some: { id: capabilityId } } } }),
  ]);
  const applicableIds = new Set(applicable.map((r) => r.id));
  return mapped.filter((r) => applicableIds.has(r.id));
}

/**
 * Declaring a Capability auto-fulfills every applicable Control it's
 * mapped to — unless a human has already touched that specific Assessment
 * (assessedById set), in which case it's left alone. Builds on the same
 * ControlAssessment rows the #15 recompute path manages, rather than a
 * second mechanism.
 */
export async function applyCapabilityDeclared(
  system: SystemClassification & { id: string },
  capability: { id: string; name: string },
) {
  const controls = await getApplicableControlsForCapability(system, capability.id);
  if (controls.length === 0) return;

  const existing = await prisma.controlAssessment.findMany({
    where: { systemId: system.id, controlId: { in: controls.map((r) => r.id) } },
  });
  const existingByControlId = new Map(existing.map((a) => [a.controlId, a]));

  const toCreateControlIds: string[] = [];
  const toUpdateAssessmentIds: string[] = [];
  for (const control of controls) {
    const current = existingByControlId.get(control.id);
    if (!current) {
      toCreateControlIds.push(control.id);
    } else if (current.assessedById === null) {
      toUpdateAssessmentIds.push(current.id);
    }
    // else: a human already touched this Assessment — leave it alone.
  }

  const note = `Inherited via ${capability.name}`;
  await prisma.$transaction([
    ...(toCreateControlIds.length > 0
      ? [
          prisma.controlAssessment.createMany({
            data: toCreateControlIds.map((controlId) => ({
              systemId: system.id,
              controlId,
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
          prisma.controlAssessment.updateMany({
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

  const affectedCount = toCreateControlIds.length + toUpdateAssessmentIds.length;
  if (affectedCount > 0) {
    await logChangeEvent(
      system.id,
      "ASSESSMENT_STATUS_CHANGED",
      `${affectedCount} Control Assessment(s) auto-fulfilled via Capability "${capability.name}"`,
      SYSTEM_ACTOR,
    );
  }
}

/**
 * Un-declaring a Capability reverts each Assessment it had auto-fulfilled
 * back to Not Started — unless another Capability the System still
 * declares also fulfills that Control (OR semantics: any one Capability
 * suffices), in which case the Assessment stays Fulfilled, re-attributed to
 * that surviving Capability.
 */
export async function applyCapabilityRemoved(system: { id: string }, capabilityId: string) {
  const affected = await prisma.controlAssessment.findMany({
    where: { systemId: system.id, fulfilledByCapabilityId: capabilityId },
    include: { control: { include: { capabilities: true } } },
  });
  if (affected.length === 0) return;

  const removedCapability = await prisma.capability.findUnique({
    where: { id: capabilityId },
    select: { name: true },
  });

  const stillDeclared = await prisma.capability.findMany({
    where: { systems: { some: { id: system.id } } },
    select: { id: true, name: true },
  });
  const stillDeclaredById = new Map(stillDeclared.map((c) => [c.id, c]));

  const revertIds: string[] = [];
  const repoint: { id: string; capabilityId: string; capabilityName: string }[] = [];

  for (const assessment of affected) {
    const alternative = assessment.control.capabilities.find(
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
          prisma.controlAssessment.updateMany({
            where: { id: { in: revertIds } },
            data: { status: "NOT_STARTED", notes: null, fulfilledByCapabilityId: null, assessedAt: null },
          }),
        ]
      : []),
    ...repoint.map((r) =>
      prisma.controlAssessment.update({
        where: { id: r.id },
        data: { notes: `Inherited via ${r.capabilityName}`, fulfilledByCapabilityId: r.capabilityId },
      }),
    ),
  ]);

  await logChangeEvent(
    system.id,
    "ASSESSMENT_STATUS_CHANGED",
    `${revertIds.length} Control Assessment(s) reverted, ${repoint.length} re-attributed, after Capability "${removedCapability?.name ?? capabilityId}" removed`,
    SYSTEM_ACTOR,
  );
}

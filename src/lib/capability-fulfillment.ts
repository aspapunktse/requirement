import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  diffApplicability,
  diffApplicabilityOps,
  getApplicableControls,
  type SystemClassification,
} from "@/lib/control-assessments";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";

export type CapabilityRef = { id: string; name: string };

/** The note an auto-fulfilled Assessment carries; the one wording every fulfilment path uses. */
export const inheritedNote = (capabilityName: string) => `Inherited via ${capabilityName}`;

/** The `"system"` Change Event detail for N Assessments auto-fulfilled via one Capability (one wording, every path). */
export const autoFulfilledDetail = (count: number, capabilityName: string) =>
  `${count} Control Assessment(s) auto-fulfilled via Capability "${capabilityName}"`;

function compareCapabilities(a: CapabilityRef, b: CapabilityRef) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Several declared Capabilities can cover the same Control (OR semantics: any
 * one suffices). The Assessment is attributed to exactly one of them,
 * deterministically: the first by name (plain code-unit order, so it doesn't
 * depend on a locale or the database collation), then by id. A System with the
 * same declared Capabilities therefore always gets the same attribution, whether
 * the Assessment is created by a recompute (#110) or re-attributed when a
 * Capability is removed (`applyCapabilityRemoved`). Declaring a Capability
 * (`applyCapabilityDeclared`) names its own Capability and never picks.
 */
export function pickCapability<T extends CapabilityRef>(candidates: T[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    if (!best || compareCapabilities(candidate, best) < 0) best = candidate;
  }
  return best;
}

/** The create data of one auto-fulfilled Assessment: FULFILLED, no human touch (assessedById stays null). */
function fulfilledAssessmentData(
  systemId: string,
  controlId: string,
  capability: CapabilityRef,
  now: Date,
): Prisma.ControlAssessmentCreateManyInput {
  return {
    systemId,
    controlId,
    status: "FULFILLED",
    notes: inheritedNote(capability.name),
    fulfilledByCapabilityId: capability.id,
    assessedAt: now,
  };
}

/** For each Control, the Capabilities mapped to it (only Controls with at least one are present). */
export type ControlCapabilities = Map<string, CapabilityRef[]>;

/** Loads the Control -> Capability mappings of `controlIds` in one query, however many Controls and Systems. */
export async function loadControlCapabilities(controlIds: string[]): Promise<ControlCapabilities> {
  const result: ControlCapabilities = new Map();
  if (controlIds.length === 0) return result;
  const capabilities = await prisma.capability.findMany({
    where: { controls: { some: { id: { in: controlIds } } } },
    select: { id: true, name: true, controls: { where: { id: { in: controlIds } }, select: { id: true } } },
  });
  for (const capability of capabilities) {
    for (const control of capability.controls) {
      result.set(control.id, [...(result.get(control.id) ?? []), { id: capability.id, name: capability.name }]);
    }
  }
  return result;
}

/** The Capabilities `systemId` currently declares. */
export function loadDeclaredCapabilities(systemId: string): Promise<CapabilityRef[]> {
  return prisma.capability.findMany({
    where: { systems: { some: { id: systemId } } },
    select: { id: true, name: true },
  });
}

/** What creating a System's newly applicable Assessments comes to: the rows, and how many each Capability fulfilled. */
export type NewAssessmentPlan = {
  rows: Prisma.ControlAssessmentCreateManyInput[];
  fulfilledVia: Map<string, { capability: CapabilityRef; count: number }>;
};

/**
 * Capability auto-fulfilment for Controls that became applicable later (#110),
 * the same rules as declaring a Capability: a newly applicable Control that a
 * Capability the System declares is mapped to is created FULFILLED, with
 * `fulfilledByCapabilityId` and the "Inherited via ..." note; any other starts
 * NOT_STARTED. Pure: the caller supplies the System's declared Capabilities and
 * the Control -> Capability mappings, so a bulk caller (the catalog recompute)
 * loads them once for every System. `controlIds` must be Controls the System has
 * no Assessment row for, so a touched row can never be overwritten: the rows are
 * only ever inserted (`createMany` with `skipDuplicates` in every caller).
 */
export function planNewAssessments(
  systemId: string,
  controlIds: string[],
  declared: CapabilityRef[],
  controlCapabilities: ControlCapabilities,
  now: Date = new Date(),
): NewAssessmentPlan {
  const declaredIds = new Set(declared.map((c) => c.id));
  const rows: Prisma.ControlAssessmentCreateManyInput[] = [];
  const fulfilledVia: NewAssessmentPlan["fulfilledVia"] = new Map();
  for (const controlId of controlIds) {
    const covering =
      declaredIds.size === 0 ? [] : (controlCapabilities.get(controlId) ?? []).filter((c) => declaredIds.has(c.id));
    const chosen = pickCapability(covering);
    if (!chosen) {
      rows.push({ systemId, controlId });
      continue;
    }
    rows.push(fulfilledAssessmentData(systemId, controlId, chosen, now));
    const entry = fulfilledVia.get(chosen.id);
    if (entry) entry.count += 1;
    else fulfilledVia.set(chosen.id, { capability: chosen, count: 1 });
  }
  return { rows, fulfilledVia };
}

/**
 * The `"system"` Change Events recording a plan's auto-fulfilment: one
 * ASSESSMENT_STATUS_CHANGED per Capability, worded like `applyCapabilityDeclared`'s
 * (`autoFulfilledDetail`). Separate from the recompute's own event rather than a
 * count folded into it, so the attribution (`SYSTEM_ACTOR`) is right even when a
 * person triggered the recompute. Empty when nothing was fulfilled.
 */
export function autoFulfilmentEvents(systemId: string, plan: NewAssessmentPlan): Prisma.ChangeEventCreateManyInput[] {
  return [...plan.fulfilledVia.values()]
    .sort((a, b) => compareCapabilities(a.capability, b.capability))
    .map(({ capability, count }) => ({
      systemId,
      action: "ASSESSMENT_STATUS_CHANGED" as const,
      detail: autoFulfilledDetail(count, capability.name),
      actorId: SYSTEM_ACTOR,
    }));
}

/**
 * `diffApplicabilityOps` with Capability auto-fulfilment (#110) for the
 * single-System recompute paths (classification change, Framework Scope
 * declare/remove): the same delete and create ops, but a newly applicable Control
 * a declared Capability covers is created FULFILLED in that same `createMany`,
 * so it commits in the caller's `$transaction` with the rest of the recompute and
 * the System is never seen half-applied. Declared Capabilities are read before
 * the transaction (up to three small queries, none when nothing became applicable or the
 * System declares none); a Capability declared in the meantime is picked up by
 * its own `applyCapabilityDeclared`. After the transaction the caller records
 * `plan` with `logAutoFulfilment`.
 */
export async function diffApplicabilityOpsWithCapabilities(
  systemId: string,
  oldApplicable: { id: string }[],
  newApplicable: { id: string }[],
) {
  const { newlyApplicableIds } = diffApplicability(oldApplicable, newApplicable);
  const declared = newlyApplicableIds.length > 0 ? await loadDeclaredCapabilities(systemId) : [];
  let toCreateIds = newlyApplicableIds;
  let controlCapabilities: ControlCapabilities = new Map();
  if (declared.length > 0) {
    controlCapabilities = await loadControlCapabilities(newlyApplicableIds);
    // A newly applicable Control can already have a row (a touched one left behind as stale): it is
    // neither created nor fulfilled, and not counted in the event.
    const existing = await prisma.controlAssessment.findMany({
      where: { systemId, controlId: { in: newlyApplicableIds } },
      select: { controlId: true },
    });
    const existingIds = new Set(existing.map((a) => a.controlId));
    toCreateIds = newlyApplicableIds.filter((id) => !existingIds.has(id));
  }
  const plan = planNewAssessments(systemId, toCreateIds, declared, controlCapabilities);
  return { ...diffApplicabilityOps(systemId, oldApplicable, newApplicable, plan.rows), plan };
}

/** Writes the Change Events for `plan` (after its transaction committed). */
export async function logAutoFulfilment(systemId: string, plan: NewAssessmentPlan) {
  const data = autoFulfilmentEvents(systemId, plan);
  if (data.length > 0) await prisma.changeEvent.createMany({ data });
}

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
 * second mechanism. The recompute paths (#110) apply the same rule to Controls
 * that become applicable later, through `planNewAssessments`.
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

  const now = new Date();
  await prisma.$transaction([
    ...(toCreateControlIds.length > 0
      ? [
          prisma.controlAssessment.createMany({
            data: toCreateControlIds.map((controlId) => fulfilledAssessmentData(system.id, controlId, capability, now)),
          }),
        ]
      : []),
    ...(toUpdateAssessmentIds.length > 0
      ? [
          prisma.controlAssessment.updateMany({
            where: { id: { in: toUpdateAssessmentIds } },
            data: {
              status: "FULFILLED",
              notes: inheritedNote(capability.name),
              fulfilledByCapabilityId: capability.id,
              assessedAt: now,
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
      autoFulfilledDetail(affectedCount, capability.name),
      SYSTEM_ACTOR,
    );
  }
}

/**
 * Un-declaring a Capability reverts each Assessment it had auto-fulfilled
 * back to Not Started — unless another Capability the System still
 * declares also fulfills that Control (OR semantics: any one Capability
 * suffices), in which case the Assessment stays Fulfilled, re-attributed to
 * that surviving Capability (the first by name, then id: `pickCapability`).
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
    const alternative = pickCapability(
      assessment.control.capabilities.filter((c) => c.id !== capabilityId && stillDeclaredById.has(c.id)),
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
        data: { notes: inheritedNote(r.capabilityName), fulfilledByCapabilityId: r.capabilityId },
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

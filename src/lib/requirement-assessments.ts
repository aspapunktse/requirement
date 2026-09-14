import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const APPLICABLE_APPLICABILITIES = ["PER_SYSTEM", "BOTH"] as const;

/** Only these roles may set a Requirement Assessment to Waived or Not Applicable. */
export const ROLES_ALLOWED_TO_WAIVE: UserRole[] = ["ADMIN", "RISK_OWNER"];

export type WaiveGateResult = { ok: true } | { ok: false; status: 403 | 400; error: string };

/**
 * The shared gate on setting a Requirement Assessment to Waived or Not
 * Applicable, used both for direct manual status edits and for answering
 * "N/A" to a Requirement's Self-Assessment Question: restricted to
 * ADMIN/RISK_OWNER, and requiring a non-empty justification note when the
 * Requirement is mandatory — server-enforced so a SYSTEM_OWNER can't waive
 * or N/A their own System's mandatory Requirement through either path.
 */
export function checkWaiveGate(
  user: { role: UserRole },
  requirement: { mandatory: boolean },
  notes: string | null | undefined,
): WaiveGateResult {
  if (!ROLES_ALLOWED_TO_WAIVE.includes(user.role)) {
    return { ok: false, status: 403, error: `Requires role: ${ROLES_ALLOWED_TO_WAIVE.join(", ")}` };
  }
  if (requirement.mandatory && !notes?.trim()) {
    return {
      ok: false,
      status: 400,
      error: "A justification note is required to waive or mark a mandatory Requirement Not Applicable",
    };
  }
  return { ok: true };
}

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
 * The Requirement behind `requirementId` for the purpose of editing a
 * RequirementAssessment: either the normal applicable-Requirement lookup, or
 * — if that Requirement is no longer applicable to the System's current
 * Type — the Requirement behind an *existing* Assessment row, so a stale
 * Assessment left behind by a System Type change stays resolvable rather
 * than becoming permanently stuck (see #15).
 */
export async function getRequirementForAssessmentEdit(
  system: { id: string; systemTypeId: string },
  requirementId: string,
) {
  const applicable = await getApplicableRequirement(system, requirementId);
  if (applicable) return applicable;

  const existing = await prisma.requirementAssessment.findUnique({
    where: { systemId_requirementId: { systemId: system.id, requirementId } },
    include: { requirement: true },
  });
  return existing?.requirement ?? null;
}

/**
 * RequirementAssessments still recorded for `system` whose Requirement is no
 * longer applicable to its current SystemType/applicability scope — left in
 * place by a System Type change (rather than deleted) because a human had
 * already worked on them. Surfaced so the System Owner can resolve them.
 */
export async function getStaleAssessments(system: { id: string; systemTypeId: string }) {
  const applicable = await getApplicableRequirements(system.systemTypeId);
  const applicableIds = applicable.map((r) => r.id);

  return prisma.requirementAssessment.findMany({
    where: { systemId: system.id, requirementId: { notIn: applicableIds } },
    include: { requirement: true, assessedBy: true },
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

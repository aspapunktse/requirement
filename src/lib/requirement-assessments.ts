import type { ImpactLevel, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const APPLICABLE_APPLICABILITIES = ["PER_SYSTEM", "BOTH"] as const;

const IMPACT_LEVEL_RANK: Record<ImpactLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Does a System's declared level on one CIA axis meet a Requirement's
 * minimum threshold on that axis? A null threshold means the Requirement
 * doesn't care about this axis (always met). A null System level means
 * "not yet classified" on this axis — that only meets an unset threshold.
 * Impact Level thresholds are a >= comparison, not a membership check like
 * facet/overlay scoping — see ADR 0003.
 */
function meetsImpactThreshold(systemLevel: ImpactLevel | null, minimum: ImpactLevel | null): boolean {
  if (!minimum) return true;
  if (!systemLevel) return false;
  return IMPACT_LEVEL_RANK[systemLevel] >= IMPACT_LEVEL_RANK[minimum];
}

/** Does `classification` meet every Impact Level threshold `requirement` sets? */
function meetsAllImpactThresholds(
  classification: Pick<
    SystemClassification,
    "confidentialityImpactLevel" | "integrityImpactLevel" | "availabilityImpactLevel"
  >,
  requirement: Pick<
    RequirementImpactThresholds,
    "minConfidentialityImpactLevel" | "minIntegrityImpactLevel" | "minAvailabilityImpactLevel"
  >,
): boolean {
  return (
    meetsImpactThreshold(classification.confidentialityImpactLevel, requirement.minConfidentialityImpactLevel) &&
    meetsImpactThreshold(classification.integrityImpactLevel, requirement.minIntegrityImpactLevel) &&
    meetsImpactThreshold(classification.availabilityImpactLevel, requirement.minAvailabilityImpactLevel)
  );
}

/** Only these roles may set a Requirement Assessment to Waived or Not Applicable. */
export const ROLES_ALLOWED_TO_WAIVE: UserRole[] = ["ADMIN", "RISK_OWNER"];

export type WaiveGateResult = { ok: true } | { ok: false; status: 403 | 400; error: string };

/**
 * Diff an old vs new applicable-Requirement set for a System into the two
 * Prisma ops needed to sync its RequirementAssessment rows to match: create
 * NOT_STARTED rows for newly-applicable Requirements, and remove rows for
 * no-longer-applicable ones — but only if untouched (still NOT_STARTED and
 * never manually edited, i.e. assessedById is null). A Requirement
 * Assessment a human has already worked on is left in place even though
 * it's no longer applicable; it becomes visible via getStaleAssessments so
 * the System Owner can resolve it manually. Returns the ops (rather than
 * running them) so a caller can combine them with its own classification
 * update in one atomic `prisma.$transaction`. Shared by every
 * classification-changing mutation (Deployment Facets, Regulatory
 * Overlays, ...) — see ADR 0003.
 */
export function diffApplicabilityOps(
  systemId: string,
  oldApplicable: { id: string }[],
  newApplicable: { id: string }[],
) {
  const newIds = new Set(newApplicable.map((r) => r.id));
  const oldIds = new Set(oldApplicable.map((r) => r.id));

  const newlyApplicable = newApplicable.filter((r) => !oldIds.has(r.id));
  const noLongerApplicableIds = oldApplicable.filter((r) => !newIds.has(r.id)).map((r) => r.id);

  return {
    added: newlyApplicable.length,
    deleteOp: prisma.requirementAssessment.deleteMany({
      where: {
        systemId,
        requirementId: { in: noLongerApplicableIds },
        status: "NOT_STARTED",
        assessedById: null,
      },
    }),
    createOp: prisma.requirementAssessment.createMany({
      data: newlyApplicable.map((r) => ({ systemId, requirementId: r.id })),
      skipDuplicates: true,
    }),
  };
}

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

/** A System's declared classification, as far as applicability filtering cares. */
export type SystemClassification = {
  deploymentFacets: { id: string }[];
  regulatoryOverlays: { id: string }[];
  confidentialityImpactLevel: ImpactLevel | null;
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
};

/** A Requirement's Impact Level thresholds, as far as applicability filtering cares. */
type RequirementImpactThresholds = {
  minConfidentialityImpactLevel: ImpactLevel | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
};

const APPLICABLE_BY_FACET_AND_OVERLAY = (facetIds: string[], overlayIds: string[]) => [
  { OR: [{ deploymentFacets: { none: {} } }, { deploymentFacets: { some: { id: { in: facetIds } } } }] },
  { OR: [{ regulatoryOverlays: { none: {} } }, { regulatoryOverlays: { some: { id: { in: overlayIds } } } } ] },
];

/**
 * Requirements that apply to a System with the given classification: scoped
 * PER_SYSTEM or BOTH; for each of facet and overlay independently, either
 * unscoped on that axis (applies regardless) or explicitly scoped to
 * include at least one of the System's declared values on that axis (union
 * within an axis, e.g. a Hybrid System declaring both On-Prem and Cloud gets
 * everything either facet requires); and meeting every Impact Level
 * threshold the Requirement sets (a >= comparison per CIA axis, not a
 * membership check). All conditions AND together — see ADR 0003.
 * ORGANIZATIONAL-scoped Requirements are never assessed per System, so
 * they're excluded here. Impact Level thresholds can't be expressed as a
 * portable Prisma enum filter, so they're applied in application code after
 * the facet/overlay-filtered fetch.
 */
export async function getApplicableRequirements(classification: SystemClassification) {
  const facetIds = classification.deploymentFacets.map((f) => f.id);
  const overlayIds = classification.regulatoryOverlays.map((o) => o.id);
  const requirements = await prisma.requirement.findMany({
    where: {
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABLE_BY_FACET_AND_OVERLAY(facetIds, overlayIds),
    },
    orderBy: { code: "asc" },
  });
  return requirements.filter((requirement) => meetsAllImpactThresholds(classification, requirement));
}

/**
 * Every Requirement applicable to a System, each paired with its current
 * RequirementAssessment — a not-yet-touched Requirement is paired with a
 * default NOT_STARTED placeholder rather than a missing row.
 */
export async function getSystemAssessments(system: SystemClassification & { id: string }) {
  const [requirements, assessments] = await Promise.all([
    getApplicableRequirements(system),
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
 * it doesn't exist or isn't scoped to one of this System's declared
 * Deployment Facets/Regulatory Overlays/applicability.
 */
export async function getApplicableRequirement(system: SystemClassification, requirementId: string) {
  const facetIds = system.deploymentFacets.map((f) => f.id);
  const overlayIds = system.regulatoryOverlays.map((o) => o.id);
  const requirement = await prisma.requirement.findFirst({
    where: {
      id: requirementId,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABLE_BY_FACET_AND_OVERLAY(facetIds, overlayIds),
    },
  });
  if (!requirement || !meetsAllImpactThresholds(system, requirement)) return null;
  return requirement;
}

/**
 * The Requirement behind `requirementId` for the purpose of editing a
 * RequirementAssessment: either the normal applicable-Requirement lookup, or
 * — if that Requirement is no longer applicable to the System's current
 * declared facets — the Requirement behind an *existing* Assessment row, so
 * a stale Assessment left behind by a facet change stays resolvable rather
 * than becoming permanently stuck (see #15).
 */
export async function getRequirementForAssessmentEdit(
  system: SystemClassification & { id: string },
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
 * longer applicable to its current declared-facets/applicability scope —
 * left in place by a facet change (rather than deleted) because a human had
 * already worked on them. Surfaced so the System Owner can resolve them.
 */
export async function getStaleAssessments(system: SystemClassification & { id: string }) {
  const applicable = await getApplicableRequirements(system);
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
export async function getUnaddressedMandatoryRequirements(system: SystemClassification & { id: string }) {
  const facetIds = system.deploymentFacets.map((f) => f.id);
  const overlayIds = system.regulatoryOverlays.map((o) => o.id);
  const candidates = await prisma.requirement.findMany({
    where: {
      mandatory: true,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABLE_BY_FACET_AND_OVERLAY(facetIds, overlayIds),
    },
  });
  const mandatoryRequirements = candidates.filter((requirement) => meetsAllImpactThresholds(system, requirement));
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

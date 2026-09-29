import type { ImpactLevel, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { QUERY_INCLUDE } from "@/lib/assessment-queries";

const APPLICABLE_APPLICABILITIES = ["PER_SYSTEM", "BOTH"] as const;

const IMPACT_LEVEL_RANK: Record<ImpactLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Does a System's declared level on one CIA axis meet a Control's
 * minimum threshold on that axis? A null threshold means the Control
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

/** Does `classification` meet every Impact Level threshold `control` sets? */
function meetsAllImpactThresholds(
  classification: Pick<
    SystemClassification,
    "confidentialityImpactLevel" | "integrityImpactLevel" | "availabilityImpactLevel"
  >,
  control: Pick<
    ControlImpactThresholds,
    "minConfidentialityImpactLevel" | "minIntegrityImpactLevel" | "minAvailabilityImpactLevel"
  >,
): boolean {
  return (
    meetsImpactThreshold(classification.confidentialityImpactLevel, control.minConfidentialityImpactLevel) &&
    meetsImpactThreshold(classification.integrityImpactLevel, control.minIntegrityImpactLevel) &&
    meetsImpactThreshold(classification.availabilityImpactLevel, control.minAvailabilityImpactLevel)
  );
}

/** Only these roles may set a Control Assessment to Waived or Not Applicable. */
export const ROLES_ALLOWED_TO_WAIVE: UserRole[] = ["ADMIN", "RISK_OWNER"];

export type WaiveGateResult = { ok: true } | { ok: false; status: 403 | 400; error: string };

/**
 * Diff an old vs new applicable-Control set for a System into the two
 * Prisma ops needed to sync its ControlAssessment rows to match: create
 * NOT_STARTED rows for newly-applicable Controls, and remove rows for
 * no-longer-applicable ones — but only if untouched (still NOT_STARTED and
 * never manually edited, i.e. assessedById is null). A Control
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
    deleteOp: prisma.controlAssessment.deleteMany({
      where: {
        systemId,
        controlId: { in: noLongerApplicableIds },
        status: "NOT_STARTED",
        assessedById: null,
      },
    }),
    createOp: prisma.controlAssessment.createMany({
      data: newlyApplicable.map((r) => ({ systemId, controlId: r.id })),
      skipDuplicates: true,
    }),
  };
}

/**
 * The shared gate on setting a Control Assessment to Waived or Not
 * Applicable, used both for direct manual status edits and for answering
 * "N/A" to a Control's Self-Assessment Question: restricted to
 * ADMIN/RISK_OWNER, and requiring a non-empty justification note when the
 * Control is mandatory — server-enforced so a SYSTEM_OWNER can't waive
 * or N/A their own System's mandatory Control through either path.
 */
export function checkWaiveGate(
  user: { role: UserRole },
  control: { mandatory: boolean },
  notes: string | null | undefined,
): WaiveGateResult {
  if (!ROLES_ALLOWED_TO_WAIVE.includes(user.role)) {
    return { ok: false, status: 403, error: `Requires role: ${ROLES_ALLOWED_TO_WAIVE.join(", ")}` };
  }
  if (control.mandatory && !notes?.trim()) {
    return {
      ok: false,
      status: 400,
      error: "A justification note is required to waive or mark a mandatory Control Not Applicable",
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

/** A Control's Impact Level thresholds, as far as applicability filtering cares. */
type ControlImpactThresholds = {
  minConfidentialityImpactLevel: ImpactLevel | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
};

const APPLICABLE_BY_FACET_AND_OVERLAY = (facetIds: string[], overlayIds: string[]) => [
  { OR: [{ deploymentFacets: { none: {} } }, { deploymentFacets: { some: { id: { in: facetIds } } } }] },
  { OR: [{ regulatoryOverlays: { none: {} } }, { regulatoryOverlays: { some: { id: { in: overlayIds } } } } ] },
];

/**
 * Controls that apply to a System with the given classification: scoped
 * PER_SYSTEM or BOTH; for each of facet and overlay independently, either
 * unscoped on that axis (applies regardless) or explicitly scoped to
 * include at least one of the System's declared values on that axis (union
 * within an axis, e.g. a Hybrid System declaring both On-Prem and Cloud gets
 * everything either facet requires); and meeting every Impact Level
 * threshold the Control sets (a >= comparison per CIA axis, not a
 * membership check). All conditions AND together — see ADR 0003.
 * ORGANIZATIONAL-scoped Controls are never assessed per System, so
 * they're excluded here. Impact Level thresholds can't be expressed as a
 * portable Prisma enum filter, so they're applied in application code after
 * the facet/overlay-filtered fetch.
 */
export async function getApplicableControls(classification: SystemClassification) {
  const facetIds = classification.deploymentFacets.map((f) => f.id);
  const overlayIds = classification.regulatoryOverlays.map((o) => o.id);
  const controls = await prisma.control.findMany({
    where: {
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABLE_BY_FACET_AND_OVERLAY(facetIds, overlayIds),
    },
    orderBy: { code: "asc" },
  });
  return controls.filter((control) => meetsAllImpactThresholds(classification, control));
}

/**
 * Every Control applicable to a System, each paired with its current
 * ControlAssessment — a not-yet-touched Control is paired with a
 * default NOT_STARTED placeholder rather than a missing row.
 */
export async function getSystemAssessments(system: SystemClassification & { id: string }) {
  const [controls, assessments] = await Promise.all([
    getApplicableControls(system),
    prisma.controlAssessment.findMany({
      where: { systemId: system.id },
      include: { assessedBy: true, queries: { include: QUERY_INCLUDE, orderBy: { createdAt: "asc" } } },
    }),
  ]);

  const assessmentByControlId = new Map(assessments.map((a) => [a.controlId, a]));

  return controls.map((control) => ({
    control,
    assessment: assessmentByControlId.get(control.id) ?? null,
  }));
}

/**
 * The Control `controlId`, if it's applicable to `system` — null if
 * it doesn't exist or isn't scoped to one of this System's declared
 * Deployment Facets/Regulatory Overlays/applicability.
 */
export async function getApplicableControl(system: SystemClassification, controlId: string) {
  const facetIds = system.deploymentFacets.map((f) => f.id);
  const overlayIds = system.regulatoryOverlays.map((o) => o.id);
  const control = await prisma.control.findFirst({
    where: {
      id: controlId,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABLE_BY_FACET_AND_OVERLAY(facetIds, overlayIds),
    },
  });
  if (!control || !meetsAllImpactThresholds(system, control)) return null;
  return control;
}

/**
 * The Control behind `controlId` for the purpose of editing a
 * ControlAssessment: either the normal applicable-Control lookup, or
 * — if that Control is no longer applicable to the System's current
 * declared facets — the Control behind an *existing* Assessment row, so
 * a stale Assessment left behind by a facet change stays resolvable rather
 * than becoming permanently stuck (see #15).
 */
export async function getControlForAssessmentEdit(
  system: SystemClassification & { id: string },
  controlId: string,
) {
  const applicable = await getApplicableControl(system, controlId);
  if (applicable) return applicable;

  const existing = await prisma.controlAssessment.findUnique({
    where: { systemId_controlId: { systemId: system.id, controlId } },
    include: { control: true },
  });
  return existing?.control ?? null;
}

/**
 * ControlAssessments still recorded for `system` whose Control is no
 * longer applicable to its current declared-facets/applicability scope —
 * left in place by a facet change (rather than deleted) because a human had
 * already worked on them. Surfaced so the System Owner can resolve them.
 */
export async function getStaleAssessments(system: SystemClassification & { id: string }) {
  const applicable = await getApplicableControls(system);
  const applicableIds = applicable.map((r) => r.id);

  return prisma.controlAssessment.findMany({
    where: { systemId: system.id, controlId: { notIn: applicableIds } },
    include: {
      control: true,
      assessedBy: true,
      queries: { include: QUERY_INCLUDE, orderBy: { createdAt: "asc" } },
    },
  });
}

/**
 * The mandatory Controls applicable to `system` that haven't been
 * addressed yet — no ControlAssessment row at all, or one still sitting
 * at NOT_STARTED. This is the gate for submitting a System for review: it
 * only cares that each has been touched, not that it's Fulfilled.
 */
export async function getUnaddressedMandatoryControls(system: SystemClassification & { id: string }) {
  const facetIds = system.deploymentFacets.map((f) => f.id);
  const overlayIds = system.regulatoryOverlays.map((o) => o.id);
  const candidates = await prisma.control.findMany({
    where: {
      mandatory: true,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABLE_BY_FACET_AND_OVERLAY(facetIds, overlayIds),
    },
  });
  const mandatoryControls = candidates.filter((control) => meetsAllImpactThresholds(system, control));
  if (mandatoryControls.length === 0) return [];

  const addressedAssessments = await prisma.controlAssessment.findMany({
    where: {
      systemId: system.id,
      controlId: { in: mandatoryControls.map((r) => r.id) },
      NOT: { status: "NOT_STARTED" },
    },
    select: { controlId: true },
  });
  const addressedIds = new Set(addressedAssessments.map((a) => a.controlId));

  return mandatoryControls.filter((control) => !addressedIds.has(control.id));
}

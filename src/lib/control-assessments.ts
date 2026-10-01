import type { ImpactLevel, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { QUERY_INCLUDE } from "@/lib/assessment-queries";
import { ROLES_ALLOWED_TO_WAIVE, waiveRefusal } from "@/lib/system-permissions";

const APPLICABLE_APPLICABILITIES = ["PER_SYSTEM", "BOTH"] as const;

const IMPACT_LEVEL_RANK: Record<ImpactLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Does a System's declared level on one CIA axis meet a Control's
 * minimum threshold on that axis? A null threshold means the Control
 * doesn't care about this axis (always met). A null System level means
 * "not yet classified" on this axis — that only meets an unset threshold.
 * Impact Level thresholds are a >= comparison, not a membership check like
 * facet scoping — see ADR 0003.
 */
function meetsImpactThreshold(systemLevel: ImpactLevel | null, minimum: ImpactLevel | null): boolean {
  if (!minimum) return true;
  if (!systemLevel) return false;
  return IMPACT_LEVEL_RANK[systemLevel] >= IMPACT_LEVEL_RANK[minimum];
}

/** Does `classification` meet every Impact Level threshold `control` sets? */
export function meetsAllImpactThresholds(
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

export type WaiveGateResult = { ok: true } | { ok: false; status: 403 | 400; error: string };

/**
 * "Untouched": a ControlAssessment still at NOT_STARTED that no human ever
 * edited (assessedById is null). The one definition every recompute uses to
 * decide whether a no-longer-applicable row may be removed; anything else is
 * kept in place as stale (see getStaleAssessments).
 */
export const UNTOUCHED_ASSESSMENT_WHERE = { status: "NOT_STARTED", assessedById: null } as const;

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
 * classification-changing mutation (Deployment Facets, Framework Scope,
 * ...) — see ADR 0003 and ADR 0007.
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
        ...UNTOUCHED_ASSESSMENT_WHERE,
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
 * ADMIN/RISK_OWNER, refusing a RISK_OWNER who owns the System when the
 * Control is mandatory (#97), and requiring a non-empty justification note
 * when the Control is mandatory — server-enforced so a SYSTEM_OWNER can't
 * waive or N/A their own System's mandatory Control through either path.
 * The permission rule itself is `waiveRefusal` in `system-permissions.ts`,
 * shared with the UI; this adds the distinct error messages and the note check.
 */
export function checkWaiveGate(
  user: { id: string; role: UserRole },
  system: { ownerId: string },
  control: { mandatory: boolean },
  notes: string | null | undefined,
): WaiveGateResult {
  const refusal = waiveRefusal(user, system, control);
  if (refusal === "role") {
    return { ok: false, status: 403, error: `Requires role: ${ROLES_ALLOWED_TO_WAIVE.join(", ")}` };
  }
  if (refusal === "owns-system") {
    return {
      ok: false,
      status: 403,
      error: "You own this System, so another Risk Owner or an Admin must waive this mandatory Control",
    };
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

/**
 * A System's declared classification, as far as applicability filtering cares.
 * `frameworkScopes` is the System's *declared* Framework Scope rows (ids
 * only); the base Framework is always in scope on top of them and needn't be
 * listed. Required, not optional, so that a caller which forgets to load it
 * fails typecheck instead of silently dropping every non-base Framework's
 * Controls (ADR 0007).
 */
export type SystemClassification = {
  deploymentFacets: { id: string }[];
  frameworkScopes: { id: string }[];
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

/**
 * The DB-side applicability conditions for `classification`, ANDed together:
 * - Framework gate (ADR 0007): the Control is mapped, at any Coverage, to a
 *   Requirement of a PUBLISHED Framework that's either the base Framework
 *   (always in scope, stored scope row or not) or one of the System's declared
 *   Framework Scope rows. A declared row pointing at a Draft Framework matches
 *   nothing, so it's inert until that Framework is published.
 * - Deployment Facet scoping: unscoped, or scoped to include at least one of
 *   the System's declared facets.
 * Impact Level thresholds are applied in application code afterwards.
 */
const APPLICABILITY_SCOPING = (classification: Pick<SystemClassification, "deploymentFacets" | "frameworkScopes">) => {
  const facetIds = classification.deploymentFacets.map((f) => f.id);
  const scopedFrameworkIds = classification.frameworkScopes.map((f) => f.id);
  return [
    {
      mappings: {
        some: {
          requirement: {
            framework: { status: "PUBLISHED" as const, OR: [{ isBase: true }, { id: { in: scopedFrameworkIds } }] },
          },
        },
      },
    },
    { OR: [{ deploymentFacets: { none: {} } }, { deploymentFacets: { some: { id: { in: facetIds } } } }] },
  ];
};

/**
 * The in-memory twin of `getApplicableControls`' rules, for callers that have
 * already bulk-loaded Controls and need the answer for many Systems without a
 * query per System (the derived Requirement status, #89). MUST stay in sync
 * with APPLICABILITY_SCOPING and the applicability filter above; a DB test
 * asserts the two agree on fixtures. `control.mappings` must list the
 * Framework of every Requirement the Control is mapped to (any Coverage).
 */
export function controlAppliesToSystem(
  control: ControlImpactThresholds & {
    applicability: "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH";
    deploymentFacets: { id: string }[];
    mappings: { requirement: { framework: { id: string; status: string; isBase: boolean } } }[];
  },
  classification: SystemClassification,
): boolean {
  if (!(APPLICABLE_APPLICABILITIES as readonly string[]).includes(control.applicability)) return false;

  const scopedFrameworkIds = new Set(classification.frameworkScopes.map((f) => f.id));
  const inScopePublishedFramework = control.mappings.some(({ requirement: { framework } }) => {
    return framework.status === "PUBLISHED" && (framework.isBase || scopedFrameworkIds.has(framework.id));
  });
  if (!inScopePublishedFramework) return false;

  if (control.deploymentFacets.length > 0) {
    const facetIds = new Set(classification.deploymentFacets.map((f) => f.id));
    if (!control.deploymentFacets.some((f) => facetIds.has(f.id))) return false;
  }

  return meetsAllImpactThresholds(classification, control);
}

/**
 * Controls that apply to a System with the given classification: scoped
 * PER_SYSTEM or BOTH; either unscoped by Deployment Facet (applies
 * regardless) or explicitly scoped to include at least one of the System's
 * declared facets (a union, e.g. a Hybrid System declaring both On-Prem and
 * Cloud gets everything either facet requires); and meeting every Impact Level
 * threshold the Control sets (a >= comparison per CIA axis, not a
 * membership check). All conditions AND together — see ADR 0003.
 * ORGANIZATIONAL-scoped Controls are never assessed per System, so
 * they're excluded here. Impact Level thresholds can't be expressed as a
 * portable Prisma enum filter, so they're applied in application code after
 * the DB-side fetch. `options.controlIds` narrows the answer to those
 * Controls (used by the catalog-change recompute, which only needs to know
 * about the Controls a change touched).
 *
 * On top of that, a Control only applies if it's mapped to a Requirement of a
 * Published Framework in the System's effective Framework Scope (its declared
 * scope rows plus the always-in-scope base Framework), and a Control mapped to
 * no Published Framework in scope applies to nothing — see
 * APPLICABILITY_SCOPING and ADR 0007.
 */
export async function getApplicableControls(
  classification: SystemClassification,
  options: { controlIds?: string[] } = {},
) {
  const controls = await prisma.control.findMany({
    where: {
      ...(options.controlIds !== undefined && { id: { in: options.controlIds } }),
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(classification),
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
 * Deployment Facets/applicability.
 */
export async function getApplicableControl(system: SystemClassification, controlId: string) {
  const control = await prisma.control.findFirst({
    where: {
      id: controlId,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(system),
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
  const candidates = await prisma.control.findMany({
    where: {
      mandatory: true,
      applicability: { in: [...APPLICABLE_APPLICABILITIES] },
      AND: APPLICABILITY_SCOPING(system),
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

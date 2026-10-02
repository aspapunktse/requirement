import type { ImpactLevel } from "@prisma/client";

/**
 * Whether a Control applies to a System, decided in memory (PRD 0001 ADR 0003,
 * ADR 0007). Pure and Prisma-free, so the bulk readers (the derived Requirement
 * status, the Provider sources of #124) can answer it for many Systems without a
 * query per System. `control-assessments.ts` re-exports everything here and keeps
 * the DB-side twin (`getApplicableControls`), which MUST stay in sync with
 * `controlAppliesToSystem`; a DB test asserts the two agree on fixtures.
 */

export const APPLICABLE_APPLICABILITIES = ["PER_SYSTEM", "BOTH"] as const;

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
export type ControlImpactThresholds = {
  minConfidentialityImpactLevel: ImpactLevel | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
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

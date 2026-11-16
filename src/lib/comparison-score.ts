import type { ControlAssessmentStatus, ImpactLevel } from "@prisma/client";

/**
 * The Comparison Score and the counts shown next to it (#371; CONTEXT.md "Evaluation"; docs/how-it-works/comparison.md).
 * Pure: inputs in, numbers out, no Prisma, safe to import from client components. The loader that reads the
 * inputs is `comparison-score-data.ts`. Nothing here authorizes anything; the routes that later expose these
 * figures do that.
 *
 * Comparison Score = fulfilled ÷ counted, over a Candidate's first-round Controls, each judged by its effective
 * status (`resolveEffectiveStatus`, so a Control inherited from the Organization or a Provider counts). Unweighted.
 */

/** One first-round Control of a Candidate, judged by its effective status. */
export type ComparisonControl = {
  controlId: string;
  code: string;
  title: string;
  /** The Control is mandatory (`Control.mandatory`). */
  mandatory: boolean;
  /** The effective status (`resolveEffectiveStatus(...).status`); an applicable Control with no Assessment row is NOT_STARTED. */
  status: ControlAssessmentStatus;
};

export type ComparisonScore = {
  /** First-round Controls that apply to the System. */
  firstRoundCount: number;
  /** First-round Controls minus those effectively Not Applicable: the denominator of the score. */
  countedCount: number;
  /** Counted Controls that are effectively Fulfilled: the numerator. */
  fulfilledCount: number;
  /**
   * fulfilled ÷ counted as a FRACTION between 0 and 1 (not a percentage; 9 ÷ 13 = 0.6923...), or null when nothing
   * is counted. Show it with `formatComparisonScore`, the one place that rounds.
   */
  score: number | null;
  /** First-round Controls with an effective status other than Not Started (Not Applicable and Waived are answers). */
  answeredCount: number;
  /**
   * Every first-round Control is answered. With ZERO first-round Controls this is false: nothing has been
   * answered, so the Candidate is not shown as complete (flagged for the product owner). A Candidate whose
   * first-round Controls are all Not Applicable is complete (all answered) with a null score.
   */
  complete: boolean;
  /** Mandatory first-round Controls that count and are not effectively Fulfilled. A mandatory Not Applicable one is not "not fulfilled". */
  mandatoryNotFulfilledCount: number;
  /** One row per first-round Control, in code order, for the Control-by-Control table. */
  controls: ComparisonControl[];
};

/**
 * Does this effective status count as fulfilled for the Comparison Score?
 * Only FULFILLED does. WAIVED is counted and NOT fulfilled, on purpose unlike the Compliance Percentage (where a
 * Waived Control counts as Fulfilled on a non-strict Framework): a waiver is an accepted shortfall and must not
 * lift a Candidate above one that really fulfils the Control. IN_PROGRESS and NOT_STARTED are counted, not fulfilled.
 */
function isFulfilled(status: ControlAssessmentStatus) {
  return status === "FULFILLED";
}

/** NOT_APPLICABLE is left out of both numbers. */
function isCounted(status: ControlAssessmentStatus) {
  return status !== "NOT_APPLICABLE";
}

const byCode = (a: ComparisonControl, b: ComparisonControl) =>
  a.code.localeCompare(b.code, "en", { numeric: true }) || (a.controlId < b.controlId ? -1 : a.controlId > b.controlId ? 1 : 0);

/** The Comparison Score and counts of one System from its first-round Controls (see the field notes on `ComparisonScore`). */
export function computeComparisonScore(firstRoundControls: readonly ComparisonControl[]): ComparisonScore {
  const controls = [...firstRoundControls].sort(byCode);
  const counted = controls.filter((control) => isCounted(control.status));
  const fulfilledCount = counted.filter((control) => isFulfilled(control.status)).length;
  const answeredCount = controls.filter((control) => control.status !== "NOT_STARTED").length;
  return {
    firstRoundCount: controls.length,
    countedCount: counted.length,
    fulfilledCount,
    score: counted.length === 0 ? null : fulfilledCount / counted.length,
    answeredCount,
    complete: controls.length > 0 && answeredCount === controls.length,
    mandatoryNotFulfilledCount: counted.filter((control) => control.mandatory && !isFulfilled(control.status)).length,
    controls,
  };
}

/** The score as shown: a whole percent ("69%"), or "—" when nothing is counted. The one place the score is rounded. */
export function formatComparisonScore(score: number | null): string {
  return score === null ? "—" : `${Math.round(score * 100)}%`;
}

/** What `orderCandidates` needs of a Candidate. */
export type OrderableCandidate = Pick<ComparisonScore, "complete" | "score" | "mandatoryNotFulfilledCount"> & { name: string };

/**
 * Candidates in the order a Comparison lists them: complete before incomplete; then score descending with a null
 * score last; then fewer mandatory Controls not fulfilled; then name (a fixed "en" locale, case-insensitive and
 * numeric-aware, so the order is the same on every server); then the input order (the sort is stable). Returns a
 * new array.
 */
export function orderCandidates<T extends OrderableCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? -1 : 1;
    if (a.score !== b.score) {
      if (a.score === null) return 1;
      if (b.score === null) return -1;
      return b.score - a.score;
    }
    if (a.mandatoryNotFulfilledCount !== b.mandatoryNotFulfilledCount) return a.mandatoryNotFulfilledCount - b.mandatoryNotFulfilledCount;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true });
  });
}

/** A System's classification as far as the Comparison compares it. The Framework Scope is the EFFECTIVE one (Published, base included). */
export type ComparisonClassification = {
  deploymentFacetIds: readonly string[];
  sensitivityLevel: number | null;
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
  frameworkScopeIds: readonly string[];
};

export type ClassificationDimension =
  | "deploymentFacets"
  | "sensitivityLevel"
  | "integrityImpactLevel"
  | "availabilityImpactLevel"
  | "frameworkScope";

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

/**
 * Which parts of the classification differ between the Systems, in a fixed order. Facets and Framework Scope compare
 * as sets (order and duplicates don't matter); the levels compare by value, so a null level differs from a set one.
 * Fewer than two Systems: nothing differs.
 */
export function classificationDifferences(systems: readonly ComparisonClassification[]): ClassificationDimension[] {
  if (systems.length < 2) return [];
  const [first, ...rest] = systems;
  const differs: Record<ClassificationDimension, (other: ComparisonClassification) => boolean> = {
    deploymentFacets: (other) => !sameSet(first.deploymentFacetIds, other.deploymentFacetIds),
    sensitivityLevel: (other) => first.sensitivityLevel !== other.sensitivityLevel,
    integrityImpactLevel: (other) => first.integrityImpactLevel !== other.integrityImpactLevel,
    availabilityImpactLevel: (other) => first.availabilityImpactLevel !== other.availabilityImpactLevel,
    frameworkScope: (other) => !sameSet(first.frameworkScopeIds, other.frameworkScopeIds),
  };
  return (Object.keys(differs) as ClassificationDimension[]).filter((dimension) => rest.some(differs[dimension]));
}

// Pure derived-Requirement-status rules (no Prisma), safe to import from client
// components. PRD 0001 F-AS.3 and OQ-1; issue #89; CONTEXT.md -> Requirement.
//
// A Requirement is never assessed directly. For one System its status is
// derived, live and never stored, from the Control Assessments of the Controls
// mapped to it that apply to that System. The DB-backed loaders (bulk and
// per-System) are in `requirement-status.ts`; everything decision-shaped lives
// here so there is exactly one place to change a rule.

import type { ControlAssessmentStatus } from "@prisma/client";
import type { MappingCoverage } from "@/lib/coverage-state";

export type DerivedRequirementStatus = "MET" | "PARTIALLY_MET" | "NOT_MET" | "NOT_APPLICABLE";

export const DERIVED_STATUS_LABEL: Record<DerivedRequirementStatus, string> = {
  MET: "Met",
  PARTIALLY_MET: "Partially Met",
  NOT_MET: "Not Met",
  NOT_APPLICABLE: "Not Applicable",
};

/** Display order of the four statuses (counts, filters). */
export const DERIVED_STATUS_ORDER: DerivedRequirementStatus[] = ["MET", "PARTIALLY_MET", "NOT_MET", "NOT_APPLICABLE"];

export const CONTROL_ASSESSMENT_STATUS_LABEL: Record<ControlAssessmentStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  FULFILLED: "Fulfilled",
  NOT_APPLICABLE: "Not Applicable",
  WAIVED: "Waived",
};

/**
 * OPEN PRODUCT QUESTION (flagged in issue #89's hand-back): the status of a
 * Requirement that has NO mapped Controls at all (an open or accepted
 * Coverage Gap with zero mappings). The issue's table doesn't cover it.
 * Read literally, OQ-1 ("none of its mapped Controls apply") would make it
 * Not Applicable and drop it from the Compliance Percentage denominator, which
 * would make a Framework nobody has mapped look compliant. The conservative
 * default is Not Met, for open and accepted gaps alike. Change this one
 * constant (and its test) if the product owner decides otherwise.
 */
export const NO_MAPPED_CONTROLS_STATUS: DerivedRequirementStatus = "NOT_MET";

/**
 * JUDGEMENT CALL (flagged in issue #89's hand-back): is "covered" judged over
 * all of a Requirement's mappings (literal reading of the issue: at least one
 * FULL mapping exists) or only over the mappings whose Control applies to this
 * System? With `true` (the conservative default) a FULL mapping to a Control
 * that doesn't apply to the System, e.g. an Organizational Control, doesn't make
 * the Requirement covered *there*, so ISO clause 7.5 (FULL to an Organizational
 * Control, PARTIAL to an applicable Annex A Control) is at best Partially Met
 * until M3's inheritance brings the Organizational Control in. Set to `false`
 * for the literal reading (that Requirement would be Met once A.5.37 is Fulfilled).
 */
export const COVERAGE_JUDGED_OVER_APPLICABLE_MAPPINGS = true;

/**
 * "Effectively Fulfilled" for one Control's *effective* status (see
 * `resolveEffectiveStatus` in `effective-status.ts`, which has already applied
 * inheritance by the time a status gets here): the single place that decides
 * whether a Control counts as satisfied for Requirement-status purposes.
 * Fulfilled always counts; Waived and Not Applicable are deliberate,
 * already-signed-off decisions and count too, unless the Framework is
 * `strictComplianceRequired`.
 */
export function isEffectivelyFulfilled(
  status: ControlAssessmentStatus,
  framework: { strictComplianceRequired: boolean },
): boolean {
  if (status === "FULFILLED") return true;
  if (status === "WAIVED" || status === "NOT_APPLICABLE") return !framework.strictComplianceRequired;
  return false;
}

/** One Control Mapping of a Requirement, as seen from one System. */
export type MappedControlForDerivation = {
  coverage: MappingCoverage;
  /** Does this mapped Control apply to the System (Framework gate, Deployment Facets, Impact Levels)? */
  applicable: boolean;
  /** The Control's effective status for the System (#121); null (no row yet) counts as NOT_STARTED. Ignored when not applicable. */
  status: ControlAssessmentStatus | null;
};

/** Why a status came out the way it did (drives the small note in the UI). */
export type DerivationBasis =
  /** The Requirement has no Control Mappings at all (see NO_MAPPED_CONTROLS_STATUS). */
  | "NO_MAPPED_CONTROLS"
  /** It has mappings, but none of the mapped Controls apply to this System (OQ-1). */
  | "NO_APPLICABLE_CONTROLS"
  /** Decided by how many applicable mapped Controls are effectively Fulfilled. */
  | "CONTROLS"
  /** Every applicable Control is Fulfilled but the Requirement is an accepted gap, so never Met. */
  | "ACCEPTED_GAP"
  /** Every applicable Control is Fulfilled but none of the applicable mappings gives Full coverage. */
  | "PARTIAL_COVERAGE";

export type DerivedRequirement = { status: DerivedRequirementStatus; basis: DerivationBasis };

/**
 * The derivation for one Requirement and one System (PRD 0001 F-AS.3, OQ-1):
 *
 * - No mapped Controls at all: NO_MAPPED_CONTROLS_STATUS (Not Met by default).
 * - Mappings exist but none apply to the System: **Not Applicable** (left out
 *   of the Compliance Percentage denominator).
 * - Otherwise, over the applicable mapped Controls:
 *   - none effectively Fulfilled: **Not Met**;
 *   - some but not all: **Partially Met**;
 *   - all: **Met**, but only if the Requirement is covered, and never if it is
 *     an accepted gap; an accepted gap, or a Requirement only Partially
 *     covered, is **Partially Met** (acceptance is a library-level judgment,
 *     not evidence that the System meets the Requirement).
 *
 * "Covered" is judged over the mappings that apply to this System by default: at
 * least one applicable mapping must give Full coverage (see
 * COVERAGE_JUDGED_OVER_APPLICABLE_MAPPINGS; flagged in the #89 hand-back). An accepted gap is
 * a Coverage Gap, so it is only one while the Requirement has no Full mapping at
 * all; a stale acceptance on a Requirement that has gained a Full mapping is ignored,
 * as in `deriveCoverageState`.
 */
export function deriveRequirementStatus(input: {
  framework: { strictComplianceRequired: boolean };
  mappings: MappedControlForDerivation[];
  gapAcceptedAt: Date | string | null;
}): DerivedRequirement {
  const { framework, mappings } = input;

  if (mappings.length === 0) return { status: NO_MAPPED_CONTROLS_STATUS, basis: "NO_MAPPED_CONTROLS" };

  const applicable = mappings.filter((mapping) => mapping.applicable);
  if (applicable.length === 0) return { status: "NOT_APPLICABLE", basis: "NO_APPLICABLE_CONTROLS" };

  const fulfilled = applicable.filter((mapping) =>
    isEffectivelyFulfilled(mapping.status ?? "NOT_STARTED", framework),
  ).length;
  if (fulfilled === 0) return { status: "NOT_MET", basis: "CONTROLS" };
  if (fulfilled < applicable.length) return { status: "PARTIALLY_MET", basis: "CONTROLS" };

  // Every applicable mapped Control is effectively Fulfilled: Met only if covered and not an accepted gap.
  const hasAnyFullMapping = mappings.some((mapping) => mapping.coverage === "FULL");
  if (!hasAnyFullMapping && input.gapAcceptedAt) return { status: "PARTIALLY_MET", basis: "ACCEPTED_GAP" };
  const coverageSource = COVERAGE_JUDGED_OVER_APPLICABLE_MAPPINGS ? applicable : mappings;
  if (!coverageSource.some((mapping) => mapping.coverage === "FULL")) {
    return { status: "PARTIALLY_MET", basis: "PARTIAL_COVERAGE" };
  }
  return { status: "MET", basis: "CONTROLS" };
}

export type DerivedStatusCounts = Record<DerivedRequirementStatus, number> & {
  /** Every Requirement, including the Not Applicable ones. */
  total: number;
  /** total minus Not Applicable: the Compliance Percentage denominator (#90). */
  applicable: number;
};

export function emptyDerivedStatusCounts(): DerivedStatusCounts {
  return { MET: 0, PARTIALLY_MET: 0, NOT_MET: 0, NOT_APPLICABLE: 0, total: 0, applicable: 0 };
}

/** Per-status counts; `MET` over `applicable` is the Met ÷ applicable ratio of the Compliance Percentage. */
export function countDerivedStatuses(statuses: DerivedRequirementStatus[]): DerivedStatusCounts {
  const counts = emptyDerivedStatusCounts();
  for (const status of statuses) {
    counts[status] += 1;
    counts.total += 1;
    if (status !== "NOT_APPLICABLE") counts.applicable += 1;
  }
  return counts;
}

/** Sum counts across Systems (pooled: total Met ÷ total applicable, never an average of percentages). */
export function addDerivedStatusCounts(a: DerivedStatusCounts, b: DerivedStatusCounts): DerivedStatusCounts {
  return {
    MET: a.MET + b.MET,
    PARTIALLY_MET: a.PARTIALLY_MET + b.PARTIALLY_MET,
    NOT_MET: a.NOT_MET + b.NOT_MET,
    NOT_APPLICABLE: a.NOT_APPLICABLE + b.NOT_APPLICABLE,
    total: a.total + b.total,
    applicable: a.applicable + b.applicable,
  };
}

/**
 * The Compliance Percentage of a set of counts (one System's, or several pooled
 * with `addDerivedStatusCounts`): Met ÷ applicable, where applicable excludes Not
 * Applicable. Partially Met counts as not Met. One decimal place; null when
 * nothing is applicable (there is nothing to measure against). Pool the
 * counts first and call this once: never average percentages (#90).
 */
export function compliancePercentage(counts: Pick<DerivedStatusCounts, "MET" | "applicable">): number | null {
  if (counts.applicable === 0) return null;
  return Math.round((counts.MET / counts.applicable) * 1000) / 10;
}

/** "61.2%", or an em dash when there is nothing applicable to measure. */
export function formatCompliancePercentage(percentage: number | null): string {
  return percentage === null ? "—" : `${percentage}%`;
}

/**
 * Shown wherever a Compliance Percentage is (product-owner decision 3a on #89):
 * until Organization Control Implementation (M3), a Requirement satisfied only by
 * Organizational Controls (ISO/IEC 27001 clauses 4-10 and the Annex A Requirements
 * mapped only to Organizational Controls) is Not Applicable per System, so it is
 * left out of the percentage.
 */
export const ORGANIZATIONAL_REQUIREMENTS_NOTE =
  "Organizational Requirements aren't counted yet: Requirements met only by Organizational Controls (for example ISO/IEC 27001 clauses 4–10) are Not Applicable per System until Organization Control Implementation arrives.";

export type DerivedStatusFilter = "ALL" | DerivedRequirementStatus;

export function matchesDerivedStatusFilter(status: DerivedRequirementStatus, filter: DerivedStatusFilter): boolean {
  return filter === "ALL" || status === filter;
}

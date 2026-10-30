// Pure Coverage derivation (no Prisma), safe to import from client components.
//
// The rule (CONTEXT.md, Control Mapping; issue #74): a Requirement is
// *covered* iff at least one of its Control Mappings has Full coverage. No
// mappings, or only Partial ones, is a *Coverage Gap*: Partial mappings never
// add up to Full. A Coverage Gap a Compliance Manager has accepted with a
// justification is an *Accepted gap*: shown separately, and counted as
// resolved for coverage metrics (PRD 0001 F-CL.5).

export type MappingCoverage = "FULL" | "PARTIAL";
export type CoverageState = "COVERED" | "GAP" | "ACCEPTED_GAP";

export const COVERAGE_STATE_LABEL: Record<CoverageState, string> = {
  COVERED: "Covered",
  GAP: "Coverage Gap",
  ACCEPTED_GAP: "Accepted gap",
};

/** True iff at least one mapping has Full coverage. */
export function isCovered(mappings: { coverage: MappingCoverage }[]): boolean {
  return mappings.some((mapping) => mapping.coverage === "FULL");
}

/**
 * A Requirement's derived state. An acceptance only counts while it is a gap:
 * a covered Requirement is COVERED whatever its acceptance fields say.
 */
export function deriveCoverageState(requirement: {
  mappings: { coverage: MappingCoverage }[];
  gapAcceptedAt: Date | string | null;
}): CoverageState {
  if (isCovered(requirement.mappings)) return "COVERED";
  return requirement.gapAcceptedAt ? "ACCEPTED_GAP" : "GAP";
}

export type CoverageSummary = {
  total: number;
  covered: number;
  /** Open gaps: Coverage Gaps that have not been accepted. */
  gaps: number;
  accepted: number;
};

export function emptyCoverageSummary(): CoverageSummary {
  return { total: 0, covered: 0, gaps: 0, accepted: 0 };
}

/** total = covered + gaps + accepted. */
export function summarizeCoverage(states: CoverageState[]): CoverageSummary {
  const summary = emptyCoverageSummary();
  for (const state of states) {
    summary.total += 1;
    if (state === "COVERED") summary.covered += 1;
    else if (state === "GAP") summary.gaps += 1;
    else summary.accepted += 1;
  }
  return summary;
}

/**
 * The Requirements grouped by section, as the Coverage view shows them: sections
 * and the codes within a section in numeric-aware order. The CSV export uses the
 * same grouping so the file reads in the page's order.
 */
export function groupBySection<T extends { section: string; code: string }>(requirements: T[]): { section: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const requirement of requirements) {
    groups.set(requirement.section, [...(groups.get(requirement.section) ?? []), requirement]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([section, items]) => ({
      section,
      items: [...items].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    }));
}

export type CoverageFilter = "ALL" | "GAPS" | "ACCEPTED";

/** "Gaps only" is exactly the open gaps (what the header's `gaps` counts); accepted gaps have their own filter. */
export function matchesCoverageFilter(state: CoverageState, filter: CoverageFilter): boolean {
  if (filter === "ALL") return true;
  return filter === "GAPS" ? state === "GAP" : state === "ACCEPTED_GAP";
}

/**
 * An open gap whose Requirement does have Control Mappings, all of them Partial (a Full one would cover it).
 * The Framework list splits its gaps into these and the Requirements nothing is mapped to (#266).
 */
export function isPartialOnlyGap(requirement: {
  mappings: { coverage: MappingCoverage }[];
  gapAcceptedAt: Date | string | null;
}): boolean {
  return deriveCoverageState(requirement) === "GAP" && requirement.mappings.length > 0;
}

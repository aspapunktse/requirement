import { toCsv, type CsvValue } from "@/lib/csv";
import { COVERAGE_STATE_LABEL, groupBySection } from "@/lib/coverage-state";
import type { CoverageRequirement } from "@/lib/framework-coverage";

// The Framework Coverage CSV (PRD 0001 F-OUT.5, #151). Pure: it turns the rows
// `loadFrameworkCoverage` returns into a header and rows; the file is the whole
// view, whatever filter the page has on.

export const COVERAGE_CSV_HEADER = [
  "Section",
  "Requirement code",
  "Requirement title",
  "Control code",
  "Control title",
  "Coverage",
  "Rationale",
  "State",
  "Gap acceptance justification",
] as const;

/**
 * One row per Requirement and mapped Control, in the page's order (sections, then
 * codes; the Controls by code). A Requirement with no Control Mapping gets one row
 * with the Control columns empty. The state uses the page's wording (Covered /
 * Coverage Gap / Accepted gap); the gap acceptance justification is on every row of
 * an Accepted gap, and empty otherwise. The Requirement text and who accepted the
 * gap, and when, are left out.
 */
export function coverageCsvRows(requirements: CoverageRequirement[]): CsvValue[][] {
  return groupBySection(requirements).flatMap(({ section, items }) =>
    items.flatMap((requirement): CsvValue[][] => {
      const state = COVERAGE_STATE_LABEL[requirement.state];
      const justification = requirement.state === "ACCEPTED_GAP" ? requirement.gapJustification : null;
      const lead = [section, requirement.code, requirement.title];
      if (requirement.mappings.length === 0) return [[...lead, "", "", "", "", state, justification]];
      return requirement.mappings.map((mapping) => [
        ...lead,
        mapping.control.code,
        mapping.control.title,
        mapping.coverage === "FULL" ? "Full" : "Partial",
        mapping.rationale,
        state,
        justification,
      ]);
    }),
  );
}

export function frameworkCoverageCsv(requirements: CoverageRequirement[]): string {
  return toCsv(COVERAGE_CSV_HEADER, coverageCsvRows(requirements));
}

import type { ControlAssessmentStatus } from "@prisma/client";
import { toCsv, type CsvValue } from "@/lib/csv";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { APPLICABILITY_LABEL, type StatementOfApplicabilityRow } from "@/lib/statement-of-applicability-rules";

// The Statement of Applicability CSV (PRD 0001 F-OUT.5, #151). Pure: it turns the
// rows `loadStatementOfApplicability` returns into a header and rows. The file is
// every Control, whatever filter the page has on.

const STATUSES = Object.keys(CONTROL_ASSESSMENT_STATUS_LABEL) as ControlAssessmentStatus[];

export const SOA_CSV_HEADER = [
  "Control code",
  "Control title",
  "Applicability",
  "Included",
  "Inclusion justification",
  "Exclusion justification",
  "Exclusion justification missing",
  "Organization status",
  "Systems",
  ...STATUSES.map((status) => `Systems ${CONTROL_ASSESSMENT_STATUS_LABEL[status]}`),
] as const;

/**
 * One row per Control, in the page's order. "Included" is Included / Excluded. The
 * exclusion justification is the authored text of an excluded Control (empty while
 * included or when none is written) and "Exclusion justification missing" is Yes for
 * an excluded Control without one, No otherwise. The Organization status is its label
 * (empty when the Control has none); "Systems" is the number of Systems the Control
 * applies to, followed by one count column per effective status, so a spreadsheet can
 * filter and sum them. A Control with no Systems rollup (Organizational, or excluded)
 * leaves all of those empty; one that applies to no System yet has 0 in each.
 */
export function soaCsvRows(rows: StatementOfApplicabilityRow[]): CsvValue[][] {
  return rows.map((row) => [
    row.code,
    row.title,
    APPLICABILITY_LABEL[row.applicability],
    row.included ? "Included" : "Excluded",
    row.inclusionJustification,
    row.exclusionJustification,
    row.justificationMissing ? "Yes" : "No",
    row.organizationStatus ? CONTROL_ASSESSMENT_STATUS_LABEL[row.organizationStatus] : "",
    row.systemRollup ? row.systemRollup.total : "",
    ...STATUSES.map((status) => (row.systemRollup ? row.systemRollup.counts[status] : "")),
  ]);
}

export function statementOfApplicabilityCsv(rows: StatementOfApplicabilityRow[]): string {
  return toCsv(SOA_CSV_HEADER, soaCsvRows(rows));
}

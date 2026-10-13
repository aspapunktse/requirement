import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import { COVERAGE_CSV_HEADER, coverageCsvRows, frameworkCoverageCsv } from "@/lib/framework-coverage-csv";
import type { CoverageRequirement } from "@/lib/framework-coverage";
import { SOA_CSV_HEADER, soaCsvRows, statementOfApplicabilityCsv } from "@/lib/statement-of-applicability-csv";
import type { StatementOfApplicabilityRow } from "@/lib/statement-of-applicability-rules";
import { parseCsv } from "@/test/csv-parse";

const mapping = (code: string, coverage: "FULL" | "PARTIAL", rationale: string | null = null) => ({
  id: `m-${code}-${coverage}`,
  coverage,
  rationale,
  control: { id: `c-${code}`, code, title: `Control ${code}`, originFramework: null },
});
const requirement = (over: Partial<CoverageRequirement>): CoverageRequirement => ({
  id: "r",
  code: "1",
  section: "Article 21",
  title: "Title",
  state: "GAP",
  gapAcceptedAt: null,
  gapAcceptedBy: null,
  gapJustification: null,
  mappings: [],
  ...over,
});

describe("coverageCsvRows", () => {
  it("has one row per Requirement and mapped Control and one row for an unmapped Requirement", () => {
    const rows = coverageCsvRows([
      requirement({ code: "Art. 1", state: "COVERED", mappings: [mapping("A.5.1", "FULL", "Policy, signed"), mapping("A.5.2", "PARTIAL")] }),
      requirement({ code: "Art. 2" }),
    ]);
    expect(rows).toEqual([
      ["Article 21", "Art. 1", "Title", "A.5.1", "Control A.5.1", "Full", "Policy, signed", "Covered", null],
      ["Article 21", "Art. 1", "Title", "A.5.2", "Control A.5.2", "Partial", null, "Covered", null],
      ["Article 21", "Art. 2", "Title", "", "", "", "", "Coverage Gap", null],
    ]);
    expect(rows.every((row) => row.length === COVERAGE_CSV_HEADER.length)).toBe(true);
  });

  it("carries the acceptance justification on every row of an accepted gap only", () => {
    const rows = coverageCsvRows([
      requirement({
        code: "Art. 3",
        state: "ACCEPTED_GAP",
        gapJustification: "Out of scope, \"by design\"",
        mappings: [mapping("A.1", "PARTIAL"), mapping("A.2", "PARTIAL")],
      }),
      // A stored justification on a Requirement that is no longer an accepted gap is not exported.
      requirement({ code: "Art. 4", state: "COVERED", gapJustification: "stale", mappings: [mapping("A.3", "FULL")] }),
    ]);
    expect(rows.map((row) => [row[1], row[7], row[8]])).toEqual([
      ["Art. 3", "Accepted gap", "Out of scope, \"by design\""],
      ["Art. 3", "Accepted gap", "Out of scope, \"by design\""],
      ["Art. 4", "Covered", null],
    ]);
  });

  it("orders by section and code as the page does (numeric-aware)", () => {
    const rows = coverageCsvRows([
      requirement({ section: "B", code: "1" }),
      requirement({ section: "A", code: "A.10" }),
      requirement({ section: "A", code: "A.2" }),
    ]);
    expect(rows.map((row) => `${row[0]}/${row[1]}`)).toEqual(["A/A.2", "A/A.10", "B/1"]);
  });

  it("is a parseable file with the BOM, the header and the neutralised cells", () => {
    const csv = frameworkCoverageCsv([requirement({ code: "-1", title: "=SUM(1)" })]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const parsed = parseCsv(csv.slice(CSV_BOM.length));
    expect(parsed[0]).toEqual([...COVERAGE_CSV_HEADER]);
    expect(parsed[1].slice(1, 3)).toEqual(["'-1", "'=SUM(1)"]);
  });
});

const ZERO = { NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, NOT_APPLICABLE: 0, WAIVED: 0 };
const soaRow = (over: Partial<StatementOfApplicabilityRow>): StatementOfApplicabilityRow => ({
  controlId: "c",
  code: "A.5.1",
  title: "Policies",
  applicability: "ORGANIZATIONAL",
  included: true,
  appliesToOrganization: true,
  appliesToSystemCount: 0,
  inclusionJustification: "ISO/IEC 27001:2022 A.5.1",
  exclusionJustification: null,
  justificationMissing: false,
  organizationStatus: "IN_PROGRESS",
  systemRollup: null,
  ...over,
});

describe("soaCsvRows", () => {
  it("has one row per Control with the status columns", () => {
    const rows = soaCsvRows([
      soaRow({}),
      soaRow({
        code: "A.8.24",
        applicability: "BOTH",
        organizationStatus: "FULFILLED",
        appliesToSystemCount: 3,
        systemRollup: { total: 3, counts: { ...ZERO, FULFILLED: 2, NOT_STARTED: 1 } },
      }),
    ]);
    expect(rows[0]).toEqual([
      "A.5.1", "Policies", "Organizational", "Included", "ISO/IEC 27001:2022 A.5.1", null, "No", "In Progress", "", "", "", "", "", "",
    ]);
    expect(rows[1].slice(2, 4)).toEqual(["Both", "Included"]);
    expect(rows[1].slice(7)).toEqual(["Fulfilled", 3, 1, 0, 2, 0, 0]);
    expect(rows.every((row) => row.length === SOA_CSV_HEADER.length)).toBe(true);
    expect(SOA_CSV_HEADER.slice(8)).toEqual([
      "Systems", "Systems Not Started", "Systems In Progress", "Systems Fulfilled", "Systems Not Applicable", "Systems Waived",
    ]);
  });

  it("marks an excluded Control with its justification or as missing, and leaves the statuses empty", () => {
    const excluded = { included: false, appliesToOrganization: false, inclusionJustification: "", organizationStatus: null };
    const rows = soaCsvRows([
      soaRow({ ...excluded, code: "X.1", applicability: "PER_SYSTEM", exclusionJustification: "Not in scope, \"ever\"" }),
      soaRow({ ...excluded, code: "X.2", applicability: "PER_SYSTEM", justificationMissing: true }),
    ]);
    expect(rows.map((row) => [row[3], row[5], row[6], row[7], row[8]])).toEqual([
      ["Excluded", "Not in scope, \"ever\"", "No", "", ""],
      ["Excluded", null, "Yes", "", ""],
    ]);
  });

  it("writes 0 in every Systems column for an included Per-System Control no System uses yet", () => {
    const [row] = soaCsvRows([
      soaRow({ applicability: "PER_SYSTEM", organizationStatus: null, systemRollup: { total: 0, counts: { ...ZERO } } }),
    ]);
    expect(row.slice(7)).toEqual(["", 0, 0, 0, 0, 0, 0]);
  });

  it("is a parseable file with the BOM and the header", () => {
    const csv = statementOfApplicabilityCsv([soaRow({ title: "=cmd|x" })]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const parsed = parseCsv(csv.slice(CSV_BOM.length));
    expect(parsed[0]).toEqual([...SOA_CSV_HEADER]);
    expect(parsed[1][1]).toBe("'=cmd|x");
  });
});

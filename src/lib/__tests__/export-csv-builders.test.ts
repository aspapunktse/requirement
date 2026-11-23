import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import { COVERAGE_CSV_HEADER, coverageCsvRows, frameworkCoverageCsv } from "@/lib/framework-coverage-csv";
import type { CoverageRequirement } from "@/lib/framework-coverage";
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

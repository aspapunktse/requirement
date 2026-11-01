import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { CSV_BOM } from "@/lib/csv";
import { SOA_CSV_HEADER } from "@/lib/statement-of-applicability-csv";
import { parseCsv } from "@/test/csv-parse";
import {
  VIEWS,
  appliesText,
  describeCounts,
  frameworkOptions,
  groupFigures,
  groupRows,
  implGroupOf,
  matchesFilters,
  nextMissingId,
  percentText,
  progressOf,
  searchText,
  totalsOf,
  viewCsv,
  viewCsvFilename,
  type Filters,
} from "../soa-logic";
import type { SoaLedgerRow } from "../soa-types";

/** The pure rules of the Statement of Applicability page (#272): no database, no React. */

const counts = (over: Partial<Record<ControlAssessmentStatus, number>> = {}) => ({ NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, NOT_APPLICABLE: 0, WAIVED: 0, ...over });

function row(code: string, over: Partial<SoaLedgerRow> = {}): SoaLedgerRow {
  return {
    controlId: `id-${code}`,
    code,
    title: `Title ${code}`,
    applicability: "ORGANIZATIONAL",
    included: true,
    appliesToOrganization: true,
    appliesToSystemCount: 0,
    inclusionJustification: "",
    exclusionJustification: null,
    justificationMissing: false,
    organizationStatus: "NOT_STARTED",
    systemRollup: null,
    description: "d",
    category: "Domain A",
    sourceKey: "base",
    sourceLabel: "Base Control Library",
    ownerName: null,
    requirements: [],
    systemStatuses: [],
    hiddenSystemCount: 0,
    ...over,
  };
}

const excluded = (code: string, over: Partial<SoaLedgerRow> = {}) =>
  row(code, { included: false, appliesToOrganization: false, organizationStatus: null, systemRollup: null, justificationMissing: true, ...over });

const perSystem = (code: string, rollup: Partial<Record<ControlAssessmentStatus, number>>, over: Partial<SoaLedgerRow> = {}) => {
  const c = counts(rollup);
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  return row(code, { applicability: "PER_SYSTEM", appliesToOrganization: false, organizationStatus: null, appliesToSystemCount: total, systemRollup: { total, counts: c }, ...over });
};

describe("progressOf", () => {
  it("is null for an excluded Control", () => {
    expect(progressOf(excluded("X"))).toBeNull();
  });

  it("scores the Organization's status: Fulfilled 1, In Progress 0.5, Not Started 0", () => {
    expect(progressOf(row("A", { organizationStatus: "FULFILLED" }))).toBe(1);
    expect(progressOf(row("A", { organizationStatus: "IN_PROGRESS" }))).toBe(0.5);
    expect(progressOf(row("A", { organizationStatus: "NOT_STARTED" }))).toBe(0);
  });

  it("scores a Per-System Control by the share of Systems done: Fulfilled, Waived and Not Applicable", () => {
    expect(progressOf(perSystem("S", { FULFILLED: 1, WAIVED: 1, NOT_APPLICABLE: 1, IN_PROGRESS: 1 }))).toBe(0.75);
    expect(progressOf(perSystem("S", { NOT_STARTED: 3, IN_PROGRESS: 1 }))).toBe(0);
  });

  it("averages the Organization and the Systems for a Both Control, and ignores a Both Control with no Systems yet", () => {
    const both = row("B", { applicability: "BOTH", organizationStatus: "FULFILLED", appliesToSystemCount: 2, systemRollup: { total: 2, counts: counts({ NOT_STARTED: 2 }) } });
    expect(progressOf(both)).toBe(0.5);
    const noSystems = row("B", { applicability: "BOTH", organizationStatus: "IN_PROGRESS", systemRollup: { total: 0, counts: counts() } });
    expect(progressOf(noSystems)).toBe(0.5);
  });
});

describe("views", () => {
  const rows = [
    row("A.1", { organizationStatus: "FULFILLED" }),
    row("A.2"),
    perSystem("A.3", { IN_PROGRESS: 1, NOT_STARTED: 1 }),
    perSystem("A.4", { NOT_STARTED: 2 }),
    excluded("A.5"),
    excluded("A.6", { justificationMissing: false, exclusionJustification: "Out of scope" }),
  ];
  const codes = (key: (typeof VIEWS)[number]["key"]) => rows.filter(VIEWS.find((view) => view.key === key)!.test).map((r) => r.code);

  it("All, Included and Excluded split the Statement", () => {
    expect(codes("all")).toHaveLength(6);
    expect(codes("included")).toEqual(["A.1", "A.2", "A.3", "A.4"]);
    expect(codes("excluded")).toEqual(["A.5", "A.6"]);
  });

  it("Missing justification is the excluded Controls without one", () => {
    expect(codes("missing")).toEqual(["A.5"]);
  });

  it("Not started anywhere is the included Controls with no progress in the Organization or any System", () => {
    expect(codes("notstarted")).toEqual(["A.2", "A.4"]);
  });
});

describe("totalsOf", () => {
  it("counts inclusion, the missing justifications, the Organization's statuses and every System Assessment of an included Control", () => {
    const totals = totalsOf([
      row("A", { organizationStatus: "FULFILLED" }),
      row("B", { organizationStatus: "IN_PROGRESS", applicability: "BOTH", appliesToSystemCount: 3, systemRollup: { total: 3, counts: counts({ FULFILLED: 2, WAIVED: 1 }) } }),
      perSystem("C", { NOT_STARTED: 2, NOT_APPLICABLE: 1 }),
      excluded("D"),
      excluded("E", { justificationMissing: false, exclusionJustification: "x" }),
    ]);
    expect(totals).toMatchObject({ all: 5, included: 3, excluded: 2, missing: 1, orgTotal: 2, sysTotal: 6 });
    expect(totals.org).toMatchObject({ FULFILLED: 1, IN_PROGRESS: 1, NOT_STARTED: 0 });
    expect(totals.sys).toMatchObject({ FULFILLED: 2, WAIVED: 1, NOT_STARTED: 2, NOT_APPLICABLE: 1, IN_PROGRESS: 0 });
  });

  it("shows a dash for a share of nothing", () => {
    expect(percentText(0, 0)).toBe("—");
    expect(percentText(1, 3)).toBe("33%");
  });
});

describe("search and filters", () => {
  const filters = (over: Partial<Filters> = {}): Filters => ({ view: "all", query: "", framework: "", applies: "", ...over });
  const iso = row("A.5.1", { title: "Policies for information security", requirements: [{ framework: "ISO/IEC 27001:2022", codes: ["A.5.1", "5.2"] }], inclusionJustification: "ISO/IEC 27001:2022 A.5.1, 5.2" });
  const ccm = row("GRC-02", { category: "Governance", requirements: [{ framework: "CSA CCM:4.1.1", codes: ["GRC-02"] }] });
  const out = excluded("DCS-01", { category: "Datacenter", exclusionJustification: "We run no datacenter of our own", justificationMissing: false });

  it("searches code, title, domain, the authored justification and the Requirement codes, ignoring case", () => {
    expect(matchesFilters(iso, filters({ query: "a.5.1" }))).toBe(true);
    expect(matchesFilters(iso, filters({ query: "POLICIES" }))).toBe(true);
    expect(matchesFilters(ccm, filters({ query: "governance" }))).toBe(true);
    expect(matchesFilters(out, filters({ query: "own" }))).toBe(true);
    expect(matchesFilters(iso, filters({ query: "5.2" }))).toBe(true);
    expect(matchesFilters(ccm, filters({ query: "policies" }))).toBe(false);
    expect(searchText(iso)).toContain("27001");
  });

  it("filters by Published Framework", () => {
    expect(matchesFilters(iso, filters({ framework: "ISO/IEC 27001:2022" }))).toBe(true);
    expect(matchesFilters(ccm, filters({ framework: "ISO/IEC 27001:2022" }))).toBe(false);
    expect(matchesFilters(out, filters({ framework: "ISO/IEC 27001:2022" }))).toBe(false);
    expect(frameworkOptions([iso, ccm, out])).toEqual(["CSA CCM:4.1.1", "ISO/IEC 27001:2022"]);
  });

  it("filters by what the Control applies to", () => {
    const org = row("O");
    const sys = perSystem("S", { FULFILLED: 1 });
    const both = row("B", { applicability: "BOTH", appliesToSystemCount: 2, systemRollup: { total: 2, counts: counts({ FULFILLED: 2 }) } });
    const pick = (applies: Filters["applies"]) => [org, sys, both, out].filter((r) => matchesFilters(r, filters({ applies }))).map((r) => r.code);
    expect(pick("")).toEqual(["O", "S", "B", "DCS-01"]);
    expect(pick("org")).toEqual(["O"]);
    expect(pick("sys")).toEqual(["S"]);
    expect(pick("both")).toEqual(["B"]);
    expect(appliesText(both)).toBe("Organization + 2 Systems");
    expect(appliesText(sys)).toBe("1 System");
    expect(appliesText(out)).toBe("Nothing");
  });

  it("combines the view with the rest", () => {
    expect(matchesFilters(out, filters({ view: "missing" }))).toBe(false);
    expect(matchesFilters(excluded("M"), filters({ view: "missing", query: "m" }))).toBe(true);
  });
});

describe("grouping", () => {
  const a = row("A.1", { category: "A.5 Organizational", organizationStatus: "FULFILLED" });
  const b = row("A.2", { category: "A.8 Technological" });
  const c = row("GRC-1", { category: "A.5 Organizational", sourceKey: "fw-1", sourceLabel: "Supplementary · Zeta:1", organizationStatus: "IN_PROGRESS" });
  const d = excluded("DCS-1", { category: "Datacenter", sourceKey: "fw-2", sourceLabel: "Supplementary · Alpha:1" });
  const rows = [a, b, c, d];

  it("groups by domain in order of first appearance", () => {
    expect(groupRows(rows, "domain").map((g) => [g.name, g.rows.map((r) => r.code)])).toEqual([
      ["A.5 Organizational", ["A.1", "GRC-1"]],
      ["A.8 Technological", ["A.2"]],
      ["Datacenter", ["DCS-1"]],
    ]);
  });

  it("groups by source: the base Control Library first, then each origin Framework by label", () => {
    expect(groupRows(rows, "source").map((g) => [g.name, g.rows.map((r) => r.code)])).toEqual([
      ["Base Control Library", ["A.1", "A.2"]],
      ["Supplementary · Alpha:1", ["DCS-1"]],
      ["Supplementary · Zeta:1", ["GRC-1"]],
    ]);
  });

  it("groups by implementation in the fixed order, from Excluded to Done", () => {
    expect([implGroupOf(d), implGroupOf(b), implGroupOf(c), implGroupOf(a)]).toEqual(["Excluded", "Not started", "Under way", "Done"]);
    expect(implGroupOf(row("M", { applicability: "BOTH", organizationStatus: "FULFILLED", appliesToSystemCount: 3, systemRollup: { total: 3, counts: counts({ FULFILLED: 2, NOT_STARTED: 1 }) } }))).toBe("Mostly done");
    expect(groupRows(rows, "impl").map((g) => g.name)).toEqual(["Excluded", "Not started", "Under way", "Done"]);
  });

  it("makes one unnamed group without grouping", () => {
    expect(groupRows(rows, "")).toEqual([{ key: "", name: "", rows }]);
  });

  it("gives a group's counts and its average progress over the included Controls", () => {
    expect(groupFigures(rows)).toEqual({ included: 3, excluded: 1, missing: 1, progress: (1 + 0 + 0.5) / 3 });
    expect(groupFigures([d])).toEqual({ included: 0, excluded: 1, missing: 1, progress: null });
  });
});

describe("the CSV of the view", () => {
  it("has the server export's columns and the rows given, in order", () => {
    const csv = viewCsv([
      row("A.2", { title: "Second", organizationStatus: "FULFILLED" }),
      excluded("A.1", { title: "First, with \"quotes\"", exclusionJustification: "Not here", justificationMissing: false }),
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed[0]).toEqual([...SOA_CSV_HEADER]);
    expect(parsed.slice(1).map((line) => line.slice(0, 4))).toEqual([
      ["A.2", "Second", "Organizational", "Included"],
      ["A.1", "First, with \"quotes\"", "Organizational", "Excluded"],
    ]);
    expect(parsed[2][5]).toBe("Not here");
    expect(parsed[2][6]).toBe("No");
  });

  it("names the file by the date", () => {
    expect(viewCsvFilename(new Date("2026-10-30T12:00:00Z"))).toBe("Statement-of-Applicability-view-2026-10-30.csv");
  });
});

describe("the next missing justification", () => {
  const rows = [excluded("A"), row("B"), excluded("C"), excluded("D", { justificationMissing: false, exclusionJustification: "x" }), excluded("E")];
  const order = rows.map((r) => r.controlId);

  it("is the next missing Control after the saved one", () => {
    expect(nextMissingId(order, rows, "id-A")).toBe("id-C");
    expect(nextMissingId(order, rows, "id-C")).toBe("id-E");
  });

  it("wraps round to the start, and is null when nothing else is missing", () => {
    expect(nextMissingId(order, rows, "id-E")).toBe("id-A");
    expect(nextMissingId(order, [excluded("A"), row("B")], "id-A")).toBeNull();
  });

  it("describes counts without the zeros", () => {
    expect(describeCounts(counts({ FULFILLED: 2, IN_PROGRESS: 1 }))).toBe("2 Fulfilled, 1 In Progress");
  });
});

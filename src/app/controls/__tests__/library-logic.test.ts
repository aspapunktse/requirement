import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import { parseCsv } from "@/test/csv-parse";
import {
  CSV_HEADER,
  DEFAULT_SORT,
  NO_FILTERS,
  clearFacet,
  codeFromHash,
  facetOptions,
  filterChips,
  filterRows,
  groupRows,
  hasFilters,
  hashForCode,
  highlightParts,
  libraryCsv,
  libraryCsvFilename,
  mappingsByFramework,
  nextSort,
  orgStatusCounts,
  percentFulfilled,
  sortRows,
  toggleFacetValue,
  viewTest,
  visibleIds,
  type Filters,
} from "../library-logic";
import { OLIVE, ROWS } from "./fixtures";

const codes = (rows: { code: string }[]) => rows.map((row) => row.code);
const filters = (over: Partial<Filters> = {}): Filters => ({ ...NO_FILTERS, ...over });

describe("the stat cards' views", () => {
  const count = (view: Parameters<typeof viewTest>[0]) => codes(ROWS.filter(viewTest(view, OLIVE)));

  it("selects the Controls that need an owner, are not mapped, are not started, or are owned by the user", () => {
    expect(count("all")).toHaveLength(8);
    expect(count("noowner")).toEqual(["A.5.3"]);
    expect(count("unmapped")).toEqual(["A.5.3", "CCM-1"]);
    expect(count("notstarted")).toEqual(["A.5.3", "4.1"]);
    expect(count("mine")).toEqual(["A.5.1", "A.8.1", "4.1", "CCM-1"]);
  });
});

describe("the Organization status ring", () => {
  it("counts only Organizational and Both Controls, and the share Fulfilled over them", () => {
    expect(orgStatusCounts(ROWS)).toEqual({ NOT_STARTED: 2, IN_PROGRESS: 1, FULFILLED: 2, WAIVED: 1, NOT_APPLICABLE: 1 });
    expect(percentFulfilled(ROWS)).toBe(29);
    expect(percentFulfilled([])).toBe(0);
  });
});

describe("facet options and their live counts", () => {
  const options = (key: Parameters<typeof facetOptions>[1], f: Filters = NO_FILTERS) => facetOptions(ROWS, key, f, OLIVE).map((option) => [option.label, option.count]);

  it("lists Source with the base first, then the Supplementary ones", () => {
    expect(options("source")).toEqual([
      ["Base · ISO/IEC 27001:2022", 6],
      ["Supplementary", 1],
      ["Supplementary · CSA CCM:4.1", 1],
    ]);
  });

  it("lists Organization status in order with Per System only last", () => {
    expect(options("status")).toEqual([
      ["Not Started", 2],
      ["In Progress", 1],
      ["Fulfilled", 2],
      ["Waived", 1],
      ["Not Applicable", 1],
      ["Per System only", 1],
    ]);
  });

  it("lists Applicability in the catalogue's order", () => {
    expect(options("applicability")).toEqual([
      ["Organizational", 5],
      ["Per-System", 1],
      ["Both", 2],
    ]);
  });

  it("counts Unassigned among the Control Owners, the largest first", () => {
    expect(options("owner")).toEqual([
      ["Olive Owner", 4],
      ["Pat Peer", 3],
      ["Unassigned", 1],
    ]);
  });

  it("counts a Control in each of its Deployment Facets, and the ones with none as Any", () => {
    expect(options("facet")).toEqual([
      ["Any", 6],
      ["Cloud", 2],
      ["On-premises", 1],
    ]);
  });

  it("lists Sensitivity Level as From <level>, then None", () => {
    expect(options("sensitivity")).toEqual([
      ["From Sensitive", 1],
      ["None", 7],
    ]);
  });

  it("orders Categories by count, then name", () => {
    expect(options("category").map(([label]) => label)).toEqual(["A.5 Organizational controls", "A.8 Technological controls", "4 Context of the organization", "A.6 People controls"]);
  });

  it("honours every other filter in a facet's counts, but not its own", () => {
    const mine = filters({ view: "mine" });
    expect(options("source", mine)).toEqual([
      ["Base · ISO/IEC 27001:2022", 3],
      ["Supplementary", 0],
      ["Supplementary · CSA CCM:4.1", 1],
    ]);
    // Owner counts ignore the Owner selection itself: ticking Pat shows Pat's, ticking Olive too would add Olive's.
    const olive = filters({ facets: { owner: [OLIVE] } });
    expect(options("owner", olive)).toEqual([
      ["Olive Owner", 4],
      ["Pat Peer", 3],
      ["Unassigned", 1],
    ]);
    // ...but another facet's counts follow it
    expect(options("status", olive)).toEqual([
      ["Not Started", 1],
      ["In Progress", 0],
      ["Fulfilled", 2],
      ["Waived", 0],
      ["Not Applicable", 0],
      ["Per System only", 1],
    ]);
    expect(options("source", filters({ query: "ccm" }))).toEqual([
      ["Base · ISO/IEC 27001:2022", 0],
      ["Supplementary", 1],
      ["Supplementary · CSA CCM:4.1", 1],
    ]);
  });
});

describe("filtering", () => {
  it("passes a row when it has any ticked value of a facet and passes every facet", () => {
    expect(codes(filterRows(ROWS, filters({ facets: { source: ["fw:ccm", "sup"] } }), OLIVE))).toEqual(["CCM-1", "CCM-2"]);
    expect(codes(filterRows(ROWS, filters({ facets: { source: ["fw:ccm", "sup"], owner: [OLIVE] } }), OLIVE))).toEqual(["CCM-1"]);
    expect(codes(filterRows(ROWS, filters({ facets: { facet: ["Cloud"] } }), OLIVE))).toEqual(["A.5.3", "A.8.1"]);
    expect(codes(filterRows(ROWS, filters({ facets: { facet: [""] } }), OLIVE))).toHaveLength(6);
    expect(codes(filterRows(ROWS, filters({ facets: { status: ["PER_SYSTEM"] } }), OLIVE))).toEqual(["A.8.1"]);
    expect(codes(filterRows(ROWS, filters({ facets: { sensitivity: ["none"] } }), OLIVE))).toHaveLength(7);
  });

  it("combines a stat card with the facets and the search", () => {
    expect(codes(filterRows(ROWS, filters({ view: "mine", facets: { applicability: ["BOTH"] } }), OLIVE))).toEqual(["CCM-1"]);
    expect(codes(filterRows(ROWS, filters({ view: "unmapped", query: "ccm" }), OLIVE))).toEqual(["CCM-1"]);
  });

  it("searches code, title, description, category and owner, ignoring case", () => {
    expect(codes(filterRows(ROWS, filters({ query: "ccm-" }), OLIVE))).toEqual(["CCM-1", "CCM-2"]);
    expect(codes(filterRows(ROWS, filters({ query: "DESCRIPTION OF A.6" }), OLIVE))).toEqual(["A.6.1"]);
    expect(codes(filterRows(ROWS, filters({ query: "context" }), OLIVE))).toEqual(["4.1"]);
    expect(codes(filterRows(ROWS, filters({ query: "pat peer" }), OLIVE))).toEqual(["A.5.2", "A.6.1", "CCM-2"]);
    expect(codes(filterRows(ROWS, filters({ query: "  nothing like this " }), OLIVE))).toEqual([]);
  });

  it("toggles and clears a facet's values, dropping a facet with none ticked", () => {
    const one = toggleFacetValue({}, "owner", OLIVE);
    expect(one).toEqual({ owner: [OLIVE] });
    expect(toggleFacetValue(one, "owner", "u-pat")).toEqual({ owner: [OLIVE, "u-pat"] });
    expect(toggleFacetValue(one, "owner", OLIVE)).toEqual({});
    expect(clearFacet({ owner: [OLIVE], source: ["base"] }, "owner")).toEqual({ source: ["base"] });
  });

  it("makes one chip per ticked value and for the stat card, and knows when a filter is active", () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters(filters({ query: " " }))).toBe(false);
    const active = filters({ view: "noowner", facets: { owner: [OLIVE], source: ["fw:ccm"] } });
    expect(hasFilters(active)).toBe(true);
    expect(filterChips(ROWS, active).map((chip) => `${chip.label}: ${chip.value}`)).toEqual(["View: Needs an owner", "Source: Supplementary · CSA CCM:4.1", "Control Owner: Olive Owner"]);
  });
});

describe("highlighting", () => {
  it("cuts the text at every occurrence of the query, ignoring case", () => {
    expect(highlightParts("Access Control", "con")).toEqual([
      { text: "Access ", match: false },
      { text: "Con", match: true },
      { text: "trol", match: false },
    ]);
    expect(highlightParts("aXa a", "A").map((part) => `${part.match ? "[" : ""}${part.text}${part.match ? "]" : ""}`).join("")).toBe("[a]X[a] [a]");
  });

  it("returns the text whole without a query or a match", () => {
    expect(highlightParts("Access", "")).toEqual([{ text: "Access", match: false }]);
    expect(highlightParts("Access", "zzz")).toEqual([{ text: "Access", match: false }]);
  });
});

describe("sorting", () => {
  it("sorts by code naturally, by default", () => {
    expect(codes(sortRows([...ROWS].reverse(), DEFAULT_SORT))).toEqual(["4.1", "A.5.1", "A.5.2", "A.5.3", "A.6.1", "A.8.1", "CCM-1", "CCM-2"]);
  });

  it("sorts by the number of Requirements satisfied, ties by code", () => {
    expect(codes(sortRows(ROWS, { key: "maps", dir: 1 }))).toEqual(["A.5.3", "CCM-1", "4.1", "A.5.1", "A.6.1", "A.8.1", "CCM-2", "A.5.2"]);
    expect(codes(sortRows(ROWS, { key: "maps", dir: -1 }))[0]).toBe("A.5.2");
  });

  it("sorts by Owner with the unassigned last whichever way", () => {
    expect(codes(sortRows(ROWS, { key: "owner", dir: 1 }))).toEqual(["4.1", "A.5.1", "A.8.1", "CCM-1", "A.5.2", "A.6.1", "CCM-2", "A.5.3"]);
    expect(codes(sortRows(ROWS, { key: "owner", dir: -1 }))).toEqual(["A.5.2", "A.6.1", "CCM-2", "4.1", "A.5.1", "A.8.1", "CCM-1", "A.5.3"]);
  });

  it("sorts by status in the status order, Per System only last", () => {
    expect(codes(sortRows(ROWS, { key: "status", dir: 1 }))).toEqual(["4.1", "A.5.3", "A.5.2", "A.5.1", "CCM-1", "A.6.1", "CCM-2", "A.8.1"]);
  });

  it("flips the direction on the same column and starts ascending on another", () => {
    expect(nextSort({ key: "code", dir: 1 }, "code")).toEqual({ key: "code", dir: -1 });
    expect(nextSort({ key: "code", dir: -1 }, "code")).toEqual({ key: "code", dir: 1 });
    expect(nextSort({ key: "code", dir: -1 }, "owner")).toEqual({ key: "owner", dir: 1 });
  });
});

describe("grouping", () => {
  const sorted = sortRows(ROWS, DEFAULT_SORT);
  const names = (by: Parameters<typeof groupRows>[1]) => groupRows(sorted, by).map((group) => `${group.name} (${group.rows.length})`);

  it("groups by Category, the clauses before Annex A", () => {
    expect(names("category")).toEqual(["4 Context of the organization (1)", "A.5 Organizational controls (3)", "A.6 People controls (1)", "A.8 Technological controls (3)"]);
  });

  it("groups by Owner with Unassigned first, and counts the owned Controls of each group", () => {
    expect(names("owner")).toEqual(["Unassigned (1)", "Olive Owner (4)", "Pat Peer (3)"]);
    const groups = groupRows(sorted, "category");
    expect(groups.map((group) => group.owned)).toEqual([1, 2, 1, 3]);
  });

  it("groups by Organization status, Per System only last", () => {
    expect(names("status")).toEqual(["Not Started (2)", "In Progress (1)", "Fulfilled (2)", "Waived (1)", "Not Applicable (1)", "Per System only (1)"]);
  });

  it("groups by Source, the base first", () => {
    expect(names("source")).toEqual(["Base · ISO/IEC 27001:2022 (6)", "Supplementary (1)", "Supplementary · CSA CCM:4.1 (1)"]);
  });

  it("makes one unnamed group without grouping, and none when there are no rows", () => {
    expect(names("none")).toEqual([" (8)"]);
    expect(groupRows([], "none")).toEqual([]);
  });

  it("keeps the rows of a group in the order they were given", () => {
    expect(codes(groupRows(sortRows(ROWS, { key: "code", dir: -1 }), "category")[0].rows)).toEqual(["4.1"]);
    expect(codes(groupRows(sortRows(ROWS, { key: "code", dir: -1 }), "category")[3].rows)).toEqual(["CCM-2", "CCM-1", "A.8.1"]);
  });

  it("renders the first rows of the groups that are not collapsed", () => {
    const groups = groupRows(sorted, "category");
    expect([...visibleIds(groups, new Set(), 3)]).toEqual(["id-4.1", "id-A.5.1", "id-A.5.2"]);
    expect([...visibleIds(groups, new Set(["4 Context of the organization"]), 3)]).toEqual(["id-A.5.1", "id-A.5.2", "id-A.5.3"]);
    expect(visibleIds(groups, new Set(), 80).size).toBe(8);
  });
});

describe("the Requirements a Control satisfies", () => {
  it("groups the mappings by Framework, keeping their order and coverage", () => {
    const groups = mappingsByFramework(ROWS[1]);
    expect(groups.map((group) => group.framework.label)).toEqual(["ISO/IEC 27001:2022", "CSA CCM:4.1"]);
    expect(groups[1].mappings.map((m) => [m.requirementCode, m.coverage])).toEqual([["R-A52-2", "PARTIAL"]]);
    expect(mappingsByFramework(ROWS[2])).toEqual([]);
  });
});

describe("the URL hash", () => {
  it("round-trips a Control code", () => {
    expect(hashForCode("A.5.1")).toBe("#A.5.1");
    expect(codeFromHash("#A.5.1")).toBe("A.5.1");
    expect(codeFromHash(hashForCode("X Y/1"))).toBe("X Y/1");
    expect(codeFromHash("")).toBe("");
    expect(codeFromHash("#%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("the CSV", () => {
  it("has the header, a BOM and one row per Control in the order given", () => {
    const csv = libraryCsv(sortRows(ROWS, DEFAULT_SORT));
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const table = parseCsv(csv.slice(CSV_BOM.length));
    expect(table[0]).toEqual([...CSV_HEADER]);
    expect(table.slice(1).map((row) => row[0])).toEqual(["4.1", "A.5.1", "A.5.2", "A.5.3", "A.6.1", "A.8.1", "CCM-1", "CCM-2"]);
  });

  it("writes the Source, owner, status, Systems, Requirements and scoping of a row", () => {
    const table = parseCsv(libraryCsv(ROWS).slice(CSV_BOM.length));
    const column = (name: (typeof CSV_HEADER)[number]) => CSV_HEADER.indexOf(name);
    const row = (code: string) => table.find((cells) => cells[0] === code)!;
    expect(row("A.5.2")[column("Satisfies")]).toBe("ISO/IEC 27001:2022 R-A52-1; CSA CCM:4.1 R-A52-2 (partial)");
    expect(row("A.5.2")[column("Requirements satisfied")]).toBe("2");
    expect(row("A.5.2")[column("Control Owner")]).toBe("Pat Peer");
    expect(row("A.5.2")[column("Organization status")]).toBe("In Progress");
    expect(row("A.5.2")[column("Systems it applies to")]).toBe("");
    expect(row("A.8.1")[column("Organization status")]).toBe("Per System only");
    expect(row("A.8.1")[column("Systems it applies to")]).toBe("3");
    expect(row("A.8.1")[column("Deployment Facets")]).toBe("Cloud; On-premises");
    expect(row("A.5.3")[column("Minimum Sensitivity Level")]).toBe("Sensitive");
    expect(row("A.5.3")[column("Minimum Integrity")]).toBe("High");
    expect(row("A.5.3")[column("Control Owner")]).toBe("");
    expect(row("CCM-1")[column("Source")]).toBe("Supplementary · CSA CCM:4.1");
    expect(row("CCM-2")[column("Source")]).toBe("Supplementary");
  });

  it("names the file after the library, and marks a selection", () => {
    const date = new Date("2026-11-04T10:00:00Z");
    expect(libraryCsvFilename(date)).toBe("Control-Library-2026-11-04.csv");
    expect(libraryCsvFilename(date, true)).toBe("Control-Library-selection-2026-11-04.csv");
  });
});

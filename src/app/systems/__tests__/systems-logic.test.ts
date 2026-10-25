import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import {
  CSV_HEADER,
  fulfilment,
  filterOptions,
  groupRows,
  hasActiveFilters,
  highestImpact,
  inView,
  matchRows,
  pageOf,
  roleViewNeedsFulfilment,
  roleViewOf,
  sortRows,
  systemsCsv,
  systemsCsvFilename,
  viewCounts,
} from "../systems-logic";
import { DEFAULT_STATE } from "../systems-state";
import { row, ROWS } from "./fixtures";

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("saved views", () => {
  it("counts each view over the rows", () => {
    expect(viewCounts(ROWS)).toEqual({ all: 5, mine: 1, attention: 3, unclassified: 2, providers: 1 });
  });

  it("Not classified is any CIA axis unset", () => {
    expect(ids(ROWS.filter((r) => inView(r, "unclassified")))).toEqual(["s-billing", "s-legacy"]);
  });

  it("the role view and Needs attention come from the server's flags", () => {
    expect(ids(ROWS.filter((r) => inView(r, "mine")))).toEqual(["s-jira"]);
    expect(ids(ROWS.filter((r) => inView(r, "attention")))).toEqual(["s-billing", "s-legacy", "s-hub"]);
  });

  it("names the role views", () => {
    expect(roleViewOf("SYSTEM_OWNER").label).toBe("Owned by me");
    expect(roleViewOf("REVIEWER").label).toBe("Awaiting review");
    expect(roleViewOf("RISK_OWNER").label).toBe("With open Risks");
    expect(roleViewOf("BUSINESS_RISK_OWNER").label).toBe("In my scope");
    for (const role of ["ADMIN", "COMPLIANCE_MANAGER", "INTERNAL_AUDITOR", "VIEWER"] as const) expect(roleViewOf(role).label).toBe("Under 70% met");
    expect(roleViewNeedsFulfilment("ADMIN")).toBe(true);
    expect(roleViewNeedsFulfilment("REVIEWER")).toBe(false);
  });
});

describe("highest Impact Level and fulfilment", () => {
  it("is the highest classified axis, or none", () => {
    expect(highestImpact(ROWS[1])).toBe("CRITICAL");
    expect(highestImpact(ROWS[0])).toBe("MODERATE");
    expect(highestImpact(ROWS[3])).toBe("NONE");
    expect(highestImpact(row({ id: "x", name: "x", confidentiality: "LOW", integrity: null, availability: null }))).toBe("LOW");
  });

  it("is met over applicable, null when nothing is measured", () => {
    expect(fulfilment({ met: 3, applicable: 4 })).toBe(0.75);
    expect(fulfilment({ met: 0, applicable: 4 })).toBe(0);
    expect(fulfilment({ met: null, applicable: null })).toBeNull();
    expect(fulfilment({ met: 0, applicable: 0 })).toBeNull();
  });
});

describe("search and filters", () => {
  const state = (over: Partial<typeof DEFAULT_STATE>) => ({ ...DEFAULT_STATE, ...over });

  it("searches name, vendor and owner, ignoring case", () => {
    expect(ids(matchRows(ROWS, state({ q: "atlass" })))).toEqual(["s-jira"]);
    expect(ids(matchRows(ROWS, state({ q: "ELENA" })))).toEqual(["s-billing", "s-legacy"]);
    expect(ids(matchRows(ROWS, state({ q: "okta" })))).toEqual(["s-okta"]);
    expect(matchRows(ROWS, state({ q: "nothing like it" }))).toEqual([]);
  });

  it("filters by owner, Business Unit, Deployment Facet and highest Impact Level: OR within a filter, AND across", () => {
    expect(ids(matchRows(ROWS, state({ owners: ["u-elena"] })))).toEqual(["s-billing", "s-legacy"]);
    expect(ids(matchRows(ROWS, state({ owners: ["u-elena", "u-me"] })))).toEqual(["s-jira", "s-billing", "s-legacy"]);
    expect(ids(matchRows(ROWS, state({ units: ["b-eng"] })))).toEqual(["s-billing"]);
    expect(ids(matchRows(ROWS, state({ facets: ["f-cloud"] })))).toEqual(["s-billing"]);
    expect(ids(matchRows(ROWS, state({ impact: ["CRITICAL", "NONE"] })))).toEqual(["s-billing", "s-legacy"]);
    expect(ids(matchRows(ROWS, state({ owners: ["u-elena"], impact: ["NONE"] })))).toEqual(["s-legacy"]);
  });

  it("combines with the saved view", () => {
    expect(ids(matchRows(ROWS, state({ view: "attention", owners: ["u-priya"] })))).toEqual(["s-hub"]);
  });

  it("offers the owners, Business Units and Deployment Facets that exist among the rows, and every impact choice", () => {
    expect(filterOptions(ROWS, "owners").map((o) => o.label)).toEqual(["Elena Voss", "Marcus Lindqvist", "Priya Shah"]);
    expect(filterOptions(ROWS, "units").map((o) => o.label)).toEqual(["Engineering", "Finance"]);
    expect(filterOptions(ROWS, "facets").map((o) => o.label)).toEqual(["Cloud IaaS/PaaS", "On-Premises Datacenter", "SaaS"]);
    expect(filterOptions(ROWS, "impact").map((o) => o.value)).toEqual(["NONE", "LOW", "MODERATE", "HIGH", "CRITICAL"]);
  });

  it("knows when anything narrows the list", () => {
    expect(hasActiveFilters(DEFAULT_STATE)).toBe(false);
    for (const over of [{ view: "mine" as const }, { status: "DRAFT" as const }, { q: "x" }, { owners: ["a"] }, { impact: ["LOW" as const] }]) {
      expect(hasActiveFilters({ ...DEFAULT_STATE, ...over })).toBe(true);
    }
    expect(hasActiveFilters({ ...DEFAULT_STATE, q: "   " })).toBe(false);
  });
});

describe("sorting", () => {
  it("sorts by name ignoring case, ascending and descending", () => {
    expect(ids(sortRows(ROWS, "name", 1))).toEqual(["s-hub", "s-billing", "s-jira", "s-legacy", "s-okta"]);
    expect(ids(sortRows(ROWS, "name", -1))).toEqual(["s-okta", "s-legacy", "s-jira", "s-billing", "s-hub"]);
  });

  it("sorts by status in lifecycle order", () => {
    expect(ids(sortRows(ROWS, "status", 1))).toEqual(["s-legacy", "s-billing", "s-okta", "s-jira", "s-hub"]);
  });

  it("sorts by the highest impact, highest first when ascending, as in the prototype", () => {
    expect(ids(sortRows(ROWS, "cia", 1))).toEqual(["s-billing", "s-jira", "s-okta", "s-hub", "s-legacy"]);
  });

  it("sorts by fulfilment and keeps Systems with no figure last in both directions", () => {
    expect(ids(sortRows(ROWS, "prog", 1))).toEqual(["s-hub", "s-billing", "s-jira", "s-okta", "s-legacy"]);
    expect(ids(sortRows(ROWS, "prog", -1))).toEqual(["s-okta", "s-jira", "s-billing", "s-hub", "s-legacy"]);
  });

  it("sorts by Business Unit with none last, and by update time newest first when ascending", () => {
    expect(ids(sortRows(ROWS, "unit", 1)).at(-1)).toBe("s-legacy");
    expect(ids(sortRows(ROWS, "unit", -1)).at(-1)).toBe("s-legacy");
    expect(ids(sortRows(ROWS, "upd", 1))).toEqual(["s-billing", "s-hub", "s-jira", "s-legacy", "s-okta"]);
  });

  it("does not change the array it is given", () => {
    const copy = [...ROWS];
    sortRows(ROWS, "name", -1);
    expect(ROWS).toEqual(copy);
  });
});

describe("paging and grouping", () => {
  it("pages and clamps the page to the last", () => {
    const list = Array.from({ length: 120 }, (_, i) => i);
    expect(pageOf(list, 1, 50)).toMatchObject({ page: 1, pages: 3, from: 0 });
    expect(pageOf(list, 3, 50).items).toHaveLength(20);
    expect(pageOf(list, 9, 50)).toMatchObject({ page: 3, from: 100 });
    expect(pageOf(list, 0, 50).page).toBe(1);
    expect(pageOf([], 1, 25)).toMatchObject({ page: 1, pages: 1, items: [] });
  });

  it("groups by owner, Business Unit (a System under each of its units) and Deployment Facets", () => {
    expect(groupRows(ROWS, "owner").map((g) => [g.name, g.rows.length])).toEqual([["Elena Voss", 2], ["Marcus Lindqvist", 1], ["Priya Shah", 2]]);
    const units = groupRows(ROWS, "unit");
    expect(units.map((g) => g.name)).toEqual(["Engineering", "Finance", "No Business Unit"]);
    expect(ids(units[1].rows)).toEqual(["s-jira", "s-billing", "s-okta", "s-hub"]);
    expect(groupRows(ROWS, "facet").map((g) => g.name)).toEqual(["Cloud IaaS/PaaS + On-Premises Datacenter", "No Deployment Facet", "SaaS"]);
    expect(groupRows(ROWS, "")).toHaveLength(1);
  });
});

describe("Export CSV", () => {
  const body = (rows = ROWS) => systemsCsv(rows).replace(CSV_BOM, "").split("\r\n").filter(Boolean);

  it("starts with the byte-order mark and the table's columns, then one line per System", () => {
    const csv = systemsCsv(ROWS);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(body()[0]).toBe(CSV_HEADER.map((h) => `"${h}"`).join(","));
    expect(body()).toHaveLength(ROWS.length + 1);
  });

  it("lists every Deployment Facet and Business Unit, the three Impact Levels and the fulfilment", () => {
    const line = body()[2];
    expect(line).toBe(
      '"Billing engine","Built in-house","No","In Review","3","Elena Voss","Cloud IaaS/PaaS; On-Premises Datacenter","High","Critical","Not classified","Engineering; Finance","3","10","30","2026-10-24"',
    );
  });

  it("leaves the figures empty when nothing is measured", () => {
    expect(body()[4]).toBe('"Legacy CRM","Built in-house","No","Draft","0","Elena Voss","","Not classified","Not classified","Not classified","","","","","2026-06-01"');
  });

  it("quotes commas and quotes and neutralises a formula in a cell, so a spreadsheet shows text", () => {
    const line = body()[5];
    expect(line.startsWith('"\'=HYPERLINK(hub)","Acme, ""Inc"""')).toBe(true);
    for (const trigger of ["=1+1", "+1", "-1", "@SUM(A1)"]) {
      expect(systemsCsv([row({ id: "x", name: trigger })])).toContain(`"'${trigger}"`);
    }
  });

  it("keeps a line break inside its cell", () => {
    expect(systemsCsv([row({ id: "x", name: "two\nlines" })])).toContain('"two\nlines"');
  });

  it("names the file by scope and day", () => {
    expect(systemsCsvFilename("register", new Date("2026-10-25T10:00:00Z"))).toBe("systems-register-2026-10-25.csv");
    expect(systemsCsvFilename("selection", new Date("2026-10-25T10:00:00Z"))).toBe("systems-selection-2026-10-25.csv");
  });
});

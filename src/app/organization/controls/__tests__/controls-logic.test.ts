import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { CSV_BOM } from "@/lib/csv";
import { parseCsv } from "@/test/csv-parse";
import {
  ALL_TAB,
  applySaved,
  baseRows,
  filterRows,
  groupRows,
  hasBeenEdited,
  nextEditableId,
  percentFulfilled,
  presentStatuses,
  reachTag,
  reachText,
  statusCounts,
  tabsFor,
  themeOf,
  viewCsv,
  viewCsvFilename,
  viewOfStatus,
} from "../controls-logic";
import type { OrgControlRow } from "../controls-types";

function row(code: string, over: Partial<OrgControlRow> = {}): OrgControlRow {
  return {
    id: `id-${code}`,
    code,
    title: `Title of ${code}`,
    applicability: "ORGANIZATIONAL",
    category: "A.5 Organizational controls",
    summary: `Summary of ${code}`,
    ownerId: null,
    ownerName: null,
    status: "NOT_STARTED",
    description: null,
    updatedAt: null,
    updatedByName: null,
    canEdit: true,
    systemCount: 0,
    frameworks: ["ISO/IEC 27001:2022"],
    origin: null,
    history: [],
    ...over,
  };
}

describe("themeOf and tabsFor (decision 3a)", () => {
  it("puts ISO 27001 clauses 4 to 10 in one tab and the Annex A themes in theirs", () => {
    expect(themeOf(row("x", { category: "4 Context of the organization" })).key).toBe("clauses");
    expect(themeOf(row("x", { category: "7 Support" })).key).toBe("clauses");
    expect(themeOf(row("x", { category: "10 Improvement" })).key).toBe("clauses");
    expect(themeOf(row("x", { category: "A.5 Organizational controls" })).key).toBe("a5");
    expect(themeOf(row("x", { category: "A.6 People controls" })).key).toBe("a6");
    expect(themeOf(row("x", { category: "A.7 Physical controls" })).key).toBe("a7");
    expect(themeOf(row("x", { category: "A.8 Technological controls" })).key).toBe("a8");
  });

  it("puts a Supplementary Control in its origin Framework's tab whatever its category", () => {
    const tab = themeOf(row("x", { category: "A.8 Technological controls", origin: { key: "fw1", label: "CSA CCM:4.1" } }));
    expect(tab).toEqual({ key: "fw:fw1", label: "CSA CCM:4.1" });
  });

  it("puts an unknown or out-of-range category in Other, without throwing", () => {
    for (const category of ["", "Datacenter", "A.9 Something", "A.51 Odd", "3 Before the clauses", "11 After", "Annex A", "A."]) {
      expect(themeOf(row("x", { category })).key).toBe("other");
    }
  });

  it("lists All, the themes in order, the origin Frameworks by name, then Other, and leaves empty tabs out", () => {
    const rows = [
      row("a", { category: "A.8 Technological controls" }),
      row("b", { category: "4 Context" }),
      row("c", { category: "Misc" }),
      row("d", { origin: { key: "z", label: "Zeta:1" } }),
      row("e", { origin: { key: "a", label: "Alpha:1" } }),
    ];
    expect(tabsFor(rows).map((tab) => tab.label)).toEqual(["All", "Clauses 4–10", "A.8 Technological", "Alpha:1", "Zeta:1", "Other"]);
    expect(tabsFor([]).map((tab) => tab.key)).toEqual([ALL_TAB]);
    expect(tabsFor([row("a")]).map((tab) => tab.label)).toEqual(["All", "A.5 Organizational"]);
  });
});

describe("filters", () => {
  const rows = [
    row("A.5.1", { ownerId: "u1", ownerName: "Olive Owner", status: "FULFILLED", description: "Policy approved" }),
    row("A.5.2", { applicability: "BOTH", systemCount: 4 }),
    row("A.6.1", { category: "A.6 People controls", ownerId: "u2", ownerName: "Pat", status: "WAIVED", description: "Accepted" }),
    row("A.7.1", { category: "A.7 Physical controls", status: "NOT_APPLICABLE", description: "No datacenter" }),
    row("A.8.1", { category: "A.8 Technological controls", status: "IN_PROGRESS", applicability: "BOTH" }),
  ];
  const all = { view: "all", applies: "all", query: "", tab: ALL_TAB } as const;
  const codes = (list: OrgControlRow[]) => list.map((r) => r.code);

  it("filters by the views the cards and the ring open", () => {
    expect(codes(filterRows(rows, { ...all, view: "mine" }, "u1"))).toEqual(["A.5.1"]);
    expect(codes(filterRows(rows, { ...all, view: "NOT_STARTED" }, "u1"))).toEqual(["A.5.2"]);
    expect(codes(filterRows(rows, { ...all, view: "reasoned" }, "u1"))).toEqual(["A.6.1", "A.7.1"]);
    expect(codes(filterRows(rows, { ...all, view: "noowner" }, "u1"))).toEqual(["A.5.2", "A.7.1", "A.8.1"]);
    expect(codes(filterRows(rows, { ...all, view: "IN_PROGRESS" }, "u1"))).toEqual(["A.8.1"]);
    expect(codes(filterRows(rows, { ...all, view: "FULFILLED" }, "u1"))).toEqual(["A.5.1"]);
  });

  it("maps Waived and Not Applicable to one view and the other statuses to themselves", () => {
    expect(viewOfStatus("WAIVED")).toBe("reasoned");
    expect(viewOfStatus("NOT_APPLICABLE")).toBe("reasoned");
    expect(viewOfStatus("FULFILLED")).toBe("FULFILLED");
  });

  it("searches code, title, description and owner, case-insensitively", () => {
    expect(codes(filterRows(rows, { ...all, query: "olive" }, "u"))).toEqual(["A.5.1"]);
    expect(codes(filterRows(rows, { ...all, query: "DATACENTER" }, "u"))).toEqual(["A.7.1"]);
    expect(codes(filterRows(rows, { ...all, query: "title of a.8" }, "u"))).toEqual(["A.8.1"]);
    expect(codes(filterRows(rows, { ...all, query: "nothing like this" }, "u"))).toEqual([]);
  });

  it("filters by Applies to and by tab, and counts the tabs over everything but the tab", () => {
    expect(codes(filterRows(rows, { ...all, applies: "BOTH" }, "u"))).toEqual(["A.5.2", "A.8.1"]);
    expect(codes(filterRows(rows, { ...all, tab: "a5" }, "u"))).toEqual(["A.5.1", "A.5.2"]);
    expect(codes(baseRows(rows, { view: "all", applies: "BOTH", query: "" }, "u"))).toEqual(["A.5.2", "A.8.1"]);
  });
});

describe("counts and groups", () => {
  const rows = [
    row("1", { ownerId: "o2", ownerName: "Zed", status: "FULFILLED" }),
    row("2", { ownerId: "o2", ownerName: "Zed", status: "FULFILLED" }),
    row("3", { ownerId: "o2", ownerName: "Zed", status: "IN_PROGRESS" }),
    row("4", { ownerId: "o1", ownerName: "Amy", status: "WAIVED" }),
    row("5", { status: "NOT_STARTED" }),
  ];

  it("counts the statuses and the Fulfilled percentage", () => {
    expect(statusCounts(rows)).toEqual({ NOT_STARTED: 1, IN_PROGRESS: 1, FULFILLED: 2, WAIVED: 1, NOT_APPLICABLE: 0 });
    expect(percentFulfilled(rows)).toBe(40);
    expect(percentFulfilled([])).toBe(0);
  });

  it("groups by status in the fixed order, leaving empty statuses out", () => {
    expect(groupRows(rows, "status").map((group) => `${group.name}:${group.rows.length}`)).toEqual(["Not Started:1", "In Progress:1", "Fulfilled:2", "Waived:1"]);
  });

  it("groups by owner, no Control Owner first, then by name, with each group's status counts", () => {
    const groups = groupRows(rows, "owner");
    expect(groups.map((group) => group.name)).toEqual(["No Control Owner", "Amy", "Zed"]);
    const zed = groups[2];
    expect(zed.counts).toEqual({ NOT_STARTED: 0, IN_PROGRESS: 1, FULFILLED: 2, WAIVED: 0, NOT_APPLICABLE: 0 });
    expect(presentStatuses(zed.counts)).toEqual([
      { status: "IN_PROGRESS", count: 1 },
      { status: "FULFILLED", count: 2 },
    ]);
  });

  it("is one unnamed group, or none at all, when not grouped", () => {
    expect(groupRows(rows, "none")).toHaveLength(1);
    expect(groupRows([], "none")).toEqual([]);
    expect(groupRows([], "owner")).toEqual([]);
  });
});

describe("reach text", () => {
  it("says how many Systems a Both Control reaches, and inherits only while Fulfilled", () => {
    const both = row("b", { applicability: "BOTH", systemCount: 12 });
    expect(reachTag(both)).toBe("reaches 12 Systems");
    expect(reachTag({ ...both, status: "FULFILLED", systemCount: 1 })).toBe("inherited by 1 System");
    expect(reachTag(row("o"))).toBeNull();
    expect(reachText(both)).toBe("Once Fulfilled, inherited by 12 Systems. Maps to ISO/IEC 27001:2022.");
    expect(reachText({ ...both, status: "FULFILLED" })).toBe("Inherited as Fulfilled by 12 Systems. Maps to ISO/IEC 27001:2022.");
    expect(reachText(row("o", { frameworks: ["A:1", "B:2"] }))).toBe("Counts as this status on every System with A:1, B:2 in scope.");
    expect(reachText(row("o", { frameworks: [] }))).toMatch(/counts on no System/);
  });
});

describe("applySaved and nextEditableId", () => {
  it("updates the implementation from the response and adds a history entry only when the status moved", () => {
    const before = row("a", { status: "NOT_STARTED", updatedAt: "2026-10-01T10:00:00.000Z", updatedByName: "Old", history: [] });
    const saved = (status: ControlAssessmentStatus, description: string | null) => ({
      implementation: { status, description, updatedBy: { name: "New" }, updatedAt: "2026-11-01T10:00:00.000Z" },
    });
    const moved = applySaved(before, saved("FULFILLED", "Done"));
    expect(moved).toMatchObject({ status: "FULFILLED", description: "Done", updatedAt: "2026-11-01T10:00:00.000Z", updatedByName: "New" });
    expect(moved.history).toEqual([{ at: "2026-11-01T10:00:00.000Z", by: "New", from: "NOT_STARTED", to: "FULFILLED" }]);
    const same = applySaved(moved, saved("FULFILLED", "Done, reworded"));
    expect(same.history).toHaveLength(1);
    expect(same.description).toBe("Done, reworded");
  });

  it("finds the next editable row after the current one, and none at the end", () => {
    const order = [row("a"), row("b", { canEdit: false }), row("c"), row("d")];
    expect(nextEditableId(order, "id-a")).toBe("id-c");
    expect(nextEditableId(order, "id-c")).toBe("id-d");
    expect(nextEditableId(order, "id-d")).toBeNull();
    expect(nextEditableId(order, "missing")).toBe("id-a");
  });
});

describe("viewCsv (decision 5a)", () => {
  it("has a header and one row per Control in view, in the given order", () => {
    const csv = viewCsv([
      row("A.5.1", { ownerName: "Olive", status: "FULFILLED", description: 'Says "yes", twice', updatedAt: "2026-10-30T09:00:00.000Z", updatedByName: "Olive" }),
      row("A.5.2", { applicability: "BOTH", systemCount: 7 }),
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const parsed = parseCsv(csv.slice(1));
    expect(parsed[0]).toEqual(["Code", "Title", "Applies to", "Category", "Control Owner", "Status", "Description", "Systems reached", "Last updated", "Updated by"]);
    expect(parsed[1]).toEqual(["A.5.1", "Title of A.5.1", "Organizational", "A.5 Organizational controls", "Olive", "Fulfilled", 'Says "yes", twice', "", "2026-10-30", "Olive"]);
    expect(parsed[2]).toEqual(["A.5.2", "Title of A.5.2", "Both", "A.5 Organizational controls", "", "Not Started", "", "7", "", ""]);
    expect(parsed).toHaveLength(3);
  });

  it("names the file after the Organization Controls and the date", () => {
    expect(viewCsvFilename(new Date("2026-11-01T12:00:00Z"))).toBe("Organization-Controls-2026-11-01.csv");
  });
});

describe("hasBeenEdited", () => {
  it("is false for a row nobody edited, true with an editor or with history", () => {
    const at = "2026-10-01T00:00:00.000Z";
    expect(hasBeenEdited(row("a", { updatedAt: at }))).toBe(false);
    expect(hasBeenEdited(row("a"))).toBe(false);
    expect(hasBeenEdited(row("a", { updatedAt: at, updatedByName: "Pat" }))).toBe(true);
    expect(hasBeenEdited(row("a", { updatedAt: at, history: [{ at, by: "System", from: "FULFILLED", to: "IN_PROGRESS" }] }))).toBe(true);
  });
});

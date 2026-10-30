import { describe, expect, it } from "vitest";
import { CSV_BOM } from "@/lib/csv";
import { parseCsv } from "@/test/csv-parse";
import {
  coverageCsv,
  coverageCsvFilename,
  countsOf,
  displayGroups,
  kindOf,
  matchesFilter,
  matchesQuery,
  openGapIds,
  resolveControl,
  resolvedPercent,
  sectionTab,
  sectionsOf,
  selectRows,
  suggestControls,
  supplementaryCode,
  whyText,
} from "../coverage-logic";
import type { CoverageRow, LibraryControl, MappedControl } from "../coverage-types";

const mapping = (code: string, coverage: "FULL" | "PARTIAL" = "FULL", over: Partial<MappedControl> = {}): MappedControl => ({
  id: `m-${code}`,
  controlId: `c-${code}`,
  code,
  title: `Title of ${code}`,
  coverage,
  rationale: null,
  supplementary: false,
  ...over,
});

const row = (code: string, section: string, over: Partial<CoverageRow> = {}): CoverageRow => ({
  id: `r-${code}`,
  code,
  section,
  title: `Requirement ${code}`,
  text: `Text of ${code}`,
  state: "GAP",
  justification: null,
  acceptedBy: null,
  acceptedAt: null,
  mappings: [],
  ...over,
});

/** A.5: covered, partial-only gap, no-mapping gap. A.10: accepted, covered. */
const ROWS: CoverageRow[] = [
  row("A.5.10", "A.5 Organizational", { state: "COVERED", mappings: [mapping("SEC-1")] }),
  row("A.5.2", "A.5 Organizational", { state: "GAP", mappings: [mapping("SEC-2", "PARTIAL")] }),
  row("A.5.1", "A.5 Organizational"),
  row("A.10.1", "A.10 People", { state: "ACCEPTED_GAP", justification: "Out of scope", acceptedBy: "Cora", acceptedAt: "2026-10-01T10:00:00.000Z" }),
  row("A.9.1", "A.9 Access", { state: "COVERED", mappings: [mapping("SEC-3", "FULL", { supplementary: true }), mapping("SEC-4", "PARTIAL")] }),
];

describe("kinds and filters", () => {
  it("splits an open gap into Partial mappings only and nothing mapped", () => {
    expect(ROWS.map(kindOf)).toEqual(["COVERED", "PARTIAL", "NONE", "ACCEPTED_GAP", "COVERED"]);
  });

  it("filters: Open gaps are both kinds of gap, an accepted gap is not one", () => {
    const codes = (key: Parameters<typeof matchesFilter>[1]) => ROWS.filter((r) => matchesFilter(r, key)).map((r) => r.code);
    expect(codes("all")).toHaveLength(5);
    expect(codes("COVERED")).toEqual(["A.5.10", "A.9.1"]);
    expect(codes("GAP")).toEqual(["A.5.2", "A.5.1"]);
    expect(codes("PARTIAL")).toEqual(["A.5.2"]);
    expect(codes("NONE")).toEqual(["A.5.1"]);
    expect(codes("ACCEPTED_GAP")).toEqual(["A.10.1"]);
  });

  it("counts, with covered + accepted + gaps = Requirements and gaps = Partial only + no mapping", () => {
    const counts = countsOf(ROWS);
    expect(counts).toEqual({ requirements: 5, covered: 2, gaps: 2, accepted: 1, partialOnly: 1, noMapping: 1 });
    expect(resolvedPercent(counts)).toBe(60);
    expect(resolvedPercent(countsOf([]))).toBeNull();
  });
});

describe("sections, search and order", () => {
  it("orders sections and codes numerically (A.5 before A.10, A.5.2 before A.5.10)", () => {
    expect(sectionsOf(ROWS).map((g) => g.section)).toEqual(["A.5 Organizational", "A.9 Access", "A.10 People"]);
    expect(sectionsOf(ROWS)[0].rows.map((r) => r.code)).toEqual(["A.5.1", "A.5.2", "A.5.10"]);
  });

  it("names a section tab by its leading number, or by the whole name without one", () => {
    expect(sectionTab("A.5 Organizational controls")).toBe("A.5");
    expect(sectionTab("3.1 Access Control")).toBe("3.1");
    expect(sectionTab("Test")).toBe("Test");
    expect(sectionTab("Access Control")).toBe("Access Control");
  });

  it("searches the code, the Requirement title and the mapped Controls' code and title", () => {
    const find = (q: string) => ROWS.filter((r) => matchesQuery(r, q)).map((r) => r.code);
    expect(find("a.5.2")).toEqual(["A.5.2"]);
    expect(find("requirement a.10")).toEqual(["A.10.1"]);
    expect(find("SEC-4")).toEqual(["A.9.1"]);
    expect(find("title of sec-2")).toEqual(["A.5.2"]);
    expect(find("   ")).toHaveLength(5);
    expect(find("nothing like it")).toEqual([]);
  });

  it("combines filter, section and search", () => {
    expect(selectRows(ROWS, { filter: "GAP", section: "all", query: "" }).map((r) => r.code)).toEqual(["A.5.2", "A.5.1"]);
    expect(selectRows(ROWS, { filter: "all", section: "A.9 Access", query: "" }).map((r) => r.code)).toEqual(["A.9.1"]);
    expect(selectRows(ROWS, { filter: "COVERED", section: "A.5 Organizational", query: "sec-1" }).map((r) => r.code)).toEqual(["A.5.10"]);
    expect(selectRows(ROWS, { filter: "GAP", section: "A.9 Access", query: "" })).toEqual([]);
  });

  it("puts open gaps, then accepted gaps, then covered Requirements first in each section, keeping code order inside each", () => {
    const natural = displayGroups(ROWS, false).map((g) => g.rows.map((r) => r.code));
    expect(natural[0]).toEqual(["A.5.1", "A.5.2", "A.5.10"]);
    const gapsFirst = displayGroups([...ROWS, row("A.5.3", "A.5 Organizational", { state: "COVERED", mappings: [mapping("SEC-1")] }), row("A.5.4", "A.5 Organizational", { state: "ACCEPTED_GAP" })], true)[0].rows.map((r) => r.code);
    expect(gapsFirst).toEqual(["A.5.1", "A.5.2", "A.5.4", "A.5.3", "A.5.10"]);
  });

  it("lists the open gaps only as selectable", () => {
    expect(openGapIds(ROWS)).toEqual(["r-A.5.2", "r-A.5.1"]);
  });
});

describe("the CSV built from the view", () => {
  const parse = (text: string) => parseCsv(text.replace(CSV_BOM, ""));

  it("has the server export's columns, one line per Requirement and mapped Control, in table order", () => {
    const rows = parse(coverageCsv(displayGroups(ROWS, false)));
    expect(rows[0]).toEqual(["Section", "Requirement code", "Requirement title", "Control code", "Control title", "Coverage", "Rationale", "State", "Gap acceptance justification"]);
    expect(rows.slice(1).map((r) => [r[1], r[3], r[5], r[7]])).toEqual([
      ["A.5.1", "", "", "Coverage Gap"],
      ["A.5.2", "SEC-2", "Partial", "Coverage Gap"],
      ["A.5.10", "SEC-1", "Full", "Covered"],
      ["A.9.1", "SEC-3", "Full", "Covered"],
      ["A.9.1", "SEC-4", "Partial", "Covered"],
      ["A.10.1", "", "", "Accepted gap"],
    ]);
    expect(rows.find((r) => r[1] === "A.10.1")![8]).toBe("Out of scope");
    expect(rows.find((r) => r[1] === "A.5.1")![8]).toBe("");
  });

  it("holds only the rows in view", () => {
    const rows = parse(coverageCsv(displayGroups(selectRows(ROWS, { filter: "GAP", section: "all", query: "" }), false)));
    expect(rows.slice(1).map((r) => r[1])).toEqual(["A.5.1", "A.5.2"]);
  });

  it("neutralises a cell a spreadsheet would run as a formula", () => {
    const text = coverageCsv(displayGroups([row("=1+1", "S")], false));
    expect(text).toContain(`"'=1+1"`);
  });

  it("names the file after the Framework", () => {
    expect(coverageCsvFilename({ name: "ISO/IEC 27001", version: "2022" }, new Date("2026-10-30T12:00:00Z"))).toBe("ISO-IEC-27001-2022-coverage-2026-10-30.csv");
  });
});

describe("suggested Controls and Control lookup", () => {
  const LIBRARY: LibraryControl[] = [
    { id: "c-SEC-1", code: "SEC-1", title: "Password policy", supplementary: false },
    { id: "c-SEC-2", code: "SEC-2", title: "Backup of data", supplementary: false },
    { id: "c-SEC-3", code: "SEC-3", title: "Supplementary thing", supplementary: true },
    { id: "c-SEC-7", code: "SEC-7", title: "Cryptography supplement for password handling", supplementary: true },
    { id: "c-SEC-5", code: "SEC-5", title: "Cryptography keys", supplementary: false },
    { id: "c-SEC-6", code: "SEC-6", title: "Physical security of offices", supplementary: false },
  ];
  const target = row("A.5.9", "A.5 Organizational", { title: "Use of cryptography and password handling" });

  it("ranks Controls mapped elsewhere in the same section, then title word overlap, and skips Supplementary ones and the other sections", () => {
    const others = [
      row("A.5.1", "A.5 Organizational", { state: "COVERED", mappings: [mapping("SEC-1")] }),
      row("A.5.2", "A.5 Organizational", { state: "COVERED", mappings: [mapping("SEC-1"), mapping("SEC-3", "FULL", { supplementary: true })] }),
      row("A.9.1", "A.9 Access", { state: "COVERED", mappings: [mapping("SEC-2")] }),
    ];
    const names = suggestControls(target, [target, ...others], LIBRARY).map((c) => c.code);
    // SEC-1: two Requirements in the section (2) + "password" overlap (2) = 4; SEC-5: "cryptography" overlap = 2.
    expect(names).toEqual(["SEC-1", "SEC-5"]);
  });

  it("never suggests a Supplementary Control: not one mapped in the section, not one with matching title words", () => {
    const others = [row("A.5.1", "A.5 Organizational", { state: "COVERED", mappings: [mapping("SEC-7", "FULL", { supplementary: true })] })];
    const codes = suggestControls(target, [target, ...others], LIBRARY).map((c) => c.code);
    expect(codes).not.toContain("SEC-7");
    expect(codes).not.toContain("SEC-3");
    // Even if only the library says so (the mapping does not):
    const plain = [row("A.5.1", "A.5 Organizational", { state: "COVERED", mappings: [mapping("SEC-7")] })];
    expect(suggestControls(target, [target, ...plain], LIBRARY).map((c) => c.code)).not.toContain("SEC-7");
  });

  it("never suggests a Control already mapped to the Requirement, and honours the limit", () => {
    const mapped = row("A.5.9", "A.5 Organizational", { title: target.title, mappings: [mapping("SEC-1", "PARTIAL")] });
    expect(suggestControls(mapped, [mapped], LIBRARY).map((c) => c.code)).toEqual(["SEC-5"]);
    expect(suggestControls(target, [target], LIBRARY, 1)).toHaveLength(1);
  });

  it("suggests nothing when nothing relates", () => {
    expect(suggestControls(row("Z-1", "Z", { title: "Zebra" }), [], LIBRARY)).toEqual([]);
  });

  it("finds the Control a typed value names: code, title or 'CODE title', ignoring case", () => {
    expect(resolveControl("sec-2", LIBRARY)?.id).toBe("c-SEC-2");
    expect(resolveControl(" Cryptography KEYS ", LIBRARY)?.id).toBe("c-SEC-5");
    expect(resolveControl("SEC-6 Physical security of offices", LIBRARY)?.id).toBe("c-SEC-6");
    expect(resolveControl("SEC", LIBRARY)).toBeNull();
    expect(resolveControl("", LIBRARY)).toBeNull();
  });

  it("suggests a Supplementary Control code from the Framework and the Requirement", () => {
    expect(supplementaryCode({ name: "CMMC Level 2" }, { code: "AC.L2-3.1.1" })).toBe("CMMCLE-AC.L2-3.1.1");
    expect(supplementaryCode({ name: "ISO/IEC 27001" }, { code: "A.5 1" })).toBe("ISOIEC-A.51");
  });

  it("explains each state in a sentence", () => {
    expect(whyText(ROWS[0])).toMatch(/^Covered/);
    expect(whyText(ROWS[1])).toMatch(/all Partial/);
    expect(whyText(ROWS[2])).toMatch(/no Control is mapped/);
    expect(whyText(ROWS[3])).toMatch(/accepted gap/);
  });
});

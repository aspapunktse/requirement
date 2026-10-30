import { toCsv, csvFilename } from "@/lib/csv";
import { COVERAGE_CSV_HEADER } from "@/lib/framework-coverage-csv";
import { COVERAGE_STATE_LABEL, groupBySection } from "@/lib/coverage-state";
import { frameworkLabel } from "@/lib/framework-label";
import type { CoverageRow, FilterKey, LibraryControl } from "./coverage-types";

/**
 * The pure rules of the Framework coverage page (design proposal A "Gap ledger", issue #269): which Requirement
 * is in which filter, the section tabs, the search, "gaps first", the browser CSV and the suggested Controls.
 * Shared by the client component and driven directly by the tests. No Prisma, no React.
 */

// Filters

export const FILTERS: { key: FilterKey; label: string; tone: "ok" | "danger" | "warn" | undefined; sub: string }[] = [
  { key: "all", label: "Requirements", tone: undefined, sub: "" },
  { key: "COVERED", label: "Covered", tone: "ok", sub: "a Full mapping" },
  { key: "GAP", label: "Open gaps", tone: "danger", sub: "not covered, not accepted" },
  { key: "PARTIAL", label: "Partial only", tone: "warn", sub: "gaps with Partial mappings" },
  { key: "NONE", label: "No mapping", tone: "danger", sub: "gaps with nothing mapped" },
  { key: "ACCEPTED_GAP", label: "Accepted", tone: "warn", sub: "count as resolved" },
];

/** What a Requirement is, finer than its state: an open gap is either Partial mappings only or nothing mapped. */
export function kindOf(row: Pick<CoverageRow, "state" | "mappings">): "COVERED" | "ACCEPTED_GAP" | "PARTIAL" | "NONE" {
  if (row.state === "COVERED") return "COVERED";
  if (row.state === "ACCEPTED_GAP") return "ACCEPTED_GAP";
  return row.mappings.length > 0 ? "PARTIAL" : "NONE";
}

export function matchesFilter(row: Pick<CoverageRow, "state" | "mappings">, filter: FilterKey): boolean {
  switch (filter) {
    case "all":
      return true;
    case "GAP":
      return row.state === "GAP";
    case "COVERED":
    case "ACCEPTED_GAP":
    case "PARTIAL":
    case "NONE":
      return kindOf(row) === filter;
  }
}

export type Counts = { requirements: number; covered: number; gaps: number; accepted: number; partialOnly: number; noMapping: number };

export function countsOf(rows: Pick<CoverageRow, "state" | "mappings">[]): Counts {
  const counts: Counts = { requirements: rows.length, covered: 0, gaps: 0, accepted: 0, partialOnly: 0, noMapping: 0 };
  for (const row of rows) {
    const kind = kindOf(row);
    if (kind === "COVERED") counts.covered += 1;
    else if (kind === "ACCEPTED_GAP") counts.accepted += 1;
    else {
      counts.gaps += 1;
      if (kind === "PARTIAL") counts.partialOnly += 1;
      else counts.noMapping += 1;
    }
  }
  return counts;
}

/** Share of the Requirements that are covered or accepted, 0 to 100; null with no Requirements. */
export function resolvedPercent(counts: Pick<Counts, "requirements" | "covered" | "accepted">): number | null {
  return counts.requirements === 0 ? null : Math.round(((counts.covered + counts.accepted) / counts.requirements) * 100);
}

// Sections, search, order

export type SectionGroup = { section: string; rows: CoverageRow[] };

/** The Requirements by section, sections and codes in numeric-aware order. */
export function sectionsOf(rows: CoverageRow[]): SectionGroup[] {
  return groupBySection(rows).map(({ section, items }) => ({ section, rows: items }));
}

/** The short name of a section tab: its leading number ("A.5", "3.1") when it has one, otherwise the whole name. */
export function sectionTab(section: string): string {
  const lead = /^[A-Za-z]{0,3}\.?\d+(?:\.\d+)*/.exec(section.trim());
  return lead ? lead[0] : section;
}

/** Code, Requirement title and the code and title of every mapped Control. */
export function matchesQuery(row: CoverageRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${row.code} ${row.title} ${row.mappings.map((mapping) => `${mapping.code} ${mapping.title}`).join(" ")}`.toLowerCase().includes(q);
}

export type View = { filter: FilterKey; section: string; query: string };

/** The Requirements in the filter, section ("all" or a section name) and search. */
export function selectRows(rows: CoverageRow[], view: View): CoverageRow[] {
  return rows.filter((row) => matchesFilter(row, view.filter) && (view.section === "all" || row.section === view.section) && matchesQuery(row, view.query));
}

const RANK = { GAP: 0, ACCEPTED_GAP: 1, COVERED: 2 } as const;

/** The selected rows grouped by section in table order; with `gapsFirst`, open gaps, then accepted, then covered inside a section. */
export function displayGroups(rows: CoverageRow[], gapsFirst: boolean): SectionGroup[] {
  return sectionsOf(rows).map(({ section, rows: items }) => ({
    section,
    rows: gapsFirst ? [...items].sort((a, b) => RANK[a.state] - RANK[b.state]) : items,
  }));
}

/** The ids of the open gaps among the rows: what a curator can tick. */
export const openGapIds = (rows: CoverageRow[]) => rows.filter((row) => row.state === "GAP").map((row) => row.id);

// CSV

export function mappedLabel(mapping: Pick<CoverageRow["mappings"][number], "coverage">): string {
  return mapping.coverage === "FULL" ? "Full" : "Partial";
}

/**
 * The rows in view as a CSV, built in the browser from what the page holds: the server export's columns
 * (one line per Requirement and mapped Control; a Requirement with no mapping gets one line with the Control
 * columns empty), in the order the table shows them.
 */
export function coverageCsv(groups: SectionGroup[]): string {
  const rows = groups.flatMap(({ section, rows: items }) =>
    items.flatMap((row) => {
      const state = COVERAGE_STATE_LABEL[row.state];
      const justification = row.state === "ACCEPTED_GAP" ? row.justification : null;
      const lead = [section, row.code, row.title];
      if (row.mappings.length === 0) return [[...lead, "", "", "", "", state, justification]];
      return row.mappings.map((mapping) => [...lead, mapping.code, mapping.title, mappedLabel(mapping), mapping.rationale, state, justification]);
    }),
  );
  return toCsv(COVERAGE_CSV_HEADER, rows);
}

export const coverageCsvFilename = (framework: { name: string; version: string }, date: Date) =>
  csvFilename([frameworkLabel(framework), "coverage"], date);

// Drawer

export const ACCEPT_TEMPLATES = [
  "Out of scope for our environment: ",
  "Covered by a contractual commitment from ",
  "Risk accepted at the management review on ",
  "Compensated by ",
];

/** A suggested code for a Supplementary Control: the Framework's name and the Requirement's code. */
export function supplementaryCode(framework: { name: string }, row: Pick<CoverageRow, "code">): string {
  const prefix = framework.name.replace(/\W+/g, "").slice(0, 6).toUpperCase() || "SUP";
  return `${prefix}-${row.code.replace(/\s+/g, "")}`;
}

const STOP = new Set(["the", "and", "for", "with", "of", "to", "on", "in", "a", "by", "or", "only", "before", "after", "that", "use", "information", "systems", "system"]);
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));

/**
 * Controls worth mapping to a Requirement, best first: those already mapped (not as Supplementary) to other
 * Requirements of the same section, one point per Requirement, then Library Controls (not Supplementary ones) whose title shares words
 * with the Requirement's, two points per shared word. Never one already mapped to it.
 */
export function suggestControls(row: CoverageRow, all: CoverageRow[], library: LibraryControl[], limit = 4): LibraryControl[] {
  // A Supplementary Control belongs to one Framework: never suggested, from either source.
  const byCode = new Map(library.filter((control) => !control.supplementary).map((control) => [control.code, control]));
  const score = new Map<string, number>();
  for (const other of all) {
    if (other.id === row.id || other.section !== row.section) continue;
    for (const mapping of other.mappings) {
      if (!mapping.supplementary) score.set(mapping.code, (score.get(mapping.code) ?? 0) + 1);
    }
  }
  const mine = words(row.title);
  for (const control of byCode.values()) {
    const hits = words(control.title).filter((x) => mine.some((y) => y.startsWith(x.slice(0, 5)) || x.startsWith(y.slice(0, 5)))).length;
    if (hits > 0) score.set(control.code, (score.get(control.code) ?? 0) + hits * 2);
  }
  const mapped = new Set(row.mappings.map((mapping) => mapping.code));
  return [...score.entries()]
    .filter(([code]) => !mapped.has(code) && byCode.has(code))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], undefined, { numeric: true }))
    .slice(0, limit)
    .map(([code]) => byCode.get(code)!);
}

/** The Control a typed or picked value names: its code, or its title (either way ignoring case), or "CODE title". */
export function resolveControl(input: string, library: LibraryControl[]): LibraryControl | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  return (
    library.find((control) => control.code.toLowerCase() === value) ??
    library.find((control) => control.title.toLowerCase() === value) ??
    library.find((control) => value.startsWith(`${control.code.toLowerCase()} `)) ??
    null
  );
}

/** Why a Requirement is in the state it is in, in a sentence. */
export function whyText(row: Pick<CoverageRow, "state" | "mappings">): string {
  if (row.state === "COVERED") return "Covered: at least one mapped Control gives Full coverage.";
  if (row.state === "ACCEPTED_GAP") return "An accepted gap: still a Coverage Gap, but counted as resolved.";
  return row.mappings.length > 0
    ? "A Coverage Gap: its mappings are all Partial, and Partial mappings never add up to Full."
    : "A Coverage Gap: no Control is mapped to it.";
}

/** "30 Oct 2026", in UTC so the server and the browser print the same day. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

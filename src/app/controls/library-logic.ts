import type { ControlApplicability, ControlAssessmentStatus, ImpactLevel } from "@prisma/client";
import { STATUS_LABEL, STATUS_ORDER } from "@/app/organization/controls/controls-logic";
import { csvFilename, toCsv } from "@/lib/csv";
import { APPLICABILITY_LABEL } from "@/lib/statement-of-applicability-rules";
import type { LibraryRow } from "./library-types";

/**
 * The pure side of the Control Library workbench (design proposal A "Workbench", issue #313): the stat cards'
 * views, the facets with their live counts, search, grouping, sorting, the highlighted matches and the CSV.
 * No Prisma values, no React, so the component and the unit tests share it.
 */

const collator = new Intl.Collator("en", { numeric: true });

// ---------------------------------------------------------------- status

/** The Organization status of a row, or the stand-in for a Per-System Control, which has none. */
export type StatusKey = ControlAssessmentStatus | "PER_SYSTEM";

export const PER_SYSTEM_ONLY = "Per System only";

/** The order of statuses everywhere: the legend, the groups, the sort. Per System only comes last. */
export const STATUS_KEYS: StatusKey[] = [...STATUS_ORDER, "PER_SYSTEM"];

export const statusKeyOf = (row: Pick<LibraryRow, "orgStatus">): StatusKey => row.orgStatus ?? "PER_SYSTEM";

export const statusLabelOf = (row: Pick<LibraryRow, "orgStatus">): string => (row.orgStatus ? STATUS_LABEL[row.orgStatus] : PER_SYSTEM_ONLY);

export type StatusCounts = Record<ControlAssessmentStatus, number>;

/** The Organizational and Both Controls by Organization status (a Per-System Control has none). */
export function orgStatusCounts(rows: Pick<LibraryRow, "orgStatus">[]): StatusCounts {
  const counts = { NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, WAIVED: 0, NOT_APPLICABLE: 0 } satisfies StatusCounts;
  for (const row of rows) if (row.orgStatus) counts[row.orgStatus] += 1;
  return counts;
}

export const orgImplementedCount = (rows: Pick<LibraryRow, "orgStatus">[]) => rows.filter((row) => row.orgStatus !== null).length;

export function percentFulfilled(rows: Pick<LibraryRow, "orgStatus">[]): number {
  const total = orgImplementedCount(rows);
  return total === 0 ? 0 : Math.round((rows.filter((row) => row.orgStatus === "FULFILLED").length / total) * 100);
}

// ---------------------------------------------------------------- views (the stat cards)

export type ViewKey = "all" | "noowner" | "unmapped" | "notstarted" | "mine";

/** The five stat cards, in order. */
export const CARDS: { key: ViewKey; label: string; tone: "" | "warn" | "danger" }[] = [
  { key: "all", label: "All Controls", tone: "" },
  { key: "noowner", label: "Needs an owner", tone: "danger" },
  { key: "unmapped", label: "Not mapped", tone: "warn" },
  { key: "notstarted", label: "Not started", tone: "" },
  { key: "mine", label: "Owned by me", tone: "" },
];

export function viewTest(view: ViewKey, userId: string): (row: LibraryRow) => boolean {
  switch (view) {
    case "all":
      return () => true;
    case "noowner":
      return (row) => row.ownerId === null;
    case "unmapped":
      return (row) => row.mappings.length === 0;
    case "notstarted":
      return (row) => row.orgStatus === "NOT_STARTED";
    case "mine":
      return (row) => row.ownerId === userId;
  }
}

// ---------------------------------------------------------------- facets

export type FacetKey = "source" | "applicability" | "status" | "owner" | "category" | "facet" | "sensitivity";

export type FacetOption = { value: string; label: string };

export type FacetDef = {
  key: FacetKey;
  label: string;
  /** Long lists show the first few options and "Show all N". */
  long?: boolean;
  /** The values a row has for this facet (a Deployment Facet row can have several). */
  values: (row: LibraryRow) => FacetOption[];
};

export const FACET_SHOWN = 6;

const APPLICABILITY_ORDER: ControlApplicability[] = ["ORGANIZATIONAL", "PER_SYSTEM", "BOTH"];

export const FACETS: FacetDef[] = [
  { key: "source", label: "Source", values: (row) => [{ value: row.source.key, label: row.source.label }] },
  { key: "applicability", label: "Applicability", values: (row) => [{ value: row.applicability, label: APPLICABILITY_LABEL[row.applicability] }] },
  { key: "status", label: "Organization status", values: (row) => [{ value: statusKeyOf(row), label: statusLabelOf(row) }] },
  {
    key: "owner",
    label: "Control Owner",
    values: (row) => [row.ownerId ? { value: row.ownerId, label: row.ownerName ?? "Unknown user" } : { value: "", label: "Unassigned" }],
  },
  { key: "category", label: "Category", long: true, values: (row) => [{ value: row.category, label: row.category }] },
  {
    key: "facet",
    label: "Deployment Facet",
    values: (row) => (row.deploymentFacets.length > 0 ? row.deploymentFacets.map((name) => ({ value: name, label: name })) : [{ value: "", label: "Any" }]),
  },
  {
    key: "sensitivity",
    label: "Sensitivity Level",
    values: (row) =>
      row.minSensitivityLevel === null
        ? [{ value: "none", label: "None" }]
        : [{ value: String(row.minSensitivityLevel), label: `From ${row.minSensitivityLabel ?? `Level ${row.minSensitivityLevel}`}` }],
  },
];

export const facetDef = (key: FacetKey) => FACETS.find((facet) => facet.key === key)!;

/** The selected values per facet; a facet with none selected filters nothing. */
export type FacetSelections = Partial<Record<FacetKey, string[]>>;

export type Filters = { view: ViewKey; facets: FacetSelections; query: string };

export const NO_FILTERS: Filters = { view: "all", facets: {}, query: "" };

const haystack = (row: LibraryRow) => `${row.code} ${row.title} ${row.description} ${row.category} ${row.ownerName ?? ""}`.toLowerCase();

/** Does the row pass every filter, except the facet `skip` (so that facet's counts say what ticking a box would show)? */
export function rowPasses(row: LibraryRow, filters: Filters, userId: string, skip?: FacetKey): boolean {
  if (!viewTest(filters.view, userId)(row)) return false;
  const needle = filters.query.trim().toLowerCase();
  if (needle && !haystack(row).includes(needle)) return false;
  for (const facet of FACETS) {
    if (facet.key === skip) continue;
    const selected = filters.facets[facet.key];
    if (selected && selected.length > 0 && !facet.values(row).some((option) => selected.includes(option.value))) return false;
  }
  return true;
}

export const filterRows = (rows: LibraryRow[], filters: Filters, userId: string) => rows.filter((row) => rowPasses(row, filters, userId));

export type FacetOptionWithCount = FacetOption & { count: number };

/** Every value the facet has in `rows`, with the number of rows that would show if only it were ticked; ordered for display. */
export function facetOptions(rows: LibraryRow[], key: FacetKey, filters: Filters, userId: string): FacetOptionWithCount[] {
  const def = facetDef(key);
  const options = new Map<string, FacetOptionWithCount>();
  for (const row of rows) {
    const passes = rowPasses(row, filters, userId, key);
    for (const option of def.values(row)) {
      const entry = options.get(option.value) ?? { ...option, count: 0 };
      if (passes) entry.count += 1;
      options.set(option.value, entry);
    }
  }
  const all = [...options.values()];
  switch (key) {
    case "status":
      return all.sort((a, b) => STATUS_KEYS.indexOf(a.value as StatusKey) - STATUS_KEYS.indexOf(b.value as StatusKey));
    case "applicability":
      return all.sort((a, b) => APPLICABILITY_ORDER.indexOf(a.value as ControlApplicability) - APPLICABILITY_ORDER.indexOf(b.value as ControlApplicability));
    case "sensitivity":
      // From the lowest level up, "None" last.
      return all.sort((a, b) => (a.value === "none" ? 1 : b.value === "none" ? -1 : Number(a.value) - Number(b.value)));
    case "source":
      return all.sort((a, b) => (a.value === "base" ? -1 : b.value === "base" ? 1 : collator.compare(a.label, b.label)));
    default:
      // Most rows first, then by name; "Unassigned" and "Any" are values like the others.
      return all.sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
  }
}

/** One chip per active filter: the stat card's view, and each ticked facet value. */
export type FilterChip = { id: string; label: string; value: string; facet: FacetKey | "view" };

const viewLabel = (view: ViewKey) => CARDS.find((card) => card.key === view)!.label;

export function filterChips(rows: LibraryRow[], filters: Filters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.view !== "all") chips.push({ id: `view:${filters.view}`, label: "View", value: viewLabel(filters.view), facet: "view" });
  for (const facet of FACETS) {
    for (const value of filters.facets[facet.key] ?? []) {
      const label = rows.flatMap((row) => facet.values(row)).find((option) => option.value === value)?.label ?? value;
      chips.push({ id: `${facet.key}:${value}`, label: facet.label, value: label, facet: facet.key });
    }
  }
  return chips;
}

export const hasFilters = (filters: Filters) =>
  filters.view !== "all" || filters.query.trim() !== "" || FACETS.some((facet) => (filters.facets[facet.key] ?? []).length > 0);

/** Ticks or unticks one value of a facet. */
export function toggleFacetValue(facets: FacetSelections, key: FacetKey, value: string): FacetSelections {
  const current = facets[key] ?? [];
  const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
  const rest = { ...facets };
  if (next.length === 0) delete rest[key];
  else rest[key] = next;
  return rest;
}

export function clearFacet(facets: FacetSelections, key: FacetKey): FacetSelections {
  const rest = { ...facets };
  delete rest[key];
  return rest;
}

// ---------------------------------------------------------------- search highlight

export type TextPart = { text: string; match: boolean };

/** `text` cut into parts, the occurrences of `query` (case-insensitive) marked. No query is one unmarked part. */
export function highlightParts(text: string, query: string): TextPart[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const parts: TextPart[] = [];
  let at = 0;
  for (let found = lower.indexOf(needle, at); found !== -1; found = lower.indexOf(needle, at)) {
    if (found > at) parts.push({ text: text.slice(at, found), match: false });
    parts.push({ text: text.slice(found, found + needle.length), match: true });
    at = found + needle.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), match: false });
  return parts.length > 0 ? parts : [{ text, match: false }];
}

// ---------------------------------------------------------------- sorting, grouping

export type SortKey = "code" | "title" | "owner" | "maps" | "status";
export type Sort = { key: SortKey; dir: 1 | -1 };

export const DEFAULT_SORT: Sort = { key: "code", dir: 1 };

/** Clicking a column: the same column flips the direction, another starts ascending. */
export const nextSort = (sort: Sort, key: SortKey): Sort => ({ key, dir: sort.key === key ? (sort.dir === 1 ? -1 : 1) : 1 });

function sortValue(row: LibraryRow, key: SortKey): string | number {
  switch (key) {
    case "code":
      return row.code;
    case "title":
      return row.title;
    case "owner":
      return row.ownerName ?? "";
    case "maps":
      return row.mappings.length;
    case "status":
      return STATUS_KEYS.indexOf(statusKeyOf(row));
  }
}

/** The rows ordered by the column, ties by code. An unassigned owner sorts last, whichever way. */
export function sortRows(rows: LibraryRow[], sort: Sort): LibraryRow[] {
  return [...rows].sort((a, b) => {
    if (sort.key === "owner" && (a.ownerName === null) !== (b.ownerName === null)) return a.ownerName === null ? 1 : -1;
    const left = sortValue(a, sort.key);
    const right = sortValue(b, sort.key);
    const order = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
    return sort.dir * order || collator.compare(a.code, b.code);
  });
}

export type GroupBy = "category" | "owner" | "status" | "source" | "none";

export const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "category", label: "Category" },
  { key: "owner", label: "Owner" },
  { key: "status", label: "Status" },
  { key: "source", label: "Source" },
  { key: "none", label: "None" },
];

export type Group = { key: string; name: string; rows: LibraryRow[]; owned: number };

/** The rows (already in sort order) in groups, in display order. No grouping is one group with an empty name. */
export function groupRows(rows: LibraryRow[], by: GroupBy): Group[] {
  const make = (key: string, name: string, list: LibraryRow[]): Group => ({ key, name, rows: list, owned: list.filter((row) => row.ownerId !== null).length });
  if (by === "none") return rows.length === 0 ? [] : [make("", "", rows)];
  const groups = new Map<string, { name: string; rows: LibraryRow[] }>();
  for (const row of rows) {
    const { key, name } =
      by === "category"
        ? { key: row.category, name: row.category }
        : by === "owner"
          ? { key: row.ownerId ?? "", name: row.ownerName ?? "Unassigned" }
          : by === "status"
            ? { key: statusKeyOf(row) as string, name: statusLabelOf(row) }
            : { key: row.source.key, name: row.source.label };
    const group = groups.get(key) ?? { name, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const all = [...groups.entries()].map(([key, group]) => make(key, group.name, group.rows));
  switch (by) {
    case "status":
      return all.sort((a, b) => STATUS_KEYS.indexOf(a.key as StatusKey) - STATUS_KEYS.indexOf(b.key as StatusKey));
    case "owner":
      return all.sort((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : collator.compare(a.name, b.name) || (a.key < b.key ? -1 : 1)));
    case "source":
      return all.sort((a, b) => (a.key === "base" ? -1 : b.key === "base" ? 1 : collator.compare(a.name, b.name)));
    default:
      return all.sort((a, b) => collator.compare(a.name, b.name));
  }
}

/** The ids of the rows to render now: the first `limit` rows of the groups that are not collapsed. */
export function visibleIds(groups: Group[], collapsed: ReadonlySet<string>, limit: number): Set<string> {
  const ids = new Set<string>();
  for (const group of groups) {
    if (collapsed.has(group.key)) continue;
    for (const row of group.rows) {
      if (ids.size >= limit) return ids;
      ids.add(row.id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------- text, CSV

const IMPACT_LABEL: Record<ImpactLevel, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" };
export const impactLabel = (level: ImpactLevel) => IMPACT_LABEL[level];

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const CSV_HEADER = [
  "Code",
  "Title",
  "Description",
  "Category",
  "Applicability",
  "Source",
  "Mandatory",
  "Control Owner",
  "Organization status",
  "Systems it applies to",
  "Requirements satisfied",
  "Satisfies",
  "Deployment Facets",
  "Minimum Sensitivity Level",
  "Minimum Integrity",
  "Minimum Availability",
] as const;

/** The rows as a CSV, built in the browser, in the order given. What the viewer can't see is not in `rows`. */
export function libraryCsv(rows: LibraryRow[]): string {
  return toCsv(
    CSV_HEADER,
    rows.map((row) => [
      row.code,
      row.title,
      row.description,
      row.category,
      APPLICABILITY_LABEL[row.applicability],
      row.source.label,
      row.mandatory ? "Yes" : "No",
      row.ownerName ?? "",
      statusLabelOf(row),
      row.applicability === "ORGANIZATIONAL" ? "" : row.systemCount,
      row.mappings.length,
      row.mappings.map((mapping) => `${mapping.framework.label} ${mapping.requirementCode}${mapping.coverage === "PARTIAL" ? " (partial)" : ""}`).join("; "),
      row.deploymentFacets.join("; "),
      row.minSensitivityLevel === null ? "" : (row.minSensitivityLabel ?? `Level ${row.minSensitivityLevel}`),
      row.minIntegrityImpactLevel ? impactLabel(row.minIntegrityImpactLevel) : "",
      row.minAvailabilityImpactLevel ? impactLabel(row.minAvailabilityImpactLevel) : "",
    ]),
  );
}

export const libraryCsvFilename = (date: Date, selection = false) => csvFilename(selection ? ["Control-Library", "selection"] : ["Control-Library"], date);

export type FrameworkMappings = { framework: { id: string; label: string }; draft: boolean; mappings: LibraryRow["mappings"] };

/** The Requirements a row satisfies, grouped by Framework (the mappings are in Framework order already). */
export function mappingsByFramework(row: Pick<LibraryRow, "mappings">): FrameworkMappings[] {
  const groups = new Map<string, FrameworkMappings>();
  for (const mapping of row.mappings) {
    const group = groups.get(mapping.framework.id) ?? { framework: mapping.framework, draft: mapping.draft, mappings: [] };
    group.mappings.push(mapping);
    groups.set(mapping.framework.id, group);
  }
  return [...groups.values()];
}

/** The hash that opens a Control's drawer: `#A.5.1`. */
export const hashForCode = (code: string) => `#${encodeURIComponent(code)}`;

/** The Control code in a URL hash; "" when there is none. */
export function codeFromHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

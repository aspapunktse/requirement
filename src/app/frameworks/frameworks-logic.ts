import { csvFilename, toCsv } from "@/lib/csv";
import { frameworkLabel } from "@/lib/framework-label";
import { compareFrameworksDefault } from "@/lib/framework-family";
import type { CatalogRow, GroupKey, SortKey, ViewKey } from "./frameworks-types";

/**
 * The pure rules of the Framework list: which row is in which view, the search, the sort, the grouping and
 * the CSV. Shared by the client component and driven directly by the tests. No Prisma, no React.
 */

/** Share of the Requirements that are covered or accepted, 0 to 100; null for a Framework with no Requirements. */
export function resolvedPercent(row: Pick<CatalogRow, "requirements" | "covered" | "accepted">): number | null {
  return row.requirements === 0 ? null : Math.round(((row.covered + row.accepted) / row.requirements) * 100);
}

/** Open gaps whose Requirement has no Control Mapping at all. */
export const unmappedGaps = (row: Pick<CatalogRow, "gaps" | "partialOnly">) => row.gaps - row.partialOnly;

// Views

export function inView(row: CatalogRow, view: ViewKey): boolean {
  switch (view) {
    case "all":
      return true;
    case "drafts":
      return row.status === "DRAFT";
    case "gaps":
      return row.gaps > 0;
    case "resolved":
      return row.requirements > 0 && row.gaps === 0;
    case "empty":
      return row.requirements === 0;
  }
}

export function viewCounts(rows: CatalogRow[]): Record<ViewKey, number> {
  const count = (view: ViewKey) => rows.filter((row) => inView(row, view)).length;
  return { all: count("all"), drafts: count("drafts"), gaps: count("gaps"), resolved: count("resolved"), empty: count("empty") };
}

/** The rows in the view that match the search over the label, the description and the Review Group. */
export function matchRows(rows: CatalogRow[], view: ViewKey, query: string): CatalogRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (!inView(row, view)) return false;
    if (!q) return true;
    return `${frameworkLabel(row)} ${row.description ?? ""} ${row.reviewGroup ?? ""}`.toLowerCase().includes(q);
  });
}

// Sorting

const sortValue = (row: CatalogRow, sort: Exclude<SortKey, "default">): string | number =>
  sort === "name"
    ? row.name.toLowerCase()
    : sort === "resolved"
      ? (resolvedPercent(row) ?? -1)
      : sort === "gaps"
        ? row.gaps
        : sort === "systems"
          ? (row.systems ?? -1)
          : Date.parse(row.updatedAt);

/** The rows in the chosen order; ties fall back to the default order, so the order is stable. */
export function sortRows(rows: CatalogRow[], sort: SortKey, dir: 1 | -1): CatalogRow[] {
  return [...rows].sort((a, b) => {
    if (sort === "default") return compareFrameworksDefault(a, b);
    const x = sortValue(a, sort);
    const y = sortValue(b, sort);
    return (x < y ? -1 : x > y ? 1 : 0) * dir || compareFrameworksDefault(a, b);
  });
}

// Grouping

export type Totals = { requirements: number; covered: number; accepted: number; gaps: number; partialOnly: number };

export function totalsOf(rows: Pick<CatalogRow, keyof Totals>[]): Totals {
  const totals: Totals = { requirements: 0, covered: 0, accepted: 0, gaps: 0, partialOnly: 0 };
  for (const row of rows) for (const key of Object.keys(totals) as (keyof Totals)[]) totals[key] += row[key];
  return totals;
}

export type RowGroup = { name: string; rows: CatalogRow[]; totals: Totals };

/** The groups in the order their first row appears; `none` gives no groups. */
export function groupRows(rows: CatalogRow[], group: GroupKey): RowGroup[] {
  if (group === "none") return [];
  const groups = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    const name = group === "family" ? row.group : row.status === "PUBLISHED" ? "Published" : "Draft";
    groups.set(name, [...(groups.get(name) ?? []), row]);
  }
  return [...groups].map(([name, list]) => ({ name, rows: list, totals: totalsOf(list) }));
}

/** The rows in the order the table shows them: group after group, or the sorted list. */
export function displayOrder(rows: CatalogRow[], group: GroupKey): CatalogRow[] {
  return group === "none" ? rows : groupRows(rows, group).flatMap((g) => g.rows);
}

// CSV

export const CSV_HEADER = [
  "Framework",
  "Version",
  "Family",
  "Status",
  "Base Framework",
  "Strict",
  "Requirements",
  "Covered",
  "Accepted gaps",
  "Open gaps",
  "Gaps, Partial mappings only",
  "Gaps, no mapping",
  "Resolved %",
  "Systems",
  "Review Group",
  "Updated",
  "Description",
];

/** The rows as a CSV, in the order given (the table's order), built from what the page already holds. */
export function frameworksCsv(rows: CatalogRow[]): string {
  return toCsv(
    CSV_HEADER,
    rows.map((row) => [
      row.name,
      row.version,
      row.group,
      row.status === "PUBLISHED" ? "Published" : "Draft",
      row.isBase ? "Yes" : "No",
      row.strict ? "Yes" : "No",
      row.requirements,
      row.covered,
      row.accepted,
      row.gaps,
      row.partialOnly,
      unmappedGaps(row),
      resolvedPercent(row),
      row.systems,
      row.isBase ? "Base Review Step" : row.reviewGroup,
      row.updatedAt.slice(0, 10),
      row.description,
    ]),
  );
}

export const frameworksCsvFilename = (date: Date) => csvFilename(["frameworks"], date);

/** "30 Oct 2026", in UTC so the server and the browser print the same day. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

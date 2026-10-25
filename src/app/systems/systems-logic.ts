import type { ImpactLevel, UserRole } from "@prisma/client";
import { csvFilename, toCsv } from "@/lib/csv";
import { UNDER_FULFILLED_PERCENT } from "./systems-config";
import {
  HIGHEST_IMPACT_LABEL,
  IMPACT_LABEL,
  IMPACT_ORDER,
  STATUS_LABEL,
  STATUS_ORDER,
  VIEW_KEYS,
  type GroupKey,
  type HighestImpact,
  type RegisterState,
  type SortKey,
  type SystemRow,
  type ViewKey,
} from "./systems-types";

/**
 * The pure rules of the Systems list: which row is in which saved view, the filters, the sort, the
 * grouping, the paging and the CSV. Shared by the server (the stat cards' daily snapshots count with
 * `viewCounts`) and the client component, and driven directly by the tests. No Prisma, no React.
 */

// Saved views

/** Is the row in the saved view? "mine" and "attention" are decided on the server (they need data the row does not carry). */
export function inView(row: SystemRow, view: ViewKey): boolean {
  switch (view) {
    case "all":
      return true;
    case "mine":
      return row.inRoleView;
    case "attention":
      return row.needsAttention;
    case "unclassified":
      return row.confidentiality === null || row.integrity === null || row.availability === null;
    case "providers":
      return row.isProvider;
  }
}

/** How many of the rows each saved view holds. */
export function viewCounts(rows: SystemRow[]): Record<ViewKey, number> {
  return Object.fromEntries(VIEW_KEYS.map((view) => [view, rows.filter((row) => inView(row, view)).length])) as Record<ViewKey, number>;
}

// Highest Impact Level

const levels = (row: SystemRow): (ImpactLevel | null)[] => [row.confidentiality, row.integrity, row.availability];

/** 0 for not classified, then 1 (Low) to 4 (Critical). */
const impactRank = (level: ImpactLevel | null) => (level === null ? 0 : IMPACT_ORDER.indexOf(level) + 1);

/** The highest of the three axes' Impact Levels; NONE when none is classified. */
export function highestImpact(row: SystemRow): HighestImpact {
  const top = Math.max(...levels(row).map(impactRank));
  return top === 0 ? "NONE" : IMPACT_ORDER[top - 1];
}

// Fulfilment

/** Requirements met as a fraction of the applicable ones (base Framework); null when it cannot be measured. */
export function fulfilment(row: Pick<SystemRow, "met" | "applicable">): number | null {
  return row.met === null || row.applicable === null || row.applicable === 0 ? null : row.met / row.applicable;
}

// Filters

export type FilterKey = "owners" | "units" | "facets" | "impact";
export const FILTER_KEYS: FilterKey[] = ["owners", "units", "facets", "impact"];

/** The values of the row a filter looks at. */
export function filterValues(row: SystemRow, key: FilterKey): string[] {
  switch (key) {
    case "owners":
      return [row.ownerId];
    case "units":
      return row.businessUnits.map((unit) => unit.id);
    case "facets":
      return row.facets.map((facet) => facet.id);
    case "impact":
      return [highestImpact(row)];
  }
}

/** The rows in the saved view that match the search and the filters (the status tab is applied by the caller). */
export function matchRows(rows: SystemRow[], state: Pick<RegisterState, "view" | "q" | "owners" | "units" | "facets" | "impact">): SystemRow[] {
  const q = state.q.trim().toLowerCase();
  return rows.filter((row) => {
    if (!inView(row, state.view)) return false;
    if (q && !`${row.name} ${row.vendor ?? ""} ${row.ownerName}`.toLowerCase().includes(q)) return false;
    return FILTER_KEYS.every((key) => state[key].length === 0 || filterValues(row, key).some((value) => (state[key] as string[]).includes(value)));
  });
}

/** True when anything narrows the list: a saved view, a status tab, a search or a filter. */
export const hasActiveFilters = (state: RegisterState) =>
  state.view !== "all" || state.status !== "" || state.q.trim() !== "" || FILTER_KEYS.some((key) => state[key].length > 0);

/** The options of a filter among `rows`, with a label, sorted by label (Impact Levels in ascending order). */
export function filterOptions(rows: SystemRow[], key: FilterKey): { value: string; label: string }[] {
  if (key === "impact") return (Object.keys(HIGHEST_IMPACT_LABEL) as HighestImpact[]).map((value) => ({ value, label: HIGHEST_IMPACT_LABEL[value] }));
  const found = new Map<string, string>();
  for (const row of rows) {
    if (key === "owners") found.set(row.ownerId, row.ownerName);
    else for (const item of key === "units" ? row.businessUnits : row.facets) found.set(item.id, item.name);
  }
  return [...found].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

// Sorting

const byText = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

const firstUnit = (row: SystemRow): string | null => row.businessUnits.map((unit) => unit.name).sort(byText)[0] ?? null;

/** The value a column sorts by, or null when the row has none (such a row sorts last in both directions). */
function sortValue(row: SystemRow, sort: SortKey): string | number | null {
  switch (sort) {
    case "name":
      return row.name.toLowerCase();
    case "status":
      return STATUS_ORDER.indexOf(row.status);
    case "owner":
      return row.ownerName.toLowerCase();
    case "cia":
      // Highest impact first when ascending, as in the prototype.
      return -Math.max(...levels(row).map(impactRank));
    case "unit":
      return firstUnit(row)?.toLowerCase() ?? null;
    case "prog":
      return fulfilment(row);
    case "upd":
      // Newest first when ascending.
      return -Date.parse(row.updatedAt);
  }
}

/** The rows in the chosen order; ties fall back to the name, so the order is stable. */
export function sortRows(rows: SystemRow[], sort: SortKey, dir: 1 | -1): SystemRow[] {
  return [...rows].sort((a, b) => {
    const x = sortValue(a, sort);
    const y = sortValue(b, sort);
    if ((x === null) !== (y === null)) return x === null ? 1 : -1;
    const result = x === null || y === null ? 0 : x < y ? -1 : x > y ? 1 : 0;
    return result * dir || byText(a.name, b.name) || a.id.localeCompare(b.id);
  });
}

// Paging

export function pageOf<T>(rows: T[], page: number, per: number): { items: T[]; page: number; pages: number; from: number } {
  const pages = Math.max(1, Math.ceil(rows.length / per));
  const current = Math.min(Math.max(1, page), pages);
  const from = (current - 1) * per;
  return { items: rows.slice(from, from + per), page: current, pages, from };
}

// Grouping

/** The group names a row falls in. A row with several Business Units is listed under each. */
export function groupNames(row: SystemRow, group: GroupKey): string[] {
  switch (group) {
    case "owner":
      return [row.ownerName];
    case "unit":
      return row.businessUnits.length > 0 ? row.businessUnits.map((unit) => unit.name) : ["No Business Unit"];
    case "facet":
      return [row.facets.length > 0 ? row.facets.map((facet) => facet.name).join(" + ") : "No Deployment Facet"];
    case "":
      return [""];
  }
}

export function groupRows(rows: SystemRow[], group: GroupKey): { name: string; rows: SystemRow[] }[] {
  const groups = new Map<string, SystemRow[]>();
  for (const row of rows) {
    for (const name of groupNames(row, group)) {
      const list = groups.get(name) ?? [];
      list.push(row);
      groups.set(name, list);
    }
  }
  return [...groups].sort(([a], [b]) => byText(a, b)).map(([name, list]) => ({ name, rows: list }));
}

// CSV

export const CSV_HEADER = [
  "System",
  "Vendor",
  "Provider",
  "Status",
  "Open questions",
  "Owner",
  "Deployment Facets",
  "Confidentiality",
  "Integrity",
  "Availability",
  "Business Units",
  "Requirements met",
  "Requirements applicable",
  "Requirements met %",
  "Updated",
] as const;

const levelLabel = (level: ImpactLevel | null) => (level === null ? "Not classified" : IMPACT_LABEL[level]);

/**
 * The register as CSV, one row per System with the columns of the table and the full lists of Deployment
 * Facets and Business Units. Built from rows already on the page, so it never holds more than the user
 * sees. Every cell is quoted, a quote is doubled, and a value a spreadsheet would run as a formula
 * (`= + - @`, or a leading tab or carriage return) gets a leading apostrophe (`toCsv`).
 */
export function systemsCsv(rows: SystemRow[]): string {
  return toCsv(
    CSV_HEADER,
    rows.map((row) => {
      const share = fulfilment(row);
      return [
        row.name,
        row.vendor ?? "Built in-house",
        row.isProvider ? "Yes" : "No",
        STATUS_LABEL[row.status],
        row.openQuestions,
        row.ownerName,
        row.facets.map((facet) => facet.name).join("; "),
        levelLabel(row.confidentiality),
        levelLabel(row.integrity),
        levelLabel(row.availability),
        row.businessUnits.map((unit) => unit.name).join("; "),
        row.met,
        row.applicable,
        share === null ? "" : Math.round(share * 100),
        row.updatedAt.slice(0, 10),
      ];
    }),
  );
}

export const systemsCsvFilename = (scope: "register" | "selection", date: Date) => csvFilename(["systems", scope], date);

// The acting role's own saved view

/** The roles with a view of their own; every other role gets "Under 70% met". */
const OWN_VIEW_ROLES: UserRole[] = ["SYSTEM_OWNER", "REVIEWER", "RISK_OWNER", "BUSINESS_RISK_OWNER"];

/** Does this role's own view need the base-Framework fulfilment figures? */
export const roleViewNeedsFulfilment = (role: UserRole) => !OWN_VIEW_ROLES.includes(role);

/** The label of the acting role's own view, and whether a number above zero reads as something to do. */
export function roleViewOf(role: UserRole): { label: string; warn: boolean } {
  switch (role) {
    case "SYSTEM_OWNER":
      return { label: "Owned by me", warn: false };
    case "REVIEWER":
      return { label: "Awaiting review", warn: true };
    case "RISK_OWNER":
      return { label: "With open Risks", warn: true };
    case "BUSINESS_RISK_OWNER":
      return { label: "In my scope", warn: false };
    default:
      return { label: `Under ${UNDER_FULFILLED_PERCENT}% met`, warn: true };
  }
}

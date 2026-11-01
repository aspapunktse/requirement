import type { ControlAssessmentStatus } from "@prisma/client";
import { csvFilename, toCsv } from "@/lib/csv";
import { IMPLEMENTATION_STATUSES_REQUIRING_DESCRIPTION } from "@/lib/organization-implementation-rules";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import type { OrgControlRow, OrgHistoryEntry } from "./controls-types";

/**
 * The pure side of the Organization Control Implementations page (design proposal A "Implementation
 * register", issue #284): views, tabs, filters, grouping, counts, CSV and the row update after a save.
 * No Prisma values, no React, so the component and the unit tests share it.
 */

const collator = new Intl.Collator("en", { numeric: true });

/** The order of statuses everywhere: the ring's legend, the groups, the bars, the pills. */
export const STATUS_ORDER: ControlAssessmentStatus[] = ["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "WAIVED", "NOT_APPLICABLE"];

export const STATUS_LABEL = CONTROL_ASSESSMENT_STATUS_LABEL;

/** Waived and Not Applicable take a Control out of what the Organization has to satisfy, so they need a reason. */
export const REASON_STATUSES = IMPLEMENTATION_STATUSES_REQUIRING_DESCRIPTION;

export const needsReason = (status: ControlAssessmentStatus) => REASON_STATUSES.includes(status);

/** Starting points for the reason of a Waived or Not Applicable implementation. */
export const REASON_TEMPLATES = [
  "Risk accepted by the risk committee on ",
  "Not relevant: the Organization does not ",
  "Covered by the supplier’s certification until ",
] as const;

// ---------------------------------------------------------------- views (the cards and the ring's legend)

export type ViewKey = "all" | "mine" | "NOT_STARTED" | "reasoned" | "noowner" | "IN_PROGRESS" | "FULFILLED";

/** The five cards, in order. `IN_PROGRESS` and `FULFILLED` are views only the ring's legend opens. */
export const CARDS: { key: ViewKey; label: string; tone: "" | "warn" | "danger" }[] = [
  { key: "all", label: "All Controls", tone: "" },
  { key: "mine", label: "Controls I own", tone: "" },
  { key: "NOT_STARTED", label: "Not Started", tone: "warn" },
  { key: "reasoned", label: "Waived or N/A", tone: "" },
  { key: "noowner", label: "No Control Owner", tone: "danger" },
];

/** The view a status's legend entry opens: Waived and Not Applicable share "Waived or N/A". */
export const viewOfStatus = (status: ControlAssessmentStatus): ViewKey => (needsReason(status) ? "reasoned" : (status as "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED"));

export function viewTest(view: ViewKey, userId: string): (row: OrgControlRow) => boolean {
  switch (view) {
    case "all":
      return () => true;
    case "mine":
      return (row) => row.ownerId === userId;
    case "reasoned":
      return (row) => needsReason(row.status);
    case "noowner":
      return (row) => row.ownerId === null;
    default:
      return (row) => row.status === view;
  }
}

export type AppliesFilter = "all" | "ORGANIZATIONAL" | "BOTH";
export type GroupBy = "status" | "owner" | "none";

// ---------------------------------------------------------------- tabs (decision 3a)

export type Tab = { key: string; label: string };

export const ALL_TAB = "all";

const FIXED_TABS: Tab[] = [
  { key: "clauses", label: "Clauses 4–10" },
  { key: "a5", label: "A.5 Organizational" },
  { key: "a6", label: "A.6 People" },
  { key: "a7", label: "A.7 Physical" },
  { key: "a8", label: "A.8 Technological" },
];
const OTHER_TAB: Tab = { key: "other", label: "Other" };

/**
 * The theme of a Control, which decides its tab: a Supplementary Control goes in its origin Framework's
 * tab whatever its category; otherwise the category's prefix says ("4 Context of the organization" to
 * "10 Improvement" are the ISO 27001 clauses, "A.5 ..." to "A.8 ..." the Annex A themes). A category
 * that starts neither way falls into "Other".
 */
export function themeOf(row: Pick<OrgControlRow, "category" | "origin">): Tab {
  if (row.origin) return { key: `fw:${row.origin.key}`, label: row.origin.label };
  const category = row.category.trim();
  const annex = /^A\.([5-8])(?!\d)/.exec(category);
  if (annex) return FIXED_TABS.find((tab) => tab.key === `a${annex[1]}`)!;
  const clause = /^(\d{1,2})(?=$|[\s.:])/.exec(category);
  if (clause && Number(clause[1]) >= 4 && Number(clause[1]) <= 10) return FIXED_TABS[0];
  return OTHER_TAB;
}

/** All, the fixed themes, one tab per origin Framework, then Other. A tab nobody belongs to is left out. */
export function tabsFor(rows: Pick<OrgControlRow, "category" | "origin">[]): Tab[] {
  const present = new Map<string, Tab>();
  for (const row of rows) {
    const tab = themeOf(row);
    present.set(tab.key, tab);
  }
  const frameworks = [...present.values()].filter((tab) => tab.key.startsWith("fw:")).sort((a, b) => collator.compare(a.label, b.label));
  return [
    { key: ALL_TAB, label: "All" },
    ...FIXED_TABS.filter((tab) => present.has(tab.key)),
    ...frameworks,
    ...(present.has(OTHER_TAB.key) ? [OTHER_TAB] : []),
  ];
}

// ---------------------------------------------------------------- filters

export type Filters = { view: ViewKey; applies: AppliesFilter; query: string; tab: string };

/** The rows that pass every filter except the tab: what the tabs' counts are taken over. */
export function baseRows(rows: OrgControlRow[], filters: Omit<Filters, "tab">, userId: string): OrgControlRow[] {
  const inView = viewTest(filters.view, userId);
  const needle = filters.query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      inView(row) &&
      (filters.applies === "all" || row.applicability === filters.applies) &&
      (!needle || `${row.code} ${row.title} ${row.description ?? ""} ${row.ownerName ?? ""}`.toLowerCase().includes(needle)),
  );
}

export function filterRows(rows: OrgControlRow[], filters: Filters, userId: string): OrgControlRow[] {
  const base = baseRows(rows, filters, userId);
  return filters.tab === ALL_TAB ? base : base.filter((row) => themeOf(row).key === filters.tab);
}

// ---------------------------------------------------------------- counts, groups

export type StatusCounts = Record<ControlAssessmentStatus, number>;

export function statusCounts(rows: Pick<OrgControlRow, "status">[]): StatusCounts {
  const counts = { NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, WAIVED: 0, NOT_APPLICABLE: 0 } satisfies StatusCounts;
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

export function percentFulfilled(rows: Pick<OrgControlRow, "status">[]): number {
  return rows.length === 0 ? 0 : Math.round((rows.filter((row) => row.status === "FULFILLED").length / rows.length) * 100);
}

/** "3 Fulfilled": a status's count with its name, for screen readers. */
export const countLabel = (count: number, status: ControlAssessmentStatus) => `${count} ${STATUS_LABEL[status]}`;

export type Group = { key: string; name: string; rows: OrgControlRow[]; counts: StatusCounts };

/** The rows in groups, in display order. No grouping is one group with an empty name. Owners: no Control Owner first, then by name. */
export function groupRows(rows: OrgControlRow[], by: GroupBy): Group[] {
  if (by === "none") return rows.length === 0 ? [] : [{ key: "", name: "", rows, counts: statusCounts(rows) }];
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const key = by === "status" ? row.status : (row.ownerId ?? "");
    const group = groups.get(key) ?? { key, name: by === "status" ? STATUS_LABEL[row.status] : (row.ownerName ?? "No Control Owner"), rows: [], counts: statusCounts([]) };
    group.rows.push(row);
    group.counts[row.status] += 1;
    groups.set(key, group);
  }
  const all = [...groups.values()];
  if (by === "status") return all.sort((a, b) => STATUS_ORDER.indexOf(a.rows[0].status) - STATUS_ORDER.indexOf(b.rows[0].status));
  return all.sort((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : collator.compare(a.name, b.name) || (a.key < b.key ? -1 : 1)));
}

/** The statuses present in a group, in order, with their counts: the dots and numbers next to an owner's bar (decision 4a). */
export function presentStatuses(counts: StatusCounts): { status: ControlAssessmentStatus; count: number }[] {
  return STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => ({ status, count: counts[status] }));
}

// ---------------------------------------------------------------- editing

/** The row after a save: the response's implementation, and a history entry when the status moved. */
export function applySaved(
  row: OrgControlRow,
  saved: { implementation: { status: ControlAssessmentStatus; description: string | null; updatedBy: { name: string } | null; updatedAt: string | null } },
): OrgControlRow {
  const { implementation } = saved;
  const moved = implementation.status !== row.status;
  const entry: OrgHistoryEntry[] =
    moved && implementation.updatedAt
      ? [{ at: implementation.updatedAt, by: implementation.updatedBy?.name ?? row.updatedByName ?? "You", from: row.status, to: implementation.status }]
      : [];
  return {
    ...row,
    status: implementation.status,
    description: implementation.description,
    updatedAt: implementation.updatedAt,
    updatedByName: implementation.updatedBy?.name ?? row.updatedByName,
    history: [...entry, ...row.history],
  };
}

/** The next row after `currentId` in `order` that the user may edit; null when there is none. */
export function nextEditableId(order: OrgControlRow[], currentId: string): string | null {
  const at = order.findIndex((row) => row.id === currentId);
  return order.slice(at + 1).find((row) => row.canEdit)?.id ?? null;
}

// ---------------------------------------------------------------- dates, text

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "30 Oct 2026" (UTC, so the server and the browser agree). */
export function formatDate(iso: string | null): string {
  return iso ? DATE.format(new Date(iso)) : "—";
}

/** What an implementation does for Systems, in one sentence. */
export function reachText(row: OrgControlRow): string {
  if (row.frameworks.length === 0) return "Not mapped to a Requirement of a Published Framework yet, so its status counts on no System.";
  const frameworks = row.frameworks.join(", ");
  if (row.applicability === "BOTH") {
    const systems = `${row.systemCount} ${row.systemCount === 1 ? "System" : "Systems"}`;
    return `${row.status === "FULFILLED" ? `Inherited as Fulfilled by ${systems}.` : `Once Fulfilled, inherited by ${systems}.`} Maps to ${frameworks}.`;
  }
  return `Counts as this status on every System with ${frameworks} in scope.`;
}

/** "inherited by 12 Systems" / "reaches 12 Systems", next to a Both Control's title. */
export function reachTag(row: OrgControlRow): string | null {
  if (row.applicability !== "BOTH") return null;
  return `${row.status === "FULFILLED" ? "inherited by" : "reaches"} ${row.systemCount} ${row.systemCount === 1 ? "System" : "Systems"}`;
}

// ---------------------------------------------------------------- CSV (decision 5a)

export const CSV_HEADER = ["Code", "Title", "Applies to", "Category", "Control Owner", "Status", "Description", "Systems reached", "Last updated", "Updated by"] as const;

/** The rows in view as a CSV, built in the browser, in the order the table shows them. */
export function viewCsv(rows: OrgControlRow[]): string {
  return toCsv(
    CSV_HEADER,
    rows.map((row) => [
      row.code,
      row.title,
      row.applicability === "BOTH" ? "Both" : "Organizational",
      row.category,
      row.ownerName ?? "",
      STATUS_LABEL[row.status],
      row.description ?? "",
      row.applicability === "BOTH" ? row.systemCount : "",
      row.updatedAt ? row.updatedAt.slice(0, 10) : "",
      row.updatedByName ?? "",
    ]),
  );
}

export const viewCsvFilename = (date: Date) => csvFilename(["Organization-Controls"], date);

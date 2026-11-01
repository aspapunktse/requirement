import type { ControlAssessmentStatus } from "@prisma/client";
import { csvFilename } from "@/lib/csv";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { APPLICABILITY_LABEL } from "@/lib/statement-of-applicability-rules";
import { statementOfApplicabilityCsv } from "@/lib/statement-of-applicability-csv";
import type { SoaLedgerRow } from "./soa-types";

/**
 * The pure rules of the Statement of Applicability page (design proposal A "Statement Ledger", issue #272):
 * the views, the cards' totals, search and filters, grouping, implementation progress, the browser CSV and
 * the justification templates. Shared by the client component and driven directly by the tests. No Prisma
 * values, no React.
 */

// Views and cards

export type ViewKey = "all" | "included" | "excluded" | "missing" | "notstarted";
export type CardKey = "included" | "missing" | "org" | "sys";

/** Implementation progress of an included Control, 0 to 1 (see `progressOf`). */
export function progressOf(row: SoaLedgerRow): number | null {
  if (!row.included) return null;
  const parts: number[] = [];
  if (row.organizationStatus) {
    parts.push(row.organizationStatus === "IN_PROGRESS" ? 0.5 : row.organizationStatus === "NOT_STARTED" ? 0 : 1);
  }
  if (row.systemRollup && row.systemRollup.total > 0) parts.push(systemsDoneShare(row));
  return parts.length === 0 ? 0 : parts.reduce((sum, part) => sum + part, 0) / parts.length;
}

/** Done = Fulfilled, Waived or Not Applicable (the same "done" as the Systems card). */
const DONE_STATUSES: ControlAssessmentStatus[] = ["FULFILLED", "WAIVED", "NOT_APPLICABLE"];
export const isDoneStatus = (status: ControlAssessmentStatus) => DONE_STATUSES.includes(status);

function systemsDoneShare(row: SoaLedgerRow): number {
  const rollup = row.systemRollup;
  if (!rollup || rollup.total === 0) return 0;
  return DONE_STATUSES.reduce((sum, status) => sum + rollup.counts[status], 0) / rollup.total;
}

/**
 * "Not started anywhere": an included Control whose Organization status (if it has one) is Not Started and
 * whose Systems (if it applies to any) are all Not Started. One In Progress, Fulfilled, Waived or Not Applicable
 * status anywhere means work has begun. (`progressOf` alone would call an In Progress System "not started".)
 */
export function notStartedAnywhere(row: SoaLedgerRow): boolean {
  if (!row.included) return false;
  const organization = row.organizationStatus === null || row.organizationStatus === "NOT_STARTED";
  const systems = !row.systemRollup || row.systemRollup.counts.NOT_STARTED === row.systemRollup.total;
  return organization && systems;
}

export const VIEWS: { key: ViewKey; label: string; test: (row: SoaLedgerRow) => boolean; bad?: boolean }[] = [
  { key: "all", label: "All", test: () => true },
  { key: "included", label: "Included", test: (row) => row.included },
  { key: "excluded", label: "Excluded", test: (row) => !row.included },
  { key: "missing", label: "Missing justification", test: (row) => row.justificationMissing, bad: true },
  { key: "notstarted", label: "Not started anywhere", test: notStartedAnywhere },
];

export function viewTest(view: ViewKey): (row: SoaLedgerRow) => boolean {
  return VIEWS.find((candidate) => candidate.key === view)?.test ?? (() => true);
}

/** The view a card shows when it is switched on. The Systems card also narrows "Applies to" to Systems. */
export const CARD_VIEW: Record<CardKey, ViewKey> = { included: "excluded", missing: "missing", org: "notstarted", sys: "included" };

export const ROLLUP_ORDER: ControlAssessmentStatus[] = ["FULFILLED", "IN_PROGRESS", "NOT_STARTED", "WAIVED", "NOT_APPLICABLE"];
export const ORG_ORDER: ControlAssessmentStatus[] = ["FULFILLED", "IN_PROGRESS", "NOT_STARTED"];

export type Totals = {
  all: number;
  included: number;
  excluded: number;
  missing: number;
  /** The Organization's status over the included Controls that have one. */
  org: Record<ControlAssessmentStatus, number>;
  orgTotal: number;
  /** The Systems' effective statuses over every System Assessment of an included Control (all Systems, visible or not). */
  sys: Record<ControlAssessmentStatus, number>;
  sysTotal: number;
};

const emptyCounts = (): Record<ControlAssessmentStatus, number> => ({ NOT_STARTED: 0, IN_PROGRESS: 0, FULFILLED: 0, NOT_APPLICABLE: 0, WAIVED: 0 });

export function totalsOf(rows: SoaLedgerRow[]): Totals {
  const totals: Totals = { all: rows.length, included: 0, excluded: 0, missing: 0, org: emptyCounts(), orgTotal: 0, sys: emptyCounts(), sysTotal: 0 };
  for (const row of rows) {
    if (!row.included) {
      totals.excluded += 1;
      if (row.justificationMissing) totals.missing += 1;
      continue;
    }
    totals.included += 1;
    if (row.organizationStatus) {
      totals.org[row.organizationStatus] += 1;
      totals.orgTotal += 1;
    }
    if (row.systemRollup) {
      for (const status of ROLLUP_ORDER) totals.sys[status] += row.systemRollup.counts[status];
      totals.sysTotal += row.systemRollup.total;
    }
  }
  return totals;
}

/** A share as a whole percent; "—" when there is nothing to divide. */
export const percentText = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`);

// Search and filters

export type AppliesFilter = "" | "org" | "sys" | "both";

export type Filters = { view: ViewKey; query: string; framework: string; applies: AppliesFilter };

/** The text a search looks in: code, title, domain, the justification (authored or generated, which holds the Requirement codes). */
export function searchText(row: SoaLedgerRow): string {
  const codes = row.requirements.flatMap((group) => group.codes);
  return [row.code, row.title, row.category, row.exclusionJustification ?? "", row.inclusionJustification, ...codes].join(" ").toLowerCase();
}

export function matchesFilters(row: SoaLedgerRow, filters: Filters): boolean {
  if (!viewTest(filters.view)(row)) return false;
  const query = filters.query.trim().toLowerCase();
  if (query && !searchText(row).includes(query)) return false;
  if (filters.framework && !row.requirements.some((group) => group.framework === filters.framework)) return false;
  const org = row.included && row.appliesToOrganization;
  const systems = row.included && row.appliesToSystemCount > 0;
  if (filters.applies === "org" && !(org && !systems)) return false;
  if (filters.applies === "sys" && !(systems && !org)) return false;
  if (filters.applies === "both" && !(systems && org)) return false;
  return true;
}

export const selectRows = (rows: SoaLedgerRow[], filters: Filters) => rows.filter((row) => matchesFilters(row, filters));

/** The Published Frameworks the (included) Controls map to, for the filter menu, in label order. */
export function frameworkOptions(rows: SoaLedgerRow[]): string[] {
  const labels = new Set<string>();
  for (const row of rows) for (const group of row.requirements) labels.add(group.framework);
  return [...labels].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** "Organization + 3 Systems", or "Nothing" for an excluded Control. */
export function appliesText(row: SoaLedgerRow): string {
  if (!row.included) return "Nothing";
  return [row.appliesToOrganization ? "Organization" : "", row.appliesToSystemCount > 0 ? `${row.appliesToSystemCount} System${row.appliesToSystemCount === 1 ? "" : "s"}` : ""]
    .filter(Boolean)
    .join(" + ");
}

export const applicabilityText = (row: Pick<SoaLedgerRow, "applicability">) => `${APPLICABILITY_LABEL[row.applicability]} Control`;

// Grouping

export type GroupBy = "domain" | "source" | "impl" | "";

export const IMPL_GROUPS = ["Excluded", "Not started", "Under way", "Mostly done", "Done"] as const;

export function implGroupOf(row: SoaLedgerRow): (typeof IMPL_GROUPS)[number] {
  const progress = progressOf(row);
  if (progress === null) return "Excluded";
  if (notStartedAnywhere(row)) return "Not started";
  return progress < 0.6 ? "Under way" : progress < 1 ? "Mostly done" : "Done";
}

export type Group = { key: string; name: string; rows: SoaLedgerRow[] };

/**
 * The rows in groups, in the order the table shows them: by domain (the Control's category, in order of first
 * appearance, which is code order), by source (the base Control Library first, then each Framework's
 * Supplementary Controls by label) or by implementation (`IMPL_GROUPS`). Without grouping, one unnamed group.
 */
export function groupRows(rows: SoaLedgerRow[], groupBy: GroupBy): Group[] {
  if (!groupBy) return [{ key: "", name: "", rows }];
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const [key, name] =
      groupBy === "domain" ? [row.category, row.category || "No domain"] : groupBy === "source" ? [row.sourceKey, row.sourceLabel] : [implGroupOf(row), implGroupOf(row)];
    const group = groups.get(key) ?? { key, name, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  if (groupBy === "impl") list.sort((a, b) => IMPL_GROUPS.indexOf(a.name as (typeof IMPL_GROUPS)[number]) - IMPL_GROUPS.indexOf(b.name as (typeof IMPL_GROUPS)[number]));
  if (groupBy === "source") list.sort((a, b) => (a.key === "base" ? -1 : b.key === "base" ? 1 : a.name.localeCompare(b.name, "en", { numeric: true })));
  return list;
}

export type GroupFigures = { included: number; excluded: number; missing: number; progress: number | null };

/** A group's counts and its average implementation progress (over its included Controls; null with none). */
export function groupFigures(rows: SoaLedgerRow[]): GroupFigures {
  const included = rows.filter((row) => row.included);
  const progress = included.length === 0 ? null : included.reduce((sum, row) => sum + (progressOf(row) ?? 0), 0) / included.length;
  return { included: included.length, excluded: rows.length - included.length, missing: rows.filter((row) => row.justificationMissing).length, progress };
}

// CSV

/** The rows in view as a CSV, built in the browser: the server export's columns, in the order the table shows them. */
export const viewCsv = (rows: SoaLedgerRow[]) => statementOfApplicabilityCsv(rows);

export const viewCsvFilename = (date: Date) => csvFilename(["Statement-of-Applicability", "view"], date);

// Drawer

export const JUSTIFICATION_TEMPLATES = [
  { label: "Not in our scope", text: "No System or process in the ISMS scope uses this; see the scope statement (clause 4.3)." },
  { label: "Covered by a provider", text: "Implemented by our cloud provider; we rely on their attestation, reviewed under A.5.22." },
  { label: "Risk accepted", text: "The risk assessment found no risk this Control would treat; the Risk Owner accepted this on " },
  { label: "Outsourced", text: "Outsourced under contract ; the supplier’s assurance report is reviewed yearly." },
] as const;

/** "2 Fulfilled, 1 In Progress" for the counts, zero counts left out. */
export function describeCounts(counts: Record<ControlAssessmentStatus, number>): string {
  return ROLLUP_ORDER.filter((status) => counts[status] > 0)
    .map((status) => `${counts[status]} ${CONTROL_ASSESSMENT_STATUS_LABEL[status]}`)
    .join(", ");
}

/**
 * The Control to open after a justification was saved in the Missing justification view: the next row in
 * `order` that is still missing, wrapping round to the start; null when none is left (or only the saved one).
 */
export function nextMissingId(order: string[], rows: SoaLedgerRow[], savedId: string): string | null {
  const missing = new Set(rows.filter((row) => row.justificationMissing && row.controlId !== savedId).map((row) => row.controlId));
  const start = order.indexOf(savedId);
  for (let step = 1; step <= order.length; step += 1) {
    const id = order[(start + step + order.length) % order.length];
    if (missing.has(id)) return id;
  }
  return null;
}

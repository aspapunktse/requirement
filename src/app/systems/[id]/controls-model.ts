import type { ControlAssessmentStatus, UserRole } from "@prisma/client";
import { resolveEffectiveStatus, type EffectiveStatus } from "@/lib/effective-status";
import { controlIsDone, sourceKeyOf } from "./system-page-logic";
import type { SourceKey } from "./system-page-types";

/**
 * The Controls tab's model (design proposal A "Cockpit", issue #244): the rows `GET /api/systems/[id]/assessments`
 * sends, and the pure rules for filtering and grouping them. Client-safe: no server imports at runtime.
 */

export type { UserRole };
export type SelfAssessmentAnswer = "YES" | "NO" | "NA";

export type Control = {
  id: string;
  code: string;
  title: string;
  description: string;
  /** A free string ("A.5 Organizational", "6 Planning"): the Controls tab groups by it. */
  category: string;
  mandatory: boolean;
  question: string | null;
  /** Why the question matters, shown with it. */
  intent?: string | null;
  /** Example ways to satisfy the Control. */
  examples?: string[];
};

export type Assessment = {
  id: string;
  status: ControlAssessmentStatus;
  assessedById?: string | null;
  assessedBy?: { name: string } | null;
  /** ISO timestamp of the last person-set change. */
  assessedAt?: string | null;
  evidence: string | null;
  notes: string | null;
  selfAssessmentAnswer: SelfAssessmentAnswer | null;
} | null;

export type QueryMessage = {
  id: string;
  body: string;
  createdAt: string;
  /** The group's name or "Base review" when the message is posted as one; null when shown named (#201). */
  attributedTo: string | null;
  /** Absent when the server won't say who wrote it: the viewer may only see the group (#201). */
  author?: { id: string; name: string; role: UserRole };
};

export type AssessmentQuery = {
  id: string;
  resolved: boolean;
  createdAt: string;
  /** Who the resolution is attributed to, like a message's; absent or null when named or unresolved. */
  resolvedAttributedTo?: string | null;
  /** Absent when unresolved, or when the viewer may only see the group (#201). */
  resolvedBy?: { id: string; name: string };
  messages: QueryMessage[];
};

/**
 * `effective` is what the System is judged by (own status, or inherited from the Organization, #121, or from a
 * Provider it depends on, #124); null for a stale row, which no longer applies. The edit form still edits the
 * System's own `assessment`.
 */
export type AssessmentRow = {
  control: Control;
  assessment: Assessment;
  queries: AssessmentQuery[];
  effective: EffectiveStatus | null;
  /** The server's answer to "may this viewer raise and resolve Queries on this Control" (a Review Group member can in the group's remit, #201); absent: fall back to the role. */
  canManageQueries?: boolean;
};

/** A row as `GET /api/systems/[id]/assessments` sends it (and the reset route returns it). */
export type AssessmentRowApi = { control: Control; assessment: Assessment; effective?: EffectiveStatus; canManageQueries?: boolean };

/** A stale Assessment as the API sends it: the Assessment itself, with its Control and Queries. */
export type StaleAssessmentApi = NonNullable<Assessment> & { control: Control; queries: AssessmentQuery[]; canManageQueries?: boolean };

export function toAssessmentRow(row: AssessmentRowApi): AssessmentRow {
  return {
    ...row,
    queries: (row.assessment as (Assessment & { queries?: AssessmentQuery[] }))?.queries ?? [],
    effective: row.effective ?? null,
  };
}

export function toStaleRow(assessment: StaleAssessmentApi): AssessmentRow {
  return {
    control: assessment.control,
    assessment,
    queries: assessment.queries ?? [],
    effective: null,
    canManageQueries: assessment.canManageQueries,
  };
}

/**
 * The row after the System's own Assessment was saved: a saved Assessment is person-set, so it now decides
 * the effective status (it overrides what was inherited). Same rule as the server's, applied to the sources
 * the API sent.
 */
export function withSavedAssessment(row: AssessmentRow, assessment: NonNullable<Assessment>): AssessmentRow {
  return {
    ...row,
    assessment,
    effective: row.effective ? resolveEffectiveStatus({ status: assessment.status, personSet: true }, row.effective.sources) : null,
  };
}

/** The status the System is judged by: the effective one, else its own, else Not started. */
export function rowStatus(row: AssessmentRow): ControlAssessmentStatus {
  return row.effective?.status ?? row.assessment?.status ?? "NOT_STARTED";
}

/** Where the status comes from; a row without an effective status (a stale one) is the System's own. */
export function rowSourceKey(row: AssessmentRow): SourceKey {
  return row.effective ? sourceKeyOf(row.effective.source) : "system";
}

/** "Organization", the Provider's name, or "This System". */
export function rowSourceLabel(row: AssessmentRow): string {
  const source = row.effective?.source;
  if (source?.kind === "PROVIDER") return source.provider.name;
  const key = rowSourceKey(row);
  return key === "organization" ? "Organization" : "This System";
}

export const openQueryCount = (row: AssessmentRow) => row.queries.filter((query) => !query.resolved).length;

/** MANDATORY flag of a row: the Control is mandatory, this System assesses it itself, and it is Not started. */
export const showsMandatoryFlag = (row: AssessmentRow) => row.control.mandatory && rowSourceKey(row) === "system" && rowStatus(row) === "NOT_STARTED";

export const CONTROL_FILTERS = ["all", "todo", "progress", "done", "inherited"] as const;
export type ControlFilter = (typeof CONTROL_FILTERS)[number];
export const FILTER_LABEL: Record<ControlFilter, string> = {
  all: "All",
  todo: "To do",
  progress: "In progress",
  done: "Done",
  inherited: "Inherited",
};

/** Does the row pass the segment (All, To do, In progress, Done, Inherited) and the search over code and title? */
export function rowMatches(row: AssessmentRow, filter: ControlFilter, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q && !`${row.control.code} ${row.control.title}`.toLowerCase().includes(q)) return false;
  const status = rowStatus(row);
  switch (filter) {
    case "todo":
      return status === "NOT_STARTED";
    case "progress":
      return status === "IN_PROGRESS";
    case "done":
      return controlIsDone(status);
    case "inherited":
      return rowSourceKey(row) !== "system";
    case "all":
      return true;
  }
}

export type ControlGroup = { category: string; rows: AssessmentRow[] };

/** The rows grouped by their Control's category, in the order the categories first appear. */
export function groupByCategory(rows: AssessmentRow[]): ControlGroup[] {
  const groups = new Map<string, AssessmentRow[]>();
  for (const row of rows) {
    const group = groups.get(row.control.category);
    if (group) group.push(row);
    else groups.set(row.control.category, [row]);
  }
  return [...groups].map(([category, grouped]) => ({ category, rows: grouped }));
}

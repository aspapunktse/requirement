import type { ControlAssessmentStatus } from "@prisma/client";
import { orderCandidates } from "@/lib/comparison-score";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { EVALUATION_STAGE_LABEL } from "@/lib/evaluation-stages";
import type { EvaluationStage } from "@prisma/client";
import type { CandidateRow, ComparisonDetail, ComparisonListRow, ControlGroup } from "./comparison-types";

/**
 * The pure side of the Comparison pages (#373, design proposal B "Shortlist and differences" with the Framework separators of
 * C, the Mandatory filter of A and the Open and Closed sections of C): the list's tabs and sections, the Candidates' order,
 * the Control-by-Control table's filter and grouping. No React, so the components and the tests share it.
 */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------------------------------------------------
// The list

export type ListTab = "all" | "open" | "closed";

/** Rows matching the search (name, need, owner) and the tab. Under "all" both sections stay; the page splits them. */
export function filterList(rows: readonly ComparisonListRow[], tab: ListTab, query: string): ComparisonListRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (tab === "all" || (tab === "closed") === row.closed) &&
      (q === "" || `${row.name} ${row.need ?? ""} ${row.owner.name}`.toLowerCase().includes(q)),
  );
}

export function listCounts(rows: readonly ComparisonListRow[]) {
  const closed = rows.filter((row) => row.closed).length;
  return { all: rows.length, open: rows.length - closed, closed };
}

// ---------------------------------------------------------------------------------------------------------------------
// The Comparison page

/** Complete Candidates first, by score, as the server orders them (`orderCandidates`); re-applied so the page never depends on the response's order. */
export function orderedCandidates(candidates: readonly CandidateRow[]): CandidateRow[] {
  return orderCandidates(candidates.map((candidate) => ({ ...candidate, ...candidate.score }))).map((entry) => candidates.find((candidate) => candidate.systemId === entry.systemId)!);
}

/** "incomplete: 12 of 14 answered": shown when some first-round Controls are unanswered. */
export function incompleteText(candidate: CandidateRow): string | null {
  const { complete, firstRoundCount, answeredCount } = candidate.score;
  return !complete && firstRoundCount > 0 ? `incomplete: ${answeredCount} of ${firstRoundCount} answered` : null;
}

/** Why a score reads "—", or null when there is a score. */
export function noScoreReason(candidate: CandidateRow): string | null {
  if (candidate.score.score !== null) return null;
  return candidate.score.firstRoundCount === 0
    ? "No first-round Controls: nothing is marked first round for its Frameworks."
    : "Every first-round Control is Not Applicable, so there is nothing to score.";
}

export const DIFFERENCE_LABEL: Record<string, string> = {
  deploymentFacets: "Deployment Facets",
  sensitivityLevel: "Sensitivity Level",
  integrityImpactLevel: "Integrity Impact Level",
  availabilityImpactLevel: "Availability Impact Level",
  frameworkScope: "Framework Scope",
};

export const STATUS_LABEL: Record<ControlAssessmentStatus, string> = CONTROL_ASSESSMENT_STATUS_LABEL;

export function stageLabel(stage: string | null): string {
  return stage ? (EVALUATION_STAGE_LABEL[stage as EvaluationStage] ?? stage) : "Not staged";
}

export const IMPACT_LABEL: Record<string, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" };

// The Control-by-Control table

export type ControlFilter = "differ" | "mandatory" | "all";
export const CONTROL_FILTERS: { key: ControlFilter; label: string }[] = [
  { key: "differ", label: "Where they differ" },
  { key: "mandatory", label: "Mandatory" },
  { key: "all", label: "All" },
];

/** A Candidate's cell for a Control: its effective status, or null when the Control does not apply to it. */
export type Cell = ControlAssessmentStatus | null;

export type TableRow = { controlId: string; code: string; title: string; mandatory: boolean; cells: Cell[]; differs: boolean };
export type TableGroup = { key: string; name: string | null; rows: TableRow[] };

/** Every first-round Control of any Candidate, with one cell per Candidate (in the given order), grouped as the server grouped them. */
export function tableGroups(groups: readonly ControlGroup[], candidates: readonly CandidateRow[]): TableGroup[] {
  const statusOf = candidates.map((candidate) => new Map(candidate.score.controls.map((control) => [control.controlId, control.status])));
  return groups.map((group) => ({
    key: group.framework?.id ?? "none",
    name: group.framework?.name ?? null,
    rows: group.controls.map((control) => {
      const cells: Cell[] = statusOf.map((statuses) => statuses.get(control.controlId) ?? null);
      return { ...control, cells, differs: new Set(cells).size > 1 };
    }),
  }));
}

export function controlCounts(groups: readonly TableGroup[]) {
  const rows = groups.flatMap((group) => group.rows);
  return { differ: rows.filter((row) => row.differs).length, mandatory: rows.filter((row) => row.mandatory).length, all: rows.length };
}

/** The groups narrowed by the filter; a group with no row left is dropped. */
export function filterGroups(groups: readonly TableGroup[], filter: ControlFilter): TableGroup[] {
  const keep = (row: TableRow) => (filter === "all" ? true : filter === "mandatory" ? row.mandatory : row.differs);
  return groups.map((group) => ({ ...group, rows: group.rows.filter(keep) })).filter((group) => group.rows.length > 0);
}

/** The Candidates the Record outcome dialog offers as the chosen one: a Candidate rejected at a gate or closed as Not selected can't be chosen (it is listed, with the reason). */
export function chooseable(candidate: Pick<CandidateRow, "rejected"> & { notSelected?: boolean }): boolean {
  return !candidate.rejected && !candidate.notSelected;
}

/** The date of a recorded outcome, "16 Nov 2026". */
export const formatOutcomeDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** The Candidates' owner may remove their own System; the Comparison's owner or an Admin any (`canManage`). */
export function canRemoveCandidate(detail: Pick<ComparisonDetail, "canManage">, candidate: CandidateRow, userId: string): boolean {
  return detail.canManage || candidate.owner.id === userId;
}

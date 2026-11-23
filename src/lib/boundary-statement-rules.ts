import type { UserRole } from "@prisma/client";
import { normalizeExclusionJustification } from "@/lib/statement-of-applicability-rules";
import type { DerivedRequirementStatus } from "@/lib/requirement-status-rules";

export { normalizeExclusionJustification };

/**
 * The Statement of Applicability of one Compliance Boundary (#420, ADR 0016, CONTEXT.md "Statement of Applicability"). Pure and
 * Prisma-free apart from types, so client components can import it; the loader is `boundary-statement.ts`.
 *
 * - One section per Framework of the Boundary; the rows are that Framework's Requirements, not Controls.
 * - A Requirement is **included** when it applies to at least one counted System of the Boundary (one with an ATO or Onboarded)
 *   or is met by Organizational Controls. Inclusion is derived and can't be overridden.
 * - Its status is the **worst** across the counted Systems it applies to (Met only when Met on every one), shown as
 *   "Met on x of y Systems". With no counted System it applies to, the Organization's own status is shown.
 * - The exclusion justification is stored per (Boundary, Requirement); it only explains why a Requirement is not included and never
 *   changes a status. Like the old per-Control rule (#150), one can only be written while the Requirement is excluded, or cleared.
 */

/** A status in the statement: Not Applicable is a System the Requirement doesn't apply to, never a row's status. */
export type StatementStatus = Exclude<DerivedRequirementStatus, "NOT_APPLICABLE">;

/** The status of one counted System for one Requirement (Not Applicable included, for the drill-down). */
export type StatementSystemStatus = [systemIndex: number, status: DerivedRequirementStatus];

export type BoundaryStatementRow = {
  requirementId: string;
  code: string;
  section: string;
  title: string;
  included: boolean;
  /** The Requirement is covered by Organizational Controls: it is included even with no counted System. */
  organizationStatus: StatementStatus | null;
  /** No Per-System or Both Control maps to the Requirement: only the Organization's implementation decides. */
  organizationOnly: boolean;
  /** The worst status across the counted Systems it applies to; the Organization's when none does; null when excluded. */
  worstStatus: StatementStatus | null;
  /** Counted Systems the Requirement applies to and is Met on ("Met on x of y"). */
  metCount: number;
  appliesToCount: number;
  /** The status in each counted System the acting user may see, by index into `BoundaryStatement.systems`. */
  systemStatuses: StatementSystemStatus[];
  /** Counted Systems whose status is not listed, because the acting user may not see the System (counted in x of y, never named). */
  hiddenSystemCount: number;
  /** The authored text, only while the Requirement is excluded (a kept text is not presented as the reason of an included one). */
  justification: string | null;
  justificationMissing: boolean;
};

export type BoundaryStatementSection = {
  framework: { id: string; name: string; version: string; isBase: boolean };
  rows: BoundaryStatementRow[];
  /** Pooled over the counted Systems: Requirement x System pairs Met, and applicable (not Not Applicable). */
  met: number;
  applicable: number;
  percentage: number | null;
};

export type BoundaryStatement = {
  boundary: { id: string; name: string; retired: boolean; ownerName: string | null };
  /** The acting user may write justifications: the Boundary Owner, a Compliance Manager or an Admin, on an active Boundary. */
  canEdit: boolean;
  /** Counted Systems, every member's name is visible to every role. */
  countedSystems: { id: string; name: string }[];
  notYetOperating: { id: string; name: string }[];
  closed: { id: string; name: string; status: string }[];
  /** The counted Systems the acting user may see, by name: `systemStatuses` index into this list. */
  systems: { id: string; name: string }[];
  /** Empty for a retired Boundary, which has no statement (#424). */
  sections: BoundaryStatementSection[];
};

export const STATEMENT_STATUS_LABEL: Record<StatementStatus, string> = { MET: "Met", PARTIALLY_MET: "Partially met", NOT_MET: "Not met" };

const RANK: Record<StatementStatus, number> = { MET: 0, PARTIALLY_MET: 1, NOT_MET: 2 };

/** The worst of the statuses: Not Met over Partially Met over Met; null for none. */
export function worstStatus(statuses: StatementStatus[]): StatementStatus | null {
  return statuses.reduce<StatementStatus | null>((worst, status) => (worst === null || RANK[status] > RANK[worst] ? status : worst), null);
}

/**
 * One Requirement's row from its derived status on each counted System and the Organization's own status. `systemStatuses` has an
 * entry per counted System (any status, Not Applicable included), in the order of `counted`; `visible` says which of them the
 * acting user may see. `storedJustification` is the text stored for (Boundary, Requirement).
 */
export function deriveStatementRow(input: {
  requirement: { id: string; code: string; section: string; title: string };
  perSystem: DerivedRequirementStatus[];
  visible: (number | null)[];
  organizationStatus: StatementStatus | null;
  organizationOnly: boolean;
  storedJustification: string | null;
}): BoundaryStatementRow {
  const { perSystem, organizationStatus } = input;
  const applicable = perSystem.filter((status): status is StatementStatus => status !== "NOT_APPLICABLE");
  const included = applicable.length > 0 || organizationStatus !== null;
  const text = normalizeExclusionJustification(input.storedJustification);
  const systemStatuses: StatementSystemStatus[] = [];
  perSystem.forEach((status, index) => {
    const visibleIndex = input.visible[index];
    if (visibleIndex !== null && visibleIndex !== undefined) systemStatuses.push([visibleIndex, status]);
  });
  return {
    requirementId: input.requirement.id,
    code: input.requirement.code,
    section: input.requirement.section,
    title: input.requirement.title,
    included,
    organizationStatus,
    organizationOnly: input.organizationOnly,
    worstStatus: !included ? null : (worstStatus(applicable) ?? organizationStatus),
    metCount: applicable.filter((status) => status === "MET").length,
    appliesToCount: applicable.length,
    systemStatuses,
    hiddenSystemCount: perSystem.length - systemStatuses.length,
    justification: included ? null : text,
    justificationMissing: !included && text === null,
  };
}

export type StatementFilter = "ALL" | "INCLUDED" | "EXCLUDED" | "NOT_MET" | "MISSING";

export function matchesStatementFilter(row: Pick<BoundaryStatementRow, "included" | "worstStatus" | "justificationMissing">, filter: StatementFilter): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "INCLUDED":
      return row.included;
    case "EXCLUDED":
      return !row.included;
    case "NOT_MET":
      return row.included && row.worstStatus === "NOT_MET";
    case "MISSING":
      return row.justificationMissing;
  }
}

/** The counts the filter chips show, over every Framework's rows. */
export function countStatementRows(rows: Pick<BoundaryStatementRow, "included" | "worstStatus" | "justificationMissing">[]) {
  const count = (filter: StatementFilter) => rows.filter((row) => matchesStatementFilter(row, filter)).length;
  return { all: count("ALL"), included: count("INCLUDED"), excluded: count("EXCLUDED"), notMet: count("NOT_MET"), missing: count("MISSING") };
}

/** "Met on 3 of 5 Systems": the Systems the Requirement applies to, and how many of them meet it. */
export function describeMetOn(row: Pick<BoundaryStatementRow, "metCount" | "appliesToCount" | "organizationOnly">): string {
  if (row.appliesToCount === 0) return "Organization only";
  const systems = `${row.appliesToCount} ${row.appliesToCount === 1 ? "System" : "Systems"}`;
  return row.organizationOnly ? `Organization: met on ${row.metCount} of ${systems}` : `Met on ${row.metCount} of ${systems}`;
}

/** The longest justification the route accepts, as for the old per-Control one. */
export const JUSTIFICATION_MAX_LENGTH = 2000;

export const JUSTIFICATION_FORBIDDEN_MESSAGE = "Only the Boundary Owner, a Compliance Manager or an Admin can write exclusion justifications.";
export const REQUIREMENT_NOT_FOUND_MESSAGE = "Requirement not found in this Compliance Boundary's Frameworks.";
export const INCLUDED_REFUSAL = "This Requirement is included in the statement, so it needs no exclusion justification; one can only be written while it is excluded.";

/** Who writes exclusion justifications: the Boundary's owner, a Compliance Manager or an Admin (CONTEXT.md "Boundary Owner"). */
export function canWriteJustifications(user: { id: string; role: UserRole }, boundary: { boundaryOwnerId: string | null }): boolean {
  return user.role === "ADMIN" || user.role === "COMPLIANCE_MANAGER" || (boundary.boundaryOwnerId !== null && boundary.boundaryOwnerId === user.id);
}

/** The Change Event wording of a changed justification, with both texts cut short like the old per-Control one. */
export function describeJustificationChange(boundaryName: string, framework: string, requirementCode: string, from: string | null, to: string | null): string {
  const quoted = (text: string | null) => (text === null ? "none" : `"${text.length > 200 ? `${text.slice(0, 200)}…` : text}"`);
  return `Statement of Applicability exclusion justification changed: Compliance Boundary "${boundaryName}", ${framework} ${requirementCode} (${quoted(from)} → ${quoted(to)})`;
}

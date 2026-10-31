import type { ControlAssessmentStatus } from "@prisma/client";
import type { StatementOfApplicabilityRow } from "@/lib/statement-of-applicability-rules";

/**
 * What the Statement of Applicability page (design proposal A "Statement Ledger", issue #272) holds on the
 * client. Plain data, no Prisma values, so it crosses the server/client line as props.
 */

/** The Published Framework's Requirement codes a Control maps to, for the chips and the Framework filter. */
export type SoaRequirementGroup = {
  /** "ISO/IEC 27001:2022" */
  framework: string;
  /** Numeric-aware order, each once. */
  codes: string[];
};

/** One System's effective status: the index into `SoaView.systems`, then the status. */
export type SoaSystemStatus = [systemIndex: number, status: ControlAssessmentStatus];

/** A Statement row (the same row the server export is built from) plus what the ledger shows around it. */
export type SoaLedgerRow = StatementOfApplicabilityRow & {
  description: string;
  /** The Control's category: "Group by Domain". */
  category: string;
  /** "Group by Source": the base Control Library, or the Framework a Supplementary Control was authored for. */
  sourceKey: string;
  sourceLabel: string;
  /** The Control Owner's name; null when unassigned. */
  ownerName: string | null;
  /** The Published Frameworks' Requirements the Control maps to; empty for an excluded Control. */
  requirements: SoaRequirementGroup[];
  /**
   * The effective status in each System the Control applies to AND the acting user may see. The rollup counts
   * (`systemRollup`) cover all Systems; this list never holds a System the user can't see.
   */
  systemStatuses: SoaSystemStatus[];
  /** How many of the Systems the Control applies to the acting user may not see: `systemRollup.total` minus the list. */
  hiddenSystemCount: number;
};

export type SoaView = {
  userId: string;
  role: string;
  roleLabel: string;
  /** A Compliance Manager or an Admin: may write exclusion justifications (the route enforces the same). */
  canEdit: boolean;
  rows: SoaLedgerRow[];
  /** The Systems the acting user may see (id and name), referred to by index from `SoaLedgerRow.systemStatuses`. */
  systems: { id: string; name: string }[];
};

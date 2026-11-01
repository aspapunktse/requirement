import type { ControlAssessmentStatus } from "@prisma/client";

/**
 * What the Organization Control Implementations page (design proposal A "Implementation register", issue #284)
 * holds on the client. Plain data, no Prisma values, so it crosses the server/client line as props.
 */

/** One entry of a Control's history: the status moved from one value to another. Newest first in `OrgControlRow.history`. */
export type OrgHistoryEntry = {
  /** ISO timestamp of the Change Event (or of the save, for an entry the page added itself). */
  at: string;
  /** The editor's name; "System" for a change the system made (a Check-up's Nonconformity set it back). */
  by: string;
  from: ControlAssessmentStatus;
  to: ControlAssessmentStatus;
};

export type OrgControlRow = {
  id: string;
  code: string;
  title: string;
  applicability: "ORGANIZATIONAL" | "BOTH";
  /** The Control's category, e.g. "A.5 Organizational controls" or "4 Context of the organization". */
  category: string;
  /** The Control's own description ("The Control"). */
  summary: string;
  ownerId: string | null;
  ownerName: string | null;
  /** The Organization Control Implementation; a Control with no row reads as Not Started with nothing else. */
  status: ControlAssessmentStatus;
  description: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  /** May the acting user edit it (the Control Owner, a Compliance Manager or an Admin); the route enforces the same. */
  canEdit: boolean;
  /** For a Both Control: how many Systems (of any status) it applies to. 0 for an Organizational Control. */
  systemCount: number;
  /** The Published Frameworks its mappings reach, by label. */
  frameworks: string[];
  /** The origin Framework of a Supplementary Control (tab key and label); null for a base Control. */
  origin: { key: string; label: string } | null;
  history: OrgHistoryEntry[];
};

export type OrgView = {
  userId: string;
  userName: string;
  role: string;
  roleLabel: string;
  rows: OrgControlRow[];
};

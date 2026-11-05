import type { ControlAssessmentStatus } from "@prisma/client";
import type { LibraryRow } from "../library-types";

/**
 * What the Control page (design proposal B "Side rail and tabs", issue #314) holds on the client. Plain data, no
 * Prisma values, so it crosses the server/client line as props.
 */

/** The Organization Control Implementation of an Organizational or Both Control, as the register shows it. */
export type PageOrganization = {
  status: ControlAssessmentStatus;
  /** How the Organization implements the Control; null while nobody has described it. */
  description: string | null;
  /** The day it was last changed ("5 Nov 2026"), or null while no implementation is recorded (it reads as Not Started). */
  updatedOn: string | null;
  updatedByName: string | null;
};

/** One System the acting user can see and the Control applies to, with the status the System page shows for it. */
export type PageSystem = {
  id: string;
  name: string;
  ownerName: string;
  businessUnits: string[];
  /** The effective status (`resolveEffectiveStatus`), the same one the System page's Control list shows. */
  status: ControlAssessmentStatus;
  /** "System-specific", "Inherited from Organization", "Inherited from Provider X: Full": `effectiveSourceLabel`. */
  sourceLabel: string;
  /** One line per source, with why one gives no credit (`effectiveSourceDetails`); empty for a Control with no source. */
  sourceDetails: string[];
  /** The override or waiting note of the System page (`effectiveNote`), or null. */
  note: string | null;
};

export type PageSystems = {
  /** Every System the Control applies to, whether or not the acting user can see it. */
  total: number;
  /** All of them by effective status. */
  counts: Record<ControlAssessmentStatus, number>;
  /** Only the Systems the acting user can see, by name. */
  list: PageSystem[];
};

export type ControlPageView = {
  userId: string;
  userName: string;
  /** A Compliance Manager or an Admin: Edit shows. */
  canEdit: boolean;
  /** The Control as the library row shows it (Draft Frameworks left out unless the role sees them). */
  control: LibraryRow;
  /** Organizational and Both Controls only. */
  organization: PageOrganization | null;
  /** Per-System and Both Controls only. */
  systems: PageSystems | null;
};

import type { UserRole } from "@prisma/client";
import type { CoverageState } from "@/lib/coverage-state";

/**
 * The serialisable shapes the Framework coverage page passes from the server (`coverage-data.ts`) to its client
 * component. Type-only: nothing here may import server code at runtime.
 */

export type MappedControl = {
  /** The Control Mapping's id (what the PATCH and DELETE routes take). */
  id: string;
  controlId: string;
  code: string;
  title: string;
  coverage: "FULL" | "PARTIAL";
  rationale: string | null;
  /** A Supplementary Control: one a Framework's authors added to close a gap (it has an origin Framework). */
  supplementary: boolean;
};

export type CoverageRow = {
  id: string;
  code: string;
  section: string;
  title: string;
  /** The Requirement text; the default description of a Supplementary Control created for it. */
  text: string;
  state: CoverageState;
  justification: string | null;
  acceptedBy: string | null;
  /** ISO timestamp. */
  acceptedAt: string | null;
  mappings: MappedControl[];
};

/** A Control of the Control Library, for "Map a Control" and the suggestions. Only sent to those who can curate. */
export type LibraryControl = {
  id: string;
  code: string;
  title: string;
  /** A Supplementary Control (it has an origin Framework): never suggested, but may be picked by hand. */
  supplementary: boolean;
};

export type SwitcherFramework = { id: string; label: string; status: "DRAFT" | "PUBLISHED" };

export type CoverageFramework = {
  id: string;
  name: string;
  version: string;
  status: "DRAFT" | "PUBLISHED";
  isBase: boolean;
  /** Only Strict compliance counts Fulfilled: Waived and Not Applicable get no credit. */
  strict: boolean;
  reviewGroup: string | null;
  /** Systems the acting user can see that have the Framework in scope; null for a Draft (it reaches no System). */
  systems: number | null;
};

export type CoverageView = {
  userId: string;
  role: UserRole;
  roleLabel: string;
  /** Compliance Manager or Admin: maps, creates Supplementary Controls and accepts gaps. */
  canCurate: boolean;
  framework: CoverageFramework;
  /** The Frameworks the acting user can see, for the switcher. */
  frameworks: SwitcherFramework[];
  requirements: CoverageRow[];
  /** The Control Library; empty unless `canCurate`. */
  controls: LibraryControl[];
  /** The section `?section=` asked for, if any (the client checks it exists). */
  initialSection: string | null;
};

/** The ring legend and the stat cards, which are also the filters. */
export type FilterKey = "all" | "COVERED" | "GAP" | "PARTIAL" | "NONE" | "ACCEPTED_GAP";

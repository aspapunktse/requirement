import type { UserRole } from "@prisma/client";
import type { LineagePath } from "@/lib/framework-lineage";

/**
 * The serialisable shapes the Framework list passes from the server (`frameworks-data.ts`) to its client
 * component. Type-only apart from the constant tables: nothing here may import server code at runtime.
 */

/** The stat cards, which are also the views. "drafts" exists only for roles that see Drafts. */
export type ViewKey = "all" | "drafts" | "gaps" | "resolved" | "empty";
export const VIEW_KEYS: ViewKey[] = ["all", "drafts", "gaps", "resolved", "empty"];

export type GroupKey = "family" | "status" | "none";
export type SortKey = "default" | "name" | "resolved" | "gaps" | "systems" | "updated";

export type CatalogRow = {
  id: string;
  name: string;
  version: string;
  description: string | null;
  isBase: boolean;
  /** Only Strict compliance counts Fulfilled; Waived and Not Applicable get no credit. */
  strict: boolean;
  status: "DRAFT" | "PUBLISHED";
  /** The family group derived from the name (`frameworkFamily`): "Base Framework", the family, or "Other Frameworks". */
  group: string;
  family: string | null;
  level: number | null;
  requirements: number;
  covered: number;
  accepted: number;
  /** Open Coverage Gaps. */
  gaps: number;
  /** Of the open gaps, those whose Requirement has Control Mappings, all Partial. */
  partialOnly: number;
  /** Systems that can see the Framework in their Framework Scope and that the acting user can see; null for a Draft. */
  systems: number | null;
  reviewGroup: string | null;
  /** Supplementary Controls authored for the Framework; counted for a Draft only (the Publish dialog). */
  supplementary: number;
  /** ISO timestamp of the latest change (derived, see `latestChange`). */
  updatedAt: string;
  /** The version lineage as built for this user: a hidden Draft never appears. */
  lineage: LineagePath[];
};

export type CatalogView = {
  userId: string;
  role: UserRole;
  roleLabel: string;
  /** Compliance Manager or Admin: sees Drafts, publishes them and creates Frameworks. */
  canCurate: boolean;
  rows: CatalogRow[];
};

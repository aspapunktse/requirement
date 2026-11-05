import type { ControlApplicability, ControlAssessmentStatus, ImpactLevel } from "@prisma/client";

/**
 * What the Control Library workbench (design proposal A "Workbench", issue #313) holds on the client.
 * Plain data, no Prisma values, so it crosses the server/client line as props.
 */

/** One Control Mapping on a row: the Requirement it satisfies and how far. */
export type LibraryMapping = {
  id: string;
  coverage: "FULL" | "PARTIAL";
  requirementCode: string;
  requirementTitle: string;
  framework: { id: string; label: string };
  /** True for a mapping into a Draft Framework; only a user who can see Drafts ever gets one. */
  draft: boolean;
};

/**
 * Where a Control comes from. `key` groups and filters: "base", "sup" for a Supplementary Control whose origin
 * the viewer can't see (a Draft Framework), or "fw:<id>" for a visible origin. `label` is what the page shows.
 */
export type LibrarySource = {
  key: string;
  label: string;
  kind: "base" | "supplementary";
  /** The origin is a Draft Framework (only ever true for a viewer who can see Drafts). */
  draft: boolean;
};

export type LibraryRow = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  mandatory: boolean;
  applicability: ControlApplicability;
  question: string | null;
  intent: string | null;
  examples: string[];
  deploymentFacets: string[];
  minSensitivityLevel: number | null;
  /** The label of the minimum Sensitivity Level; null when there is none. */
  minSensitivityLabel: string | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
  ownerId: string | null;
  ownerName: string | null;
  source: LibrarySource;
  /** The Organization Control Implementation's status; null for a Per-System Control, which has none. A missing row reads as Not Started. */
  orgStatus: ControlAssessmentStatus | null;
  /** For a Per-System or Both Control: how many Systems it applies to. 0 for an Organizational Control. */
  systemCount: number;
  /** The Control Mappings the viewer can see (no Draft Framework unless the role sees Drafts). */
  mappings: LibraryMapping[];
};

export type LibraryView = {
  userId: string;
  userName: string;
  role: string;
  roleLabel: string;
  /** A Compliance Manager or an Admin: the edit actions (New Control, Edit, Assign owner) show. */
  canEdit: boolean;
  /** The Users who may be made Control Owner, for Assign owner; empty unless `canEdit`. */
  owners: { id: string; name: string }[];
  rows: LibraryRow[];
};

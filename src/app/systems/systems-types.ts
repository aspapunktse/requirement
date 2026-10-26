import type { ImpactLevel, OnboardingStatus, UserRole } from "@prisma/client";

/**
 * The serialisable shapes the Systems list passes from the server (`systems-data.ts`) to its client
 * component. Type-only apart from the constant tables: nothing here may import server code at runtime.
 */

/** The stat cards, which are also the saved views. "mine" is the acting role's own view. */
export type ViewKey = "all" | "mine" | "attention" | "unclassified" | "providers";
export const VIEW_KEYS: ViewKey[] = ["all", "mine", "attention", "unclassified", "providers"];

/** Onboarding Statuses in lifecycle order (the tabs, the ring and the Status sort). */
export const STATUS_ORDER: OnboardingStatus[] = ["DRAFT", "IN_REVIEW", "APPROVED", "ONBOARDED", "REJECTED"];
export const STATUS_LABEL: Record<OnboardingStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In Review",
  APPROVED: "Approved",
  ONBOARDED: "Onboarded",
  REJECTED: "Rejected",
};
export const isStatus = (value: string): value is OnboardingStatus => (STATUS_ORDER as string[]).includes(value);

export const IMPACT_ORDER: ImpactLevel[] = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
export const IMPACT_LABEL: Record<ImpactLevel, string> = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" };
/** 1 (Low) to 4 (Critical): the height of a C · I · A bar; 0 stands for not classified. */
export const IMPACT_RANK: Record<ImpactLevel, number> = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };
/** The "highest Impact Level" filter's choices; NONE is a System with no axis classified. */
export type HighestImpact = ImpactLevel | "NONE";
export const HIGHEST_IMPACT_ORDER: HighestImpact[] = ["NONE", ...IMPACT_ORDER];
export const HIGHEST_IMPACT_LABEL: Record<HighestImpact, string> = { NONE: "Not classified", ...IMPACT_LABEL };

export type SystemRow = {
  id: string;
  name: string;
  /** Null for a System built in-house. */
  vendor: string | null;
  isProvider: boolean;
  status: OnboardingStatus;
  ownerId: string;
  ownerName: string;
  /** Deployment Facets, by name. */
  facets: { id: string; name: string }[];
  businessUnits: { id: string; name: string }[];
  /** The Impact Level on each CIA axis; null means not classified. */
  confidentiality: ImpactLevel | null;
  integrity: ImpactLevel | null;
  availability: ImpactLevel | null;
  /** Open Assessment Queries the acting user can act on. */
  openQuestions: number;
  /** Requirements Met and applicable against the base Framework, as the System page counts them; null when not measured. */
  met: number | null;
  applicable: number | null;
  /** ISO timestamp of the last change. */
  updatedAt: string;
  /** In the acting role's own view ("Owned by me", "Awaiting review", …). */
  inRoleView: boolean;
  needsAttention: boolean;
};

export type SystemsView = {
  userId: string;
  userName: string;
  role: UserRole;
  roleLabel: string;
  canCreate: boolean;
  /** When the figures were read (ISO); "Updated" is measured from it so the server and the browser agree. */
  now: string;
  rows: SystemRow[];
  /** The label of the acting role's own view, and whether it reads as "something to do". */
  roleView: { label: string; warn: boolean };
  /** Oldest to newest, ending at today's value; a view without at least two points draws no line. */
  trends: Partial<Record<ViewKey, number[]>>;
  /** The base Framework the fulfilment figures are against, e.g. "ISO/IEC 27001:2022"; null when there is none. */
  baseFramework: string | null;
};

/** Everything the URL carries, parsed (see `systems-state.ts`). */
export type SortKey = "name" | "status" | "owner" | "cia" | "unit" | "prog" | "upd";
export type GroupKey = "" | "owner" | "unit" | "facet";

export type RegisterState = {
  view: ViewKey;
  status: OnboardingStatus | "";
  q: string;
  owners: string[];
  units: string[];
  facets: string[];
  impact: HighestImpact[];
  sort: SortKey;
  /** 1 ascending, -1 descending. */
  dir: 1 | -1;
  group: GroupKey;
  page: number;
  per: number;
};

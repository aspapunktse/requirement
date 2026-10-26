import type { ControlAssessmentStatus, ImpactLevel, OnboardingStatus, RiskSeverity, UserRole } from "@prisma/client";

/**
 * The serialisable shapes the System page passes from the server (`system-page-data.ts`) to its client
 * component (design proposal A "Cockpit", issue #243). Type-only apart from the constant tables: nothing
 * here may import server code at runtime.
 */

/** The tabs, in order. The key is also the URL hash (`#controls`). */
export const TAB_KEYS = ["overview", "controls", "requirements", "risks", "providers", "profile", "activity"] as const;
export type TabKey = (typeof TAB_KEYS)[number];
export const TAB_LABEL: Record<TabKey, string> = {
  overview: "Overview",
  controls: "Controls",
  requirements: "Requirements",
  risks: "Risks",
  providers: "Providers",
  profile: "Profile",
  activity: "Approval and activity",
};

/** Where a Control's effective status comes from (the "Where the status comes from" bars). */
export const SOURCE_KEYS = ["organization", "provider-full", "provider-shared", "system"] as const;
export type SourceKey = (typeof SOURCE_KEYS)[number];
export const SOURCE_LABEL: Record<SourceKey, string> = {
  organization: "Organization",
  "provider-full": "Provider, full",
  "provider-shared": "Provider, shared",
  system: "This System",
};

/** The statuses of the stacked bar, in the order they are drawn. */
export const CONTROL_STATUS_ORDER: ControlAssessmentStatus[] = ["FULFILLED", "WAIVED", "IN_PROGRESS", "NOT_STARTED", "NOT_APPLICABLE"];

/** An open Review Step the acting user may decide right now. */
export type DecisionStep = { reviewGroupId: string | null; name: string };

/** The one action that comes next for the acting user (decision 2a on #243). */
export type NextStep =
  | { kind: "submit" }
  | { kind: "decide"; steps: DecisionStep[] }
  | { kind: "onboard" }
  | { kind: "none" };

export type FrameworkSummary = {
  id: string;
  /** "ISO/IEC 27001:2022". */
  label: string;
  isBase: boolean;
  met: number;
  partial: number;
  notMet: number;
  notApplicable: number;
  /** Requirements that count: every status except Not Applicable. */
  applicable: number;
};

export type AttentionItem = {
  id: string;
  kind: "query" | "control" | "risk";
  title: string;
  note: string;
  tone: "danger" | "warn";
  /** The tab its Open button goes to. */
  tab: TabKey;
};

export type ActivityItem = {
  id: string;
  /** "You", a person, the step that decided, or "The system". */
  who: string;
  what: string;
  detail: string;
  tone: "ok" | "warn" | "danger" | "accent";
  /** ISO timestamp. */
  at: string;
};

export type SystemPageView = {
  userId: string;
  userName: string;
  role: UserRole;
  /** When the figures were read (ISO), so the server and the browser agree on "x days ago". */
  now: string;
  system: {
    id: string;
    name: string;
    vendor: string | null;
    description: string | null;
    status: OnboardingStatus;
    isProvider: boolean;
    ownerId: string;
    ownerName: string;
    facets: { id: string; name: string }[];
    confidentiality: ImpactLevel | null;
    integrity: ImpactLevel | null;
    availability: ImpactLevel | null;
    onboardedAt: string | null;
  };
  /** The lifecycle note under the stepper (see `lifecycleNote`). */
  note: string;
  nextStep: NextStep;
  /** May the acting user change the System's owner (the ⋯ menu)? */
  canChangeOwner: boolean;
  headline: {
    /** The base Framework as the Systems list names it; null when there is none in scope. */
    baseFramework: string | null;
    met: number;
    applicable: number;
    controlsDone: number;
    controlsTotal: number;
    openRisks: number;
  };
  frameworks: FrameworkSummary[];
  controls: {
    total: number;
    done: number;
    byStatus: Record<ControlAssessmentStatus, number>;
    bySource: Record<SourceKey, number>;
  };
  /** Every item, most pressing first; the tile shows the first six. */
  attention: AttentionItem[];
  risks: {
    /** Open Risks, `grid[severity][likelihood]`, both indexed by `RISK_LEVELS` (Low first). */
    grid: number[][];
    open: number;
    mitigated: number;
    accepted: number;
  };
  classification: {
    facets: string[];
    businessUnits: string[];
    frameworkScope: string[];
  };
  activity: ActivityItem[];
  counts: { controls: number; requirements: number; openRisks: number; providers: number };
  /** Every Control applicable to the System, for the Ctrl+K palette. */
  controlList: { id: string; code: string; title: string }[];
};

export const RISK_LEVELS: RiskSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

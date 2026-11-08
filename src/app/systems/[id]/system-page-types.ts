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

/** Fill colour of each Control status, in the stacked bars and the legend. */
export const STATUS_COLOR: Record<ControlAssessmentStatus, string> = {
  FULFILLED: "var(--rg-success)",
  WAIVED: "var(--rg-accent)",
  IN_PROGRESS: "var(--rg-gold)",
  NOT_STARTED: "var(--rg-line)",
  NOT_APPLICABLE: "var(--rg-muted)",
};
/** Sentence-case status words of the System page (the Overview, the Controls tab). */
export const STATUS_TEXT: Record<ControlAssessmentStatus, string> = {
  FULFILLED: "Fulfilled",
  WAIVED: "Waived",
  IN_PROGRESS: "In progress",
  NOT_STARTED: "Not started",
  NOT_APPLICABLE: "Not applicable",
};
export const SOURCE_COLOR: Record<SourceKey, string> = {
  organization: "var(--rg-info)",
  "provider-full": "var(--rg-accent)",
  "provider-shared": "var(--rg-gold)",
  system: "var(--rg-ink)",
};

/** An open Review Step the acting user may decide right now. */
export type DecisionStep = { reviewGroupId: string | null; name: string };

/** The one action that comes next for the acting user (decision 2a on #243). */
export type NextStep =
  /** `needsSensitivityLevel`: the System has no Sensitivity Level, which the submit route refuses (#290); absent otherwise. `belowInformationTypes`: its level is below its Information Types, which it also refuses (ADR 0012). */
  | { kind: "submit"; blockedBy: number; needsSensitivityLevel?: true; belowInformationTypes?: true }
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
  /** The Control a query or control item is about: its Open button opens that Control's drawer (`#controls/<code>`). */
  controlCode?: string;
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

/** An entry of the Approval and activity tab's timeline: `who` is null for the "Created" entry of a System older than `SYSTEM_CREATED`. */
export type TimelineItem = Omit<ActivityItem, "who"> & { who: string | null };

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
    /** The Business System Owner (#321); null when none is set. */
    businessSystemOwnerId: string | null;
    businessSystemOwnerName: string | null;
    facets: { id: string; name: string }[];
    /** The Sensitivity Level (1 to 5) and its label; null when not set. */
    sensitivityLevel: number | null;
    sensitivityLabel: string | null;
    /** The Information Types the System declares, with their current levels (ADR 0012). */
    informationTypes: { id: string; name: string; sensitivityLevel: number }[];
    /** The highest level among them; null with no types. The Sensitivity Level can't be set below it. */
    informationTypeFloor: number | null;
    /** The level is declared and below the floor: flagged on the Profile tab, and the submit route refuses. */
    belowInformationTypes: boolean;
    /**
     * The Frameworks its Information Types suggest that are not in its Framework Scope (ADR 0013), open ones first
     * by Framework name: `open` still to decide, `left-out` declined by the owner. `name` is the Framework's name
     * without its version, for a sentence.
     */
    suggestedFrameworks: { frameworkId: string; label: string; name: string; types: string[]; state: "open" | "left-out" }[];
    /** At least one suggestion is open: flagged for the owner on the System page and in the Systems list. It never blocks a submit. */
    hasSuggestedFrameworksToReview: boolean;
    integrity: ImpactLevel | null;
    availability: ImpactLevel | null;
    /** ISO timestamp. */
    createdAt: string;
    onboardedAt: string | null;
  };
  /** The lifecycle note under the stepper (see `lifecycleNote`). */
  note: string;
  nextStep: NextStep;
  /** May the acting user change the System's owner (the ⋯ menu)? */
  canChangeOwner: boolean;
  /** May the acting user set, change or clear the System's Business System Owner (#321)? The owner or an Admin. */
  canChangeBusinessSystemOwner: boolean;
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
    /** The Controls whose status each Provider (by id) decides: `provider-full` plus `provider-shared`, split per Provider. */
    byProvider: Record<string, number>;
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
  /** Every Change Event on the System, newest first, for the Approval and activity tab. */
  timeline: TimelineItem[];
  counts: { controls: number; requirements: number; openRisks: number; providers: number };
  /** Every Control applicable to the System, for the Ctrl+K palette. */
  controlList: { id: string; code: string; title: string }[];
};

export const RISK_LEVELS: RiskSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

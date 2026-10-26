import type { ControlAssessmentStatus, OnboardingStatus, RiskSeverity, RiskStatus } from "@prisma/client";
import type { EffectiveSource } from "@/lib/effective-status";
import {
  RISK_LEVELS,
  TAB_KEYS,
  type AttentionItem,
  type DecisionStep,
  type NextStep,
  type SourceKey,
  type TabKey,
} from "./system-page-types";

/**
 * The rules behind the System page (design proposal A "Cockpit", issue #243), pure so the server loader
 * and the client component share them and tests can run every case.
 */

/** The tab a URL hash names (`#controls`); anything else is the Overview. */
export function tabFromHash(hash: string): TabKey {
  const key = hash.replace(/^#/, "");
  return (TAB_KEYS as readonly string[]).includes(key) ? (key as TabKey) : "overview";
}

/** Done means Fulfilled, Waived or Not applicable: nothing is left to do on the Control. */
export function controlIsDone(status: ControlAssessmentStatus): boolean {
  return status === "FULFILLED" || status === "WAIVED" || status === "NOT_APPLICABLE";
}

/** Where a Control's effective status comes from, for the "Where the status comes from" bars. */
export function sourceKeyOf(source: EffectiveSource): SourceKey {
  switch (source.kind) {
    case "SYSTEM":
      return "system";
    case "ORGANIZATION":
    case "ORGANIZATION_DIRECT":
      return "organization";
    case "PROVIDER":
      return source.type === "SHARED" ? "provider-shared" : "provider-full";
  }
}

/**
 * The one action that comes next for the acting user in the header (decision 2a on #243), by the very
 * rules the APIs enforce, so it never offers an action the API would refuse and never hides one it allows:
 * - Submit for review: a Draft, for whoever `canSubmit` (`POST /api/systems/[id]/submit`); shown but disabled
 *   (`blockedBy` > 0) while mandatory Controls are not addressed, as the route refuses then (decision 6a on #243);
 * - Approve… / Reject: an In Review System with an open Review Step the user may decide
 *   (`userCanDecideStep`, which `GET /api/systems/[id]/approvals` reports as `canDecide`);
 * - Mark Onboarded: an Approved System, for whoever `canMarkOnboarded` (`POST .../onboard`).
 * Nothing for a Rejected or Onboarded System, whose APIs refuse every one of them.
 */
export function nextStepFor(input: {
  status: OnboardingStatus;
  canSubmit: boolean;
  canMarkOnboarded: boolean;
  /** The open Review Steps of the current round the user may decide. */
  decidableSteps: DecisionStep[];
  /** Mandatory Controls not yet addressed (`getUnaddressedMandatoryControls`): the submit route refuses while there are any. */
  unaddressedMandatory?: number;
}): NextStep {
  switch (input.status) {
    case "DRAFT":
      return input.canSubmit ? { kind: "submit", blockedBy: input.unaddressedMandatory ?? 0 } : { kind: "none" };
    case "IN_REVIEW":
      return input.decidableSteps.length > 0 ? { kind: "decide", steps: input.decidableSteps } : { kind: "none" };
    case "APPROVED":
      return input.canMarkOnboarded ? { kind: "onboard" } : { kind: "none" };
    case "REJECTED":
    case "ONBOARDED":
      return { kind: "none" };
  }
}

export type LifecycleStage = { key: "DRAFT" | "IN_REVIEW" | "APPROVED" | "ONBOARDED"; label: string; state: "past" | "now" | "todo"; tone?: "danger" };

/**
 * Draft → In review → Approved → Onboarded, with the steps before the current one marked past. A Rejected
 * System stands on the In review step, labelled Rejected. An Onboarded System has finished all four.
 */
export function lifecycleStages(status: OnboardingStatus): LifecycleStage[] {
  const order = ["DRAFT", "IN_REVIEW", "APPROVED", "ONBOARDED"] as const;
  const labels = { DRAFT: "Draft", IN_REVIEW: "In review", APPROVED: "Approved", ONBOARDED: "Onboarded" };
  const at = status === "REJECTED" ? 1 : order.indexOf(status);
  return order.map((key, index): LifecycleStage => {
    if (status === "REJECTED" && key === "IN_REVIEW") return { key, label: "Rejected", state: "now", tone: "danger" };
    const state = status === "ONBOARDED" ? "past" : index < at ? "past" : index === at ? "now" : "todo";
    return { key, label: labels[key], state };
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "26 Oct 2026" in UTC, so the server and the browser print the same day. */
export function formatDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** The line under the stepper: who submitted it and when, and what it is waiting for. */
export function lifecycleNote(input: {
  status: OnboardingStatus;
  ownerName: string;
  /** When the latest Review Round was submitted, and by whom (null when unknown). */
  submittedAt: string | null;
  submittedBy: string | null;
  /** When the last Review Step approved it, when known. */
  approvedAt: string | null;
  onboardedAt: string | null;
  /** The System has been through a Review Round before. */
  hasEarlierRound: boolean;
  stepsApproved: number;
  stepsTotal: number;
}): string {
  switch (input.status) {
    case "DRAFT":
      return input.hasEarlierRound
        ? `Returned to Draft after a review · waiting for ${input.ownerName}'s resubmission`
        : `Not submitted yet · ${input.ownerName} is still assembling the System`;
    case "IN_REVIEW": {
      const submitted = input.submittedAt
        ? `Submitted ${formatDay(input.submittedAt)}${input.submittedBy ? ` by ${input.submittedBy}` : ""}`
        : "Submitted for review";
      const progress = input.stepsTotal > 1 ? ` (${input.stepsApproved} of ${input.stepsTotal} Review Steps approved)` : "";
      return `${submitted} · waiting for a Reviewer's decision${progress}`;
    }
    case "REJECTED":
      return `Rejected${input.submittedAt ? ` after the review submitted ${formatDay(input.submittedAt)}` : ""} · waiting for ${input.ownerName}'s resubmission`;
    case "APPROVED":
      return `Approved${input.approvedAt ? ` ${formatDay(input.approvedAt)}` : ""} · waiting for ${input.ownerName} or an Admin to mark it Onboarded`;
    case "ONBOARDED":
      return input.onboardedAt ? `Onboarded ${formatDay(input.onboardedAt)}` : "Onboarded";
  }
}

const cap = (text: string) => text.charAt(0) + text.slice(1).toLowerCase();
const QUERY_TITLE_LIMIT = 90;

/**
 * What needs attention on the System, most pressing first: the open Assessment Queries the user can act
 * on, then the mandatory Controls this System assesses itself that are still Not started, then the open
 * Risks, worst first. Each item says which tab its Open button goes to.
 */
export function buildAttention(input: {
  queries: { id: string; controlCode: string; controlTitle: string; body: string }[];
  controls: { id: string; code: string; title: string; mandatory: boolean; status: ControlAssessmentStatus; source: SourceKey }[];
  risks: { id: string; title: string; severity: RiskSeverity; status: RiskStatus }[];
}): AttentionItem[] {
  const queries = input.queries.map(
    (query): AttentionItem => ({
      id: `query-${query.id}`,
      kind: "query",
      title: query.body.length > QUERY_TITLE_LIMIT ? `${query.body.slice(0, QUERY_TITLE_LIMIT - 1).trimEnd()}…` : query.body || `Question on ${query.controlCode}`,
      note: `Open question on ${query.controlCode} ${query.controlTitle}`,
      tone: "warn",
      tab: "controls",
    }),
  );
  const controls = input.controls
    .filter((control) => control.mandatory && control.source === "system" && control.status === "NOT_STARTED")
    .map(
      (control): AttentionItem => ({
        id: `control-${control.id}`,
        kind: "control",
        title: `${control.code} ${control.title}`,
        note: "Mandatory, no Assessment yet",
        tone: "danger",
        tab: "controls",
      }),
    );
  const risks = input.risks
    .filter((risk) => risk.status === "OPEN")
    .sort((a, b) => RISK_LEVELS.indexOf(b.severity) - RISK_LEVELS.indexOf(a.severity) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    .map(
      (risk): AttentionItem => ({
        id: `risk-${risk.id}`,
        kind: "risk",
        title: risk.title,
        note: `${cap(risk.severity)} Risk, open`,
        tone: risk.severity === "CRITICAL" || risk.severity === "HIGH" ? "danger" : "warn",
        tab: "risks",
      }),
    );
  return [...queries, ...controls, ...risks];
}

/** Open Risks counted by severity (row) and likelihood (column), both indexed by `RISK_LEVELS`. */
export function riskGridOf(risks: { severity: RiskSeverity; likelihood: RiskSeverity; status: RiskStatus }[]): number[][] {
  const grid = RISK_LEVELS.map(() => RISK_LEVELS.map(() => 0));
  for (const risk of risks) {
    if (risk.status === "OPEN") grid[RISK_LEVELS.indexOf(risk.severity)][RISK_LEVELS.indexOf(risk.likelihood)] += 1;
  }
  return grid;
}

import type { EvaluationStage, EvaluationTrack } from "@prisma/client";

/**
 * The stages of staged evaluation (PRD 0002 section 5, CONTEXT.md "Evaluation") and what the stepper on the System's Evaluation tab shows
 * of them. Pure and free of server code, so the page, the routes and the client component share it.
 *
 * The enum holds the whole flow, but only the first round, OG1 and the move out of OG1 (to Qualification on the Full track, to the second
 * round on the Self track) are built (#328); later stages are shown and have no actions yet.
 */

export const EVALUATION_STAGE_LABEL: Record<EvaluationStage, string> = {
  FIRST_ROUND: "First round",
  OG1: "OG1",
  QUALIFICATION: "Qualification",
  FIRST_DOCUMENTATION: "First documentation",
  OAG_REVIEW_1: "OAG review",
  OG2: "OG2",
  SECOND_ROUND: "Second round",
  OAG_REVIEW_2: "OAG review",
  OG3: "OG3",
};

export const TRACK_LABEL: Record<EvaluationTrack, string> = { SELF: "Self", FULL: "Full" };

/** A step of the stepper: a stage, or the Risk Analysis (a step of the flow that is not a stored stage). */
export type StepKey = EvaluationStage | "RISK_ANALYSIS_1" | "RISK_ANALYSIS_2" | "TRACK";
export type StepKind = "round" | "ra" | "gate" | "doc" | "oag" | "fork";

export const STEP_INFO: Record<StepKey, { label: string; long: string; kind: StepKind; hint: string }> = {
  FIRST_ROUND: { label: "First round", long: "First round", kind: "round", hint: "The vendor-evaluation Controls, answered before the Track is chosen." },
  RISK_ANALYSIS_1: { label: "Risk Analysis", long: "Risk Analysis (first round)", kind: "ra", hint: "The stakeholders gather the System's Risks and give each a Risk owner." },
  OG1: { label: "OG1", long: "OG1: choose the Track", kind: "gate", hint: "Each Onboarding Advisory Group with first-round Controls in its remit, plus the base review, gives a verdict: Self or Full." },
  TRACK: { label: "Self or Full", long: "Second round onwards", kind: "fork", hint: "What follows depends on the Track OG1 chooses." },
  QUALIFICATION: { label: "Qualification", long: "Qualification", kind: "gate", hint: "The Business System Owner checks the System is worth a full evaluation." },
  FIRST_DOCUMENTATION: { label: "First documentation", long: "First documentation", kind: "doc", hint: "The Document Requirements for this stage, linked and marked provided by the System's owner." },
  OAG_REVIEW_1: { label: "OAG review", long: "OAG review (before OG2)", kind: "oag", hint: "Each group with a remit gives a Recommendation." },
  OG2: { label: "OG2", long: "OG2: proceed?", kind: "gate", hint: "The Business System Owner decides whether the System proceeds to the second round." },
  SECOND_ROUND: { label: "Second round", long: "Second round", kind: "round", hint: "The rest of the applicable Controls, plus second-round documentation." },
  RISK_ANALYSIS_2: { label: "Risk Analysis", long: "Risk Analysis (before OG3)", kind: "ra", hint: "Every open Risk gets a Risk owner before the Business System Owner decides." },
  OAG_REVIEW_2: { label: "OAG review", long: "OAG review (before OG3)", kind: "oag", hint: "Each group with a remit gives a Recommendation." },
  OG3: { label: "OG3", long: "OG3: authorize to operate?", kind: "gate", hint: "The Business System Owner decides whether the System may operate." },
};

const COMMON: StepKey[] = ["FIRST_ROUND", "RISK_ANALYSIS_1", "OG1"];
const SELF_STEPS: StepKey[] = ["SECOND_ROUND", "RISK_ANALYSIS_2", "OG3"];
const FULL_STEPS: StepKey[] = ["QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1", "OG2", "SECOND_ROUND", "RISK_ANALYSIS_2", "OAG_REVIEW_2", "OG3"];

/** The steps of one Track, in order; with no Track, the three shared ones and the fork that OG1 resolves. */
export function stepKeysFor(track: EvaluationTrack | null): StepKey[] {
  return track === "SELF" ? [...COMMON, ...SELF_STEPS] : track === "FULL" ? [...COMMON, ...FULL_STEPS] : [...COMMON, "TRACK"];
}

export type Step = { key: StepKey; label: string; long: string; kind: StepKind; state: "done" | "now" | "todo"; hint: string };

/**
 * The stepper for a System: its Track's steps with each one done, current or later. The Risk Analysis is
 * done once one has been completed since the first round began (`riskAnalysisCompleted`); it is never the current step.
 * A Risk Analysis before OG3 counts as later until a later issue builds that stage.
 */
export function evaluationSteps(input: { stage: EvaluationStage; track: EvaluationTrack | null; riskAnalysisCompleted: boolean }): Step[] {
  const keys = stepKeysFor(input.track);
  const at = keys.indexOf(input.stage);
  return keys.map((key, index): Step => {
    const info = STEP_INFO[key];
    let state: Step["state"] = index < at ? "done" : index === at ? "now" : "todo";
    if (key === "RISK_ANALYSIS_1" && state === "todo" && input.riskAnalysisCompleted) state = "done";
    // A fork is never current: it stands for "the rest, once the Track is chosen".
    return { key, ...info, state };
  });
}

/** The 409 text when a classic Onboarding route is used on a staged System. */
export const STAGED_SYSTEM_REFUSAL = "This System is evaluated in stages: use its Evaluation tab. The classic review doesn't apply to it";

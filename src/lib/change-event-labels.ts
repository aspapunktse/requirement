import type { ChangeEventAction } from "@prisma/client";

/**
 * A human phrase for every Change Event action, for the Home page's "Recent activity". The type is a
 * full `Record`, so a new `ChangeEventAction` value fails the type check until it has a label here
 * (and a test fails if one slips through), instead of showing the raw enum name.
 *
 * Each phrase follows the actor's name and, when the event belongs to a System, precedes its name:
 * "Sara Ek recorded an Approval decision · Payroll Portal".
 */
export const CHANGE_EVENT_ACTION_LABEL: Record<ChangeEventAction, string> = {
  SYSTEM_SUBMITTED: "submitted a System for review",
  APPROVAL_DECIDED: "recorded an Approval decision",
  SYSTEM_ONBOARDED: "marked a System Onboarded",
  RISK_STATUS_CHANGED: "changed a Risk's status",
  ASSESSMENT_STATUS_CHANGED: "changed a Control Assessment's status",
  QUERY_OPENED: "opened an Assessment Query",
  QUERY_REPLIED: "replied to an Assessment Query",
  QUERY_RESOLVED: "resolved an Assessment Query",
  CLASSIFICATION_CHANGED: "changed a System's classification",
  CONTROL_MAPPING_CHANGED: "changed a Control Mapping",
  FRAMEWORK_PUBLISHED: "published a Framework",
  APPLICABILITY_RECOMPUTED: "recomputed which Controls apply to a System",
  ASSESSMENT_REMOVED: "removed a stale Control Assessment",
  ORGANIZATION_IMPLEMENTATION_CHANGED: "changed an Organization Control Implementation",
  CONTROL_OFFERING_CHANGED: "changed a Provider's Control Offering",
  SOA_JUSTIFICATION_CHANGED: "changed an exclusion justification on the Statement of Applicability",
  CHECK_UP_EVALUATED: "evaluated a Check-up",
  REVIEW_STEP_REOPENED: "reopened a Review Step",
  EVALUATION_STAGE_CHANGED: "moved the evaluation to a new stage",
  TRACK_VERDICT_GIVEN: "gave a verdict at OG1",
  TRACK_VERDICT_REOPENED: "reopened a verdict at OG1",
  RECOMMENDATION_GIVEN: "gave a Recommendation",
  RECOMMENDATION_REOPENED: "reopened a Recommendation",
  GATE_DECIDED: "decided at a gate",
  CHANGE_REVIEW_STARTED: "started a Change Review",
  CHANGE_REVIEW_WIDENED: "widened a Change Review",
  CHANGE_REVIEW_DECIDED: "decided a Change Review",
  SYSTEM_OWNER_CHANGED: "changed a System's owner",
  APP_SETTING_CHANGED: "changed a setting",
  SYSTEM_CREATED: "created a System",
  RISK_LOGGED: "logged a Risk",
  SYSTEM_DETAILS_CHANGED: "edited a System's details",
  BUSINESS_SYSTEM_OWNER_CHANGED: "changed a System's Business System Owner",
  RISK_ANALYSIS_COMPLETED: "completed a Risk Analysis",
};

export type ChangeEventTone = "ok" | "warn" | "danger" | "accent";

/** The dot colour of an action in the feed: what it usually means for the reader, not the event's exact result. */
export const CHANGE_EVENT_ACTION_TONE: Record<ChangeEventAction, ChangeEventTone> = {
  SYSTEM_SUBMITTED: "accent",
  APPROVAL_DECIDED: "accent",
  SYSTEM_ONBOARDED: "ok",
  RISK_STATUS_CHANGED: "warn",
  ASSESSMENT_STATUS_CHANGED: "accent",
  QUERY_OPENED: "warn",
  QUERY_REPLIED: "warn",
  QUERY_RESOLVED: "ok",
  CLASSIFICATION_CHANGED: "accent",
  CONTROL_MAPPING_CHANGED: "accent",
  FRAMEWORK_PUBLISHED: "ok",
  APPLICABILITY_RECOMPUTED: "accent",
  ASSESSMENT_REMOVED: "warn",
  ORGANIZATION_IMPLEMENTATION_CHANGED: "accent",
  CONTROL_OFFERING_CHANGED: "accent",
  SOA_JUSTIFICATION_CHANGED: "warn",
  CHECK_UP_EVALUATED: "warn",
  REVIEW_STEP_REOPENED: "warn",
  SYSTEM_OWNER_CHANGED: "accent",
  APP_SETTING_CHANGED: "accent",
  SYSTEM_CREATED: "ok",
  RISK_LOGGED: "warn",
  SYSTEM_DETAILS_CHANGED: "accent",
  BUSINESS_SYSTEM_OWNER_CHANGED: "accent",
  RISK_ANALYSIS_COMPLETED: "ok",
  EVALUATION_STAGE_CHANGED: "accent",
  TRACK_VERDICT_GIVEN: "accent",
  TRACK_VERDICT_REOPENED: "warn",
  RECOMMENDATION_GIVEN: "accent",
  RECOMMENDATION_REOPENED: "warn",
  GATE_DECIDED: "accent",
  CHANGE_REVIEW_STARTED: "warn",
  CHANGE_REVIEW_WIDENED: "warn",
  CHANGE_REVIEW_DECIDED: "accent",
};

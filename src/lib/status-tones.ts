import type { ChipTone } from "@/components/ui/StatusChip";

export function onboardingStatusTone(status: string): ChipTone {
  switch (status) {
    case "APPROVED":
    case "ONBOARDED":
      return "success";
    case "IN_REVIEW":
      return "warn";
    case "REJECTED":
      return "danger";
    default:
      return "neutral";
  }
}

export function requirementStatusTone(status: string): ChipTone {
  switch (status) {
    case "FULFILLED":
      return "success";
    case "IN_PROGRESS":
    case "WAIVED":
      return "warn";
    default:
      return "neutral";
  }
}

export function riskStatusTone(status: string): ChipTone {
  switch (status) {
    case "OPEN":
      return "danger";
    case "MITIGATED":
      return "warn";
    case "CLOSED":
      return "success";
    default:
      return "neutral";
  }
}

/** Tone for a Risk's severity — distinct from `riskStatusTone` since every
 * row on the landing page's task table is already OPEN, so status alone
 * wouldn't differentiate them. */
export function riskSeverityTone(severity: string): ChipTone {
  switch (severity) {
    case "CRITICAL":
    case "HIGH":
      return "danger";
    case "MEDIUM":
      return "warn";
    default:
      return "neutral";
  }
}

/** Tone for a `getSystemsNeedingAttention` reason. */
export function attentionReasonTone(reason: "stale" | "rejected"): ChipTone {
  return reason === "rejected" ? "danger" : "warn";
}

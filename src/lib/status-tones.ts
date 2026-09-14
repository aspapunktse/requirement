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

import { CHECK_UP_OUTCOME_LABEL } from "@/lib/check-up-evaluation-rules";
import { CHECK_UP_STATE_LABEL, type CheckUpStateKey } from "@/lib/check-up-states";
import type { ChipTone } from "@/components/ui/StatusChip";
import type { CheckUpOutcome } from "@prisma/client";
import { checkUpOutcomeTone } from "@/lib/status-tones";

const STATE_TONE: Record<CheckUpStateKey, ChipTone> = { evaluated: "success", withdrawn: "neutral", awaiting: "warn", overdue: "danger", notAnswered: "neutral" };

/** The chip a Check-up wears: an evaluated one says its outcome, the rest say their state. */
export function checkUpStateChip(checkUp: { state: CheckUpStateKey; evaluation: { outcome: CheckUpOutcome } | null }): { tone: ChipTone; label: string } {
  if (checkUp.state === "evaluated" && checkUp.evaluation) {
    return { tone: checkUpOutcomeTone(checkUp.evaluation.outcome), label: CHECK_UP_OUTCOME_LABEL[checkUp.evaluation.outcome] };
  }
  return { tone: STATE_TONE[checkUp.state], label: CHECK_UP_STATE_LABEL[checkUp.state] };
}

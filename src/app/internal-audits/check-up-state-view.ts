import type { CheckUpStateKey } from "@/lib/check-up-states";

/**
 * How a Check-up state is drawn on the Internal Audits pages (the list, #398, and one audit, #399): its colour in
 * the ring, bar and dots, and the order and wording of the ring's legend. Register tokens only.
 */
export const STATE_COLOR: Record<CheckUpStateKey, string> = {
  evaluated: "var(--rg-success)",
  withdrawn: "var(--rg-muted)",
  awaiting: "var(--rg-gold)",
  overdue: "var(--rg-danger)",
  notAnswered: "var(--rg-line)",
};

/** The states with a segment in a ring or bar: "not answered yet" is the empty rest. */
export const BAR_STATES: CheckUpStateKey[] = ["evaluated", "withdrawn", "awaiting", "overdue"];

export const STATE_LEGEND: { state: CheckUpStateKey; label: string }[] = [
  { state: "evaluated", label: "evaluated" },
  { state: "withdrawn", label: "withdrawn" },
  { state: "awaiting", label: "awaiting evaluation" },
  { state: "overdue", label: "overdue" },
  { state: "notAnswered", label: "not answered yet" },
];

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

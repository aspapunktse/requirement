import type { CheckUpAnswer } from "@prisma/client";
import { isOpenCheckUpState, type CheckUpStateKey } from "@/lib/check-up-states";
import { CHECK_UP_ANSWER_LABEL } from "@/lib/check-up-response-rules";

/**
 * How the single Internal Audit page (#399) groups, filters and picks Check-ups. Pure and Prisma-free, so it can be
 * unit tested and used by the client component. The *state* of a Check-up is never decided here: the loader derives it
 * with `checkUpState` (`check-up-states.ts`, the rules of the Internal Audits list) and these helpers only read it.
 */

export type AuditGrouping = "control" | "system" | "recipient";

export const AUDIT_GROUPINGS: { key: AuditGrouping; label: string }[] = [
  { key: "control", label: "By Control" },
  { key: "system", label: "By System" },
  { key: "recipient", label: "By recipient" },
];

/** The part of a Check-up the grouping reads. */
export type GroupableCheckUp = {
  id: string;
  state: CheckUpStateKey;
  control: { code: string; title: string };
  target: { kind: "system"; id: string; name: string } | { kind: "organization" };
  recipient: { id: string; name: string } | null;
};

export type CheckUpGroup<T extends GroupableCheckUp> = {
  key: string;
  /** What the group's header says: a Control, a System (or the Organization) or a recipient (or "No Control Owner"). */
  title: string;
  /** Set for a Control group: its code and title apart. */
  control: { code: string; title: string } | null;
  /** Neither evaluated nor withdrawn is "not done"; the rest are done. */
  done: number;
  total: number;
  checkUps: T[];
};

const collator = new Intl.Collator("en", { numeric: true });

/** Done: evaluated or withdrawn (the opposite of "open"). */
export function isDone(checkUp: Pick<GroupableCheckUp, "state">): boolean {
  return !isOpenCheckUpState(checkUp.state);
}

/** The state filter: null keeps everything, otherwise exactly one state (a stat card per state). */
export function matchesStateFilter(checkUp: Pick<GroupableCheckUp, "state">, filter: CheckUpStateKey | null): boolean {
  return filter === null || checkUp.state === filter;
}

function groupKey(checkUp: GroupableCheckUp, by: AuditGrouping): { key: string; title: string; sort: string } {
  switch (by) {
    case "control":
      return { key: checkUp.control.code, title: `${checkUp.control.code} ${checkUp.control.title}`, sort: checkUp.control.code };
    case "system":
      // The Organization sorts after every System, whatever the Systems are called.
      return checkUp.target.kind === "system"
        ? { key: `s:${checkUp.target.id}`, title: checkUp.target.name, sort: `0${checkUp.target.name}` }
        : { key: "organization", title: "Organization", sort: "1" };
    case "recipient":
      return checkUp.recipient
        ? { key: `r:${checkUp.recipient.id}`, title: checkUp.recipient.name, sort: `0${checkUp.recipient.name}` }
        : { key: "none", title: "No Control Owner", sort: "1" };
  }
}

/**
 * The Check-ups in groups for a tab, each with how many are done of its total. Groups come in a stable order:
 * Controls by code (numerically: A.5.2 before A.5.10), Systems by name with the Organization last, recipients by
 * name with "No Control Owner" last. The Check-ups keep the order they came in inside a group.
 */
export function groupCheckUps<T extends GroupableCheckUp>(checkUps: T[], by: AuditGrouping): CheckUpGroup<T>[] {
  const groups = new Map<string, CheckUpGroup<T>>();
  const sorts = new Map<string, string>();
  for (const checkUp of checkUps) {
    const { key, title, sort } = groupKey(checkUp, by);
    let group = groups.get(key);
    if (!group) {
      sorts.set(key, sort);
      group = { key, title, control: by === "control" ? checkUp.control : null, done: 0, total: 0, checkUps: [] };
      groups.set(key, group);
    }
    group.checkUps.push(checkUp);
    group.total += 1;
    if (isDone(checkUp)) group.done += 1;
  }
  return [...groups.values()].sort((a, b) => collator.compare(sorts.get(a.key)!, sorts.get(b.key)!));
}

/** The Check-up the panel shows: the picked one if it still exists, else the first open one in the list, else the first. */
export function pickedCheckUp<T extends GroupableCheckUp>(all: T[], shownInOrder: T[], pickedId: string | null): T | null {
  return all.find((checkUp) => checkUp.id === pickedId) ?? shownInOrder.find((checkUp) => !isDone(checkUp)) ?? shownInOrder[0] ?? null;
}

/** "Yes", "No" or "N/A" when every answer is the same, else "Mixed". Null when there is no answer. */
export function answerSummary(answers: CheckUpAnswer[]): string | null {
  if (answers.length === 0) return null;
  const labels = new Set(answers.map((answer) => CHECK_UP_ANSWER_LABEL[answer]));
  return labels.size === 1 ? [...labels][0] : "Mixed";
}

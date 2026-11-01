import type { ControlAssessmentStatus } from "@prisma/client";
import { STATUS_LABEL, STATUS_ORDER, countLabel, presentStatuses, type StatusCounts } from "./controls-logic";

/** Small parts the register's rows, group rows and legends share (design proposal A "Implementation register", issue #284). */

/** The colour of a status in the ring, as the CSS draws it everywhere else (`controls.css`). */
export const STATUS_COLOR: Record<ControlAssessmentStatus, string> = {
  NOT_STARTED: "var(--oc-wait)",
  IN_PROGRESS: "var(--rg-gold)",
  FULFILLED: "var(--rg-success)",
  WAIVED: "var(--oc-waived)",
  NOT_APPLICABLE: "var(--rg-line)",
};

/** A coloured dot and the status word: state is always a word first. */
export function StatusChip({ status }: { status: ControlAssessmentStatus }) {
  return (
    <span className="oc-chip">
      <span className={`oc-dot oc-s-${status}`} aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A stacked bar over the statuses of a set of Controls. */
export function StatusBar({ counts, label }: { counts: StatusCounts; label: string }) {
  const present = presentStatuses(counts);
  return (
    <span className="oc-bar" role="img" aria-label={label}>
      {present.map(({ status, count }) => (
        <span key={status} className={`oc-s-${status}`} style={{ flexGrow: count }} />
      ))}
    </span>
  );
}

/**
 * The count of each status present, as a coloured dot and a number, visible without hovering (decision 4a).
 * Each is labelled for screen readers, e.g. "3 Fulfilled".
 */
export function StatusCountList({ counts }: { counts: StatusCounts }) {
  return (
    <span className="oc-gcounts">
      {presentStatuses(counts).map(({ status, count }) => (
        <span key={status} role="img" aria-label={countLabel(count, status)}>
          <span className={`oc-dot oc-s-${status}`} aria-hidden="true" />
          <span aria-hidden="true">{count}</span>
        </span>
      ))}
    </span>
  );
}

/** The accessible text of a stacked bar: "Statuses: 2 Fulfilled, 1 Not Started". */
export function describeStatuses(counts: StatusCounts): string {
  return `Statuses: ${STATUS_ORDER.filter((status) => counts[status] > 0)
    .map((status) => countLabel(counts[status], status))
    .join(", ")}`;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** The Control Owner with an avatar, or the warning for a Control nobody owns. */
export function OwnerCell({ name }: { name: string | null }) {
  return name ? (
    <span className="own">
      <span className="av" aria-hidden="true">
        {initials(name)}
      </span>
      {name}
    </span>
  ) : (
    <span className="own none">
      <span className="av" aria-hidden="true">
        ?
      </span>
      No Control Owner
    </span>
  );
}

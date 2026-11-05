import type { ControlApplicability, ControlAssessmentStatus } from "@prisma/client";
import { APPLICABILITY_LABEL } from "@/lib/statement-of-applicability-rules";
import { highlightParts, initials } from "./library-logic";

/** Small parts the Control Library's rows, drawer and dialog share (design proposal A "Workbench", issue #313). */

/** The colour of a status in the ring, as the CSS draws the dots (`library.css`). */
export const STATUS_COLOR: Record<ControlAssessmentStatus, string> = {
  NOT_STARTED: "var(--cl-wait)",
  IN_PROGRESS: "var(--rg-gold)",
  FULFILLED: "var(--rg-success)",
  WAIVED: "var(--cl-waived)",
  NOT_APPLICABLE: "var(--cl-na)",
};

/** A coloured dot for an Organization status; state is always a word first, so callers print the word beside it. */
export function StatusDot({ status }: { status: ControlAssessmentStatus }) {
  return <span className={`cl-dot cl-s-${status}`} aria-hidden="true" />;
}

/** Text with the occurrences of the search query marked. */
export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>))}
    </>
  );
}

/** The Control Owner with an avatar, or "Unassigned" for a Control nobody owns. */
export function OwnerCell({ name, query = "" }: { name: string | null; query?: string }) {
  return name ? (
    <span className="cl-own">
      <span className="av" aria-hidden="true">
        {initials(name)}
      </span>
      <span>
        <Highlight text={name} query={query} />
      </span>
    </span>
  ) : (
    <span className="cl-own none">
      <span className="av" aria-hidden="true">
        ?
      </span>
      <span>Unassigned</span>
    </span>
  );
}

/** The Applicability chip: Organizational, Per-System or Both. */
export function ApplicabilityChip({ applicability }: { applicability: ControlApplicability }) {
  return <span className={`cl-chip ${applicability === "BOTH" ? "both" : applicability === "ORGANIZATIONAL" ? "org" : ""}`}>{APPLICABILITY_LABEL[applicability]}</span>;
}

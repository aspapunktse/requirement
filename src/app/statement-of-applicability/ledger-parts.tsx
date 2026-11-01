import { Fragment, type ReactNode } from "react";
import type { ControlAssessmentStatus } from "@prisma/client";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import type { SystemRollup } from "@/lib/statement-of-applicability-rules";
import { ROLLUP_ORDER } from "./soa-logic";
import type { SoaRequirementGroup } from "./soa-types";

/** Small parts the ledger table and its drawer share (design proposal A "Statement Ledger", issue #272). */

/** A coloured dot and the status word: state is always a word first. */
export function StatusText({ status }: { status: ControlAssessmentStatus }) {
  return (
    <span className="sl-status">
      <i className={`sl-dot sl-s-${status}`} aria-hidden="true" />
      {CONTROL_ASSESSMENT_STATUS_LABEL[status]}
    </span>
  );
}

/** The Systems' effective statuses as one stacked bar; `wide` for the cards and the drawer. */
export function RollupBar({ rollup, wide = false }: { rollup: SystemRollup; wide?: boolean }) {
  const present = ROLLUP_ORDER.filter((status) => rollup.counts[status] > 0);
  const text = present.map((status) => `${rollup.counts[status]} ${CONTROL_ASSESSMENT_STATUS_LABEL[status]}`).join(", ");
  return (
    <span className={`sl-rbar${wide ? " wide" : ""}`} role="img" aria-label={`Systems: ${text}`} title={text}>
      {present.map((status) => (
        <i key={status} className={`sl-s-${status}`} style={{ flexGrow: rollup.counts[status] }} />
      ))}
    </span>
  );
}

/** A stacked bar over plain counts (the cards). */
export function CountsBar({ counts, order, label }: { counts: Record<ControlAssessmentStatus, number>; order: ControlAssessmentStatus[]; label: string }) {
  return (
    <span className="sl-rbar wide" role="img" aria-label={label}>
      {order
        .filter((status) => counts[status] > 0)
        .map((status) => (
          <i key={status} className={`sl-s-${status}`} style={{ flexGrow: counts[status] }} />
        ))}
    </span>
  );
}

/** `text` with the part that matches `query` marked. */
export function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return text;
  return (
    <Fragment>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </Fragment>
  );
}

/** The Requirement codes per Published Framework: "ISO/IEC 27001:2022  A.8.24, A.8.25". */
export function RequirementChips({ groups, query = "" }: { groups: SoaRequirementGroup[]; query?: string }) {
  if (groups.length === 0) return <span className="sl-faint">No mapped Requirement</span>;
  return (
    <>
      {groups.map((group) => (
        <span key={group.framework} className="sl-req">
          <b>{group.framework}</b> <Highlight text={group.codes.join(", ")} query={query} />
        </span>
      ))}
    </>
  );
}

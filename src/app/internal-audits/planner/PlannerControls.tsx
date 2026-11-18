"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/app/home/HomeGraphics";
import type { PlannerControl } from "@/lib/audit-planner";
import { MAX_QUESTION_LENGTH } from "@/lib/check-up-rules";
import { isDueForAudit } from "@/lib/internal-audit-rules";
import { lastAuditedLabel } from "./planner-logic";
import type { ControlView } from "./planner-types";

const APPLICABILITY_LABEL = { PER_SYSTEM: "Per System", ORGANIZATIONAL: "Organization", BOTH: "Both" } as const;
const PAGE = 60;

/**
 * Step 2, "Which Controls?": search, the All / Due for audit / Picked views, domain chips and the rows. Opening a row
 * edits the first question of that Control's Check-ups. What a Control would generate (`perControl`) is the
 * server's preview. `now` is null until the browser has told us the date (the labels need it).
 */
export function PlannerControls({
  controls,
  picked,
  onPick,
  questionFor,
  onQuestion,
  perControl,
  now,
  openId,
  onOpen,
  reveal,
}: {
  controls: PlannerControl[];
  picked: Set<string>;
  onPick: (ids: string[], on: boolean) => void;
  questionFor: (control: PlannerControl) => string;
  onQuestion: (control: PlannerControl, text: string) => void;
  perControl: Record<string, number> | null;
  now: Date | null;
  openId: string | null;
  onOpen: (id: string | null) => void;
  /** Asks to show one picked Control's row: filters are cleared and the page grown until it renders. */
  reveal: { id: string; nonce: number } | null;
}) {
  const [view, setView] = useState<ControlView>("all");
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [seenReveal, setSeenReveal] = useState(0);
  // A reveal request (adjusting state while rendering, not in an effect): show the picked view with no search or domain, far enough down.
  if (reveal && reveal.nonce !== seenReveal) {
    setSeenReveal(reveal.nonce);
    setView("picked");
    setQuery("");
    setDomain(null);
    const index = controls.filter((control) => picked.has(control.id)).findIndex((control) => control.id === reveal.id);
    setShown((current) => Math.max(current, Math.ceil((index + 1) / PAGE) * PAGE));
  }

  const due = useMemo(() => new Set(controls.filter((c) => isDueForAudit(c.lastAudited, now ?? undefined)).map((c) => c.id)), [controls, now]);
  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const control of controls) counts.set(control.category, (counts.get(control.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [controls]);

  const needle = query.trim().toLowerCase();
  const visible = controls.filter((control) => {
    if (view === "due" && !due.has(control.id)) return false;
    // The open row stays in the "Picked" view, so unticking it doesn't make the editor vanish under the cursor.
    if (view === "picked" && !picked.has(control.id)) return false;
    if (domain && control.category !== domain) return false;
    if (!needle) return true;
    return [control.code, control.title, questionFor(control)].some((text) => text.toLowerCase().includes(needle));
  });
  const rows = visible.slice(0, shown);
  const allVisiblePicked = visible.length > 0 && visible.every((control) => picked.has(control.id));

  const reset = () => setShown(PAGE);

  return (
    <section className="ap-card" aria-labelledby="ap-c-h">
      <div className="ap-card-h">
        <span className={`ap-step${picked.size > 0 ? " done" : ""}`}>2</span>
        <h2 id="ap-c-h">Which Controls?</h2>
        <p>
          {picked.size} picked · {due.size} due for audit
        </p>
      </div>
      <div className="ap-tbar">
        <label className="hc-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            aria-label="Search Controls by code, title or question"
            placeholder="Search by code, title or question"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              reset();
            }}
          />
        </label>
        <div className="ap-seg" role="group" aria-label="Show Controls">
          {(
            [
              ["all", `All ${controls.length}`],
              ["due", `Due for audit ${due.size}`],
              ["picked", `Picked ${picked.size}`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => {
                setView(key);
                reset();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {domains.length > 1 && (
        <div className="ap-domains" role="group" aria-label="Domains">
          {domains.map(([name, count]) => (
            <button
              key={name}
              type="button"
              className="ap-fchip"
              aria-pressed={domain === name}
              onClick={() => {
                setDomain(domain === name ? null : name);
                reset();
              }}
            >
              {name} <span className="n">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="ap-rows" aria-label="Controls">
        <div className="ap-rows-h">
          <input
            type="checkbox"
            aria-label="Pick every Control shown"
            checked={allVisiblePicked}
            disabled={visible.length === 0}
            onChange={(event) => onPick(visible.map((control) => control.id), event.target.checked)}
          />
          <span>{visible.length} shown</span>
          <span className="sp">Check-ups</span>
        </div>
        {rows.length === 0 && <p className="ap-empty">{controls.length === 0 ? "There are no Controls yet." : "No Control matches."}</p>}
        {rows.map((control) => {
          const on = picked.has(control.id);
          const question = questionFor(control);
          const open = openId === control.id;
          const isDue = due.has(control.id);
          const never = control.lastAudited === null;
          const old = !never && isDue;
          const count = perControl?.[control.id];
          return (
            <div key={control.id} className={`ap-crow${on ? " on" : ""}`} data-control={control.code}>
              <input type="checkbox" aria-label={`Pick ${control.code}`} checked={on} onChange={(event) => onPick([control.id], event.target.checked)} />
              <span className="ap-code">{control.code}</span>
              <button type="button" className="ap-ct" aria-expanded={open} aria-label={`Question of ${control.code}`} onClick={() => onOpen(open ? null : control.id)}>
                <b>{control.title}</b>
                <small className={question.trim() === "" ? "missing" : undefined}>{question.trim() === "" ? "No question yet: write the first" : question}</small>
              </button>
              <span className="ap-meta">
                <span className={`ap-appl ${control.applicability}`}>{APPLICABILITY_LABEL[control.applicability]}</span>
                {now && <span className={`ap-age${never ? " never" : old ? " old" : ""}`}>{lastAuditedLabel(control.lastAudited, now)}</span>}
              </span>
              <span className="ap-cu" aria-label={on ? `${count ?? 0} Check-ups` : undefined}>
                {on ? (count ?? "…") : ""}
              </span>
              {open && (
                <div className="ap-qedit">
                  <div className="ap-qh">
                    <b>First question for {control.code}</b>
                    <span>Asked in every Check-up of this Control in this audit; later questions are kept.</span>
                  </div>
                  <textarea
                    className="ap-inp"
                    rows={3}
                    autoFocus={reveal?.id === control.id}
                    maxLength={MAX_QUESTION_LENGTH}
                    aria-label={`First question for ${control.code}`}
                    value={question}
                    onChange={(event) => onQuestion(control, event.target.value)}
                  />
                </div>
              )}
            </div>
          );
        })}
        {visible.length > rows.length && (
          <button type="button" className="ap-more" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, visible.length - rows.length)} more ({visible.length - rows.length} left)
          </button>
        )}
      </div>
    </section>
  );
}


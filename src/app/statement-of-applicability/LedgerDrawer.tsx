"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Ring } from "@/app/home/HomeGraphics";
import { EXCLUSION_JUSTIFICATION_MAX_LENGTH } from "@/lib/statement-of-applicability-rules";
import "@/app/systems/[id]/system-cockpit.css";
import "./statement.css";
import { JUSTIFICATION_TEMPLATES, ROLLUP_ORDER, applicabilityText, describeCounts } from "./soa-logic";
import { RequirementChips, RollupBar, StatusText } from "./ledger-parts";
import type { SoaLedgerRow } from "./soa-types";

/**
 * The Control drawer of the Statement of Applicability (design proposal A "Statement Ledger", issue #272): one
 * Control at a time, opened from a row, a "Write" button or the Ctrl+K palette. It says why the Control is
 * included or excluded, shows the generated inclusion justification or the exclusion justification (an editor
 * with templates, Save and Clear for a Compliance Manager or an Admin; read-only text for everyone else), and
 * the implementation: the Organization's status, the Systems rollup, the Control Owner and the Systems the
 * acting user may see.
 *
 * A modal dialog like the Control drawer: Escape, the close button and the scrim close it, Tab stays inside it,
 * j and k walk to the next and previous Control while no field has focus, and the page behind does not scroll.
 * Its editor follows the stored text during render, not in an effect (an effect also runs after mount and could
 * overwrite what the user has already typed).
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function LedgerDrawer({
  row,
  systems,
  canEdit,
  position,
  onClose,
  onStep,
  onSave,
}: {
  row: SoaLedgerRow;
  /** The Systems the acting user may see (`SoaView.systems`). */
  systems: { id: string; name: string }[];
  canEdit: boolean;
  /** "3 of 41": where the Control is among the rows in view; empty when it is not in view. */
  position: string;
  onClose: () => void;
  /** Previous (-1) or next (1) Control in the table's current view. */
  onStep: (delta: -1 | 1) => void;
  /** Writes the exclusion justification (null clears it). Resolves to an error message, or null once saved. */
  onSave: (row: SoaLedgerRow, justification: string | null) => Promise<string | null>;
}) {
  const titleId = useId();
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const closeNow = useRef(onClose);
  const stepNow = useRef(onStep);
  useEffect(() => {
    closeNow.current = onClose;
    stepNow.current = onStep;
  });

  const editable = canEdit && !row.included;
  const [draft, setDraft] = useState(row.exclusionJustification ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Follow the stored text when it changes (a save, a clear). Done during render, not in an effect.
  const [syncedText, setSyncedText] = useState(row.exclusionJustification);
  if (row.exclusionJustification !== syncedText) {
    setSyncedText(row.exclusionJustification);
    setDraft(row.exclusionJustification ?? "");
  }

  // Focus goes into the drawer (to the editor of a missing justification), Escape closes it, j and k step, and the page behind stays put.
  useEffect(() => {
    if (editable && row.justificationMissing) textRef.current?.focus();
    else closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (event.key === "Escape") {
        if (target === document.body || (target instanceof Node && asideRef.current?.contains(target))) closeNow.current();
        return;
      }
      const typing = target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "j") stepNow.current(1);
      else if (event.key === "k") stepNow.current(-1);
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
    // Once, when the drawer opens: stepping to another Control remounts it on a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus stays in the drawer: a disabled button while saving can drop it.
  useEffect(() => {
    if (asideRef.current?.contains(document.activeElement) || document.querySelectorAll('[role="dialog"]').length > 1) return;
    closeRef.current?.focus();
  }, [row, busy]);

  function keepFocusInside(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const aside = asideRef.current;
    if (!aside) return;
    const items = [...aside.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === aside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === aside)) {
      event.preventDefault();
      first.focus();
    }
  }

  async function write(justification: string | null) {
    setBusy(true);
    setError(null);
    const failure = await onSave(row, justification);
    setBusy(false);
    if (failure) setError(failure);
  }

  function save() {
    const text = draft.trim();
    if (!text) {
      setError("Write a justification first");
      textRef.current?.focus();
      return;
    }
    void write(text);
  }

  const rollup = row.systemRollup;
  const listed = [...row.systemStatuses]
    .map(([index, status]) => ({ id: systems[index]?.id ?? String(index), name: systems[index]?.name ?? "", status }))
    .sort((a, b) => ROLLUP_ORDER.indexOf(a.status) - ROLLUP_ORDER.indexOf(b.status) || a.name.localeCompare(b.name, "en", { numeric: true }));

  return createPortal(
    <div className="sc-drawer-root sl-drawer-root">
      <div className="sc-scrim" data-testid="soa-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={asideRef} className="sc-drawer sl-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={keepFocusInside}>
        <header>
          <button ref={closeRef} type="button" className="hc-btn ghost sc-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <span className="sc-eyebrow">
            {row.category}
            {position && <span className="sl-pos"> · {position}</span>}
          </span>
          <h2 id={titleId}>
            <span className="sl-dcode">{row.code}</span> {row.title}
          </h2>
          <div className="sc-dmeta">
            <span className={`sl-inc ${row.included ? "yes" : "no"}`}>{row.included ? "Included" : "Excluded"}</span>
            <span className="sl-chip">{applicabilityText(row)}</span>
          </div>
        </header>

        <div className="sc-dbody">
          {error && (
            <p role="alert" className="sc-err">
              {error}
            </p>
          )}

          {row.description && <p>{row.description}</p>}

          <div className="sl-verdict">
            <Ring segments={[[row.included ? 1 : 0, "var(--rg-accent)"]]} size={34} stroke={6} label={row.included ? "Included" : "Excluded"} />
            {row.included ? (
              <p>
                <b>Included</b> because it{" "}
                {[row.appliesToOrganization ? "applies to the Organization" : "", row.appliesToSystemCount > 0 ? `applies to ${row.appliesToSystemCount} System${row.appliesToSystemCount === 1 ? "" : "s"}` : ""]
                  .filter(Boolean)
                  .join(" and ")}
                . The justification is generated from the Requirements it satisfies.
              </p>
            ) : (
              <p>
                <b>Excluded</b>: it applies to neither the Organization nor any System, because no Published Framework in scope maps a Requirement to it
                {row.applicability === "PER_SYSTEM" ? ", or no System’s classification brings it in" : ""}. ISO 27001 asks why
                {editable ? ": write it below." : "."}
              </p>
            )}
          </div>

          {row.included ? (
            <section className="sc-dsec" aria-label="Inclusion justification">
              <h3>Inclusion justification · generated</h3>
              <div className="sl-reqs">
                <RequirementChips groups={row.requirements} />
              </div>
            </section>
          ) : (
            <section className="sc-dsec" aria-label="Exclusion justification">
              <h3>
                Exclusion justification
                {row.justificationMissing && <span className="sl-bad"> · missing</span>}
              </h3>
              {editable ? (
                <div className="sl-editor">
                  <label className="sr-only" htmlFor={`${titleId}-text`}>
                    Exclusion justification of {row.code}
                  </label>
                  <textarea
                    id={`${titleId}-text`}
                    ref={textRef}
                    rows={5}
                    maxLength={EXCLUSION_JUSTIFICATION_MAX_LENGTH}
                    placeholder="Why does this Control not apply? Refer to the scope, the risk assessment or the provider that covers it."
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <div className="sl-tpls" role="group" aria-label="Templates">
                    {JUSTIFICATION_TEMPLATES.map((template) => (
                      <button
                        key={template.label}
                        type="button"
                        onClick={() => {
                          setDraft(template.text);
                          textRef.current?.focus();
                        }}
                      >
                        + {template.label}
                      </button>
                    ))}
                  </div>
                  <div className="sl-row-end">
                    <span>Saving records a Change Event</span>
                    <span className="sl-btns">
                      {row.exclusionJustification !== null && (
                        <button type="button" className="hc-btn danger" disabled={busy} onClick={() => void write(null)}>
                          Clear
                        </button>
                      )}
                      <button type="button" className="hc-btn primary" disabled={busy} onClick={save}>
                        Save justification
                      </button>
                    </span>
                  </div>
                </div>
              ) : (
                <>
                  {row.exclusionJustification ? <p className="sl-quote">{row.exclusionJustification}</p> : <span className="sl-missing">No justification</span>}
                  <p className="sl-note">Only a Compliance Manager or an Admin writes exclusion justifications.</p>
                </>
              )}
            </section>
          )}

          {row.included && (
            <section className="sc-dsec" aria-label="Implementation">
              <h3>Implementation</h3>
              <dl className="sl-kv">
                {row.organizationStatus && (
                  <>
                    <dt>Organization</dt>
                    <dd>
                      <StatusText status={row.organizationStatus} />
                    </dd>
                  </>
                )}
                {rollup && (
                  <>
                    <dt>Systems</dt>
                    <dd>{rollup.total === 0 ? "No Systems" : describeCounts(rollup.counts)}</dd>
                  </>
                )}
                <dt>Control Owner</dt>
                <dd>{row.ownerName ?? <span className="sl-faint">Unassigned</span>}</dd>
              </dl>
              {rollup && rollup.total > 0 && (
                <>
                  <RollupBar rollup={rollup} wide />
                  <ul className="sl-syslist" aria-label="Systems">
                    {listed.map((system) => (
                      <li key={system.id}>
                        <span>{system.name}</span>
                        <StatusText status={system.status} />
                      </li>
                    ))}
                    {row.hiddenSystemCount > 0 && <li className="sl-hidden">{row.hiddenSystemCount} more not visible to you</li>}
                  </ul>
                </>
              )}
            </section>
          )}
        </div>

        <footer className="sl-dfoot">
          <Link href="/controls" className="hc-btn" title={`Find ${row.code} in the Control Library`}>
            Open Control →
          </Link>
          <span className="sl-dnav">
            <button type="button" className="hc-btn" title="Previous (k)" onClick={() => onStep(-1)}>
              ↑ Previous
            </button>
            <button type="button" className="hc-btn" title="Next (j)" onClick={() => onStep(1)}>
              Next ↓
            </button>
          </span>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

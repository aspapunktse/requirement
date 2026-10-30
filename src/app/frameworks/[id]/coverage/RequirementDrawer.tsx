"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { StatusChip } from "@/components/ui/StatusChip";
import { COVERAGE_STATE_LABEL, type CoverageState } from "@/lib/coverage-state";
import { frameworkLabel } from "@/lib/framework-label";
import "@/app/systems/[id]/system-cockpit.css";
import "./coverage.css";
import { ACCEPT_TEMPLATES, formatDate, resolveControl, suggestControls, supplementaryCode, whyText } from "./coverage-logic";
import type { CoverageFramework, CoverageRow, LibraryControl, MappedControl } from "./coverage-types";

/**
 * The Requirement drawer of the Framework coverage page (design proposal A "Gap ledger", issue #269): one
 * Requirement at a time, opened from a row or the Ctrl+K palette. It maps and unmaps Controls, switches a mapping
 * between Full and Partial, closes a gap (a new Supplementary Control, or an acceptance with a justification),
 * edits or ends an acceptance, and shows the effect on Systems. Only Compliance Managers and Admins get the
 * controls; the routes enforce the same.
 *
 * It is a modal dialog like the Control drawer: Escape, the close button and the scrim close it, Tab stays inside
 * it and the page behind does not scroll. Its forms follow the row during render, not in an effect (an effect also
 * runs after mount and could overwrite what the user has already typed).
 */

export type DrawerFocus = "map" | "create" | "accept" | null;

/** Runs a write against the API: resolves to an error message, or null once it succeeded (the page then refreshes). */
export type Mutate = (request: { path: string; method: "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown }, notice: string) => Promise<string | null>;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const STATE_TONE: Record<CoverageState, "success" | "danger" | "warn"> = { COVERED: "success", GAP: "danger", ACCEPTED_GAP: "warn" };

/** A mapped Control: code, title, Full/Partial, and a dashed border for a Supplementary Control. */
export function ControlChip({ mapping }: { mapping: Pick<MappedControl, "code" | "title" | "coverage" | "supplementary"> }) {
  return (
    <span className={`cv-ctl${mapping.supplementary ? " sup" : ""}`} title={`${mapping.title}${mapping.supplementary ? " (Supplementary)" : ""}`}>
      <b>{mapping.code}</b>
      <span>{mapping.title}</span>
      <em className={mapping.coverage}>{mapping.coverage === "FULL" ? "Full" : "Partial"}</em>
      {mapping.supplementary && <i>Supplementary</i>}
    </span>
  );
}

export function RequirementDrawer({
  row,
  framework,
  canCurate,
  controls,
  rows,
  focusOn,
  pending,
  onClose,
  onStep,
  mutate,
}: {
  row: CoverageRow;
  framework: CoverageFramework;
  canCurate: boolean;
  controls: LibraryControl[];
  /** Every Requirement of the Framework, for the suggestions. */
  rows: CoverageRow[];
  focusOn: DrawerFocus;
  /** The page is refreshing after a write. */
  pending: boolean;
  onClose: () => void;
  /** Previous (-1) or next (1) Requirement in the table's current view. */
  onStep: (delta: -1 | 1) => void;
  mutate: Mutate;
}) {
  const titleId = useId();
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mapRef = useRef<HTMLInputElement>(null);
  const supTitleRef = useRef<HTMLInputElement>(null);
  const justRef = useRef<HTMLTextAreaElement>(null);
  const closeNow = useRef(onClose);
  useEffect(() => {
    closeNow.current = onClose;
  });

  const [justification, setJustification] = useState(row.justification ?? "");
  const [supCode, setSupCode] = useState(() => supplementaryCode(framework, row));
  const [supTitle, setSupTitle] = useState(row.title);
  const [mapInput, setMapInput] = useState("");
  const [mapCoverage, setMapCoverage] = useState<"FULL" | "PARTIAL">("FULL");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = busy || pending;

  // Follow the acceptance when it changes (a save, an un-accept). Done during render, not in an effect.
  const [syncedJustification, setSyncedJustification] = useState(row.justification);
  if (row.justification !== syncedJustification) {
    setSyncedJustification(row.justification);
    setJustification(row.justification ?? "");
  }

  // Focus goes into the drawer (to the field the row action asked for), Escape closes it unless something else
  // has focus, and the page behind stays put.
  useEffect(() => {
    (focusOn === "map" ? mapRef.current : focusOn === "create" ? supTitleRef.current : focusOn === "accept" ? justRef.current : null)?.focus();
    if (!asideRef.current?.contains(document.activeElement)) closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target === document.body || (target instanceof Node && asideRef.current?.contains(target))) closeNow.current();
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
    // Once, when the drawer opens: stepping to another Requirement keeps the drawer mounted on a new key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus stays in the drawer: a disabled button while saving, or a refresh of the page, can drop it.
  useEffect(() => {
    if (asideRef.current?.contains(document.activeElement) || document.querySelectorAll('[role="dialog"]').length > 1) return;
    closeRef.current?.focus();
  }, [row, working]);

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

  const base = `/api/frameworks/${framework.id}/requirements/${row.id}`;

  /** One write at a time: busy while it runs, and its error (if any) shows in the drawer. Resolves to whether it succeeded. */
  async function run(request: Parameters<Mutate>[0], notice: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const failure = await mutate(request, notice);
    setBusy(false);
    if (failure) setError(failure);
    return failure === null;
  }

  async function addMapping(control: LibraryControl, coverage: "FULL" | "PARTIAL") {
    if (row.mappings.some((mapping) => mapping.controlId === control.id)) {
      setError(`${control.code} is already mapped to ${row.code}`);
      return;
    }
    const ok = await run({ path: `${base}/mappings`, method: "POST", body: { controlId: control.id, coverage } }, `${control.code} mapped to ${row.code}`);
    if (ok) setMapInput("");
  }

  function submitMapping() {
    const control = resolveControl(mapInput, controls);
    if (!control) {
      setError("Pick a Control from the list");
      return;
    }
    void addMapping(control, mapCoverage);
  }

  function removeMapping(mapping: MappedControl) {
    const published = framework.status === "PUBLISHED";
    const confirmed = window.confirm(
      `Remove the mapping from ${row.code} to ${mapping.code}?` +
        (published ? " Systems that have this Framework in scope are recomputed, so an untouched Assessment for a Control that no longer applies is removed." : ""),
    );
    if (!confirmed) return;
    void run({ path: `${base}/mappings/${mapping.id}`, method: "DELETE" }, `Mapping removed from ${row.code}`);
  }

  function setCoverage(mapping: MappedControl, coverage: "FULL" | "PARTIAL") {
    if (mapping.coverage === coverage) return;
    void run({ path: `${base}/mappings/${mapping.id}`, method: "PATCH", body: { coverage } }, `${mapping.code} is now ${coverage === "FULL" ? "Full" : "Partial"} for ${row.code}`);
  }

  function createSupplementary() {
    const code = supCode.trim();
    const title = supTitle.trim();
    if (!code || !title) {
      setError("A code and a title are needed");
      return;
    }
    // An Organizational Control needs no Self-Assessment Question and is never scoped, so it is the safe default to author from a gap.
    void run(
      {
        path: `${base}/supplementary-control`,
        method: "POST",
        body: { code, title, description: row.text.trim() || row.title, category: "Supplementary", applicability: "ORGANIZATIONAL" },
      },
      `Supplementary Control ${code} created and mapped to ${row.code}`,
    );
  }

  function accept(notice: string) {
    const text = justification.trim();
    if (!text) {
      setError("A justification is required");
      justRef.current?.focus();
      return;
    }
    void run({ path: `${base}/gap-acceptance`, method: "PUT", body: { justification: text } }, notice);
  }

  const suggestions = canCurate && row.state !== "COVERED" ? suggestControls(row, rows, controls) : [];
  const systems = framework.systems;

  return createPortal(
    <div className="sc-drawer-root cv-drawer-root">
      <div className="sc-scrim" data-testid="coverage-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={asideRef} className="sc-drawer cv-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={keepFocusInside}>
        <header>
          <button ref={closeRef} type="button" className="hc-btn ghost sc-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <span className="sc-eyebrow">{row.section}</span>
          <h2 id={titleId}>
            <span className="cv-dcode">{row.code}</span> {row.title}
          </h2>
          <div className="sc-dmeta">
            <StatusChip tone={STATE_TONE[row.state]}>{COVERAGE_STATE_LABEL[row.state]}</StatusChip>
            <span className="sc-faint">{whyText(row)}</span>
          </div>
        </header>

        <div className="sc-dbody">
          {error && (
            <p role="alert" className="sc-err">
              {error}
            </p>
          )}

          <section className="sc-dsec" aria-label="Mapped Controls">
            <h3>Mapped Controls</h3>
            {row.mappings.length === 0 ? (
              <span className="cv-nomap">No Control mapped</span>
            ) : (
              <ul className="cv-mlist">
                {row.mappings.map((mapping) => (
                  <li key={mapping.id} className="cv-mrow">
                    <ControlChip mapping={mapping} />
                    {canCurate && (
                      <>
                        <span className="cv-seg" role="group" aria-label={`Coverage of ${mapping.code}`}>
                          <button type="button" data-cov="FULL" aria-pressed={mapping.coverage === "FULL"} disabled={working} onClick={() => setCoverage(mapping, "FULL")}>
                            Full
                          </button>
                          <button type="button" data-cov="PARTIAL" aria-pressed={mapping.coverage === "PARTIAL"} disabled={working} onClick={() => setCoverage(mapping, "PARTIAL")}>
                            Partial
                          </button>
                        </span>
                        <button type="button" className="cv-x" aria-label={`Remove mapping to ${mapping.code}`} disabled={working} onClick={() => removeMapping(mapping)}>
                          ×
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canCurate && (
              <>
                <div className="cv-addmap">
                  <input
                    ref={mapRef}
                    list={`${titleId}-controls`}
                    placeholder="Map a Control: code or title"
                    aria-label="Control to map"
                    autoComplete="off"
                    value={mapInput}
                    onChange={(event) => setMapInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        submitMapping();
                      }
                    }}
                  />
                  <select aria-label="Coverage" value={mapCoverage} onChange={(event) => setMapCoverage(event.target.value as "FULL" | "PARTIAL")}>
                    <option value="FULL">Full</option>
                    <option value="PARTIAL">Partial</option>
                  </select>
                  <button type="button" className="hc-btn" disabled={working} onClick={submitMapping}>
                    Map
                  </button>
                </div>
                <datalist id={`${titleId}-controls`}>
                  {controls.map((control) => (
                    <option key={control.id} value={control.code}>
                      {control.title}
                    </option>
                  ))}
                </datalist>
                {suggestions.length > 0 && (
                  <div className="cv-sugs" aria-label="Suggested Controls">
                    <span>Suggested</span>
                    {suggestions.map((control) => (
                      <button key={control.id} type="button" title="Map as Full" disabled={working} onClick={() => void addMapping(control, "FULL")}>
                        <b>{control.code}</b> {control.title}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {row.state === "ACCEPTED_GAP" && (
            <section className="sc-dsec" aria-label="Accepted gap">
              <h3>Accepted gap</h3>
              <div className="cv-accbox">
                <p>{row.justification}</p>
                <small>
                  Accepted by {row.acceptedBy ?? "—"} on {row.acceptedAt ? formatDate(row.acceptedAt) : "—"}. Counts as resolved; a Full mapping ends the acceptance.
                </small>
              </div>
              {canCurate && (
                <>
                  <label className="sc-field">
                    <span>Justification</span>
                    <textarea ref={justRef} rows={3} value={justification} onChange={(event) => setJustification(event.target.value)} />
                  </label>
                  <div className="cv-rowb">
                    <button type="button" className="hc-btn danger" disabled={working} onClick={() => void run({ path: `${base}/gap-acceptance`, method: "DELETE" }, `${row.code} is a Coverage Gap again`)}>
                      Un-accept
                    </button>
                    <button type="button" className="hc-btn" disabled={working} onClick={() => accept(`Justification for ${row.code} saved`)}>
                      Save justification
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {row.state === "GAP" && canCurate && (
            <section className="sc-dsec" aria-label="Close the gap">
              <h3>Close the gap</h3>
              <div className="cv-way">
                <b>Create a Supplementary Control</b>
                <p>A new Control with {framework.name} as its origin and a Full mapping to this Requirement.</p>
                <label className="sc-field">
                  <span>Code</span>
                  <input value={supCode} onChange={(event) => setSupCode(event.target.value)} />
                </label>
                <label className="sc-field">
                  <span>Title</span>
                  <input ref={supTitleRef} value={supTitle} onChange={(event) => setSupTitle(event.target.value)} />
                </label>
                <div>
                  <button type="button" className="hc-btn primary" disabled={working} onClick={createSupplementary}>
                    Create and map
                  </button>
                </div>
              </div>
              <div className="cv-way">
                <b>Accept the gap</b>
                <p>Record why no Control is needed. It stays a gap but counts as resolved.</p>
                <div className="cv-tpls">
                  {ACCEPT_TEMPLATES.map((template) => (
                    <button
                      key={template}
                      type="button"
                      onClick={() => {
                        setJustification(template);
                        justRef.current?.focus();
                      }}
                    >
                      {template.replace(/[: ]+$/, "")}…
                    </button>
                  ))}
                </div>
                <label className="sc-field">
                  <span>Justification</span>
                  <textarea ref={justRef} rows={3} placeholder="Why this Requirement needs no Control" value={justification} onChange={(event) => setJustification(event.target.value)} />
                </label>
                <div>
                  <button type="button" className="hc-btn" disabled={working} onClick={() => accept(`${row.code} accepted`)}>
                    Accept gap
                  </button>
                </div>
              </div>
            </section>
          )}

          {!canCurate && (
            <p className="cv-note">Only a Compliance Manager or an Admin changes mappings and gaps.</p>
          )}

          <section className="sc-dsec" aria-label="Effect on Systems">
            <h3>Effect on Systems</h3>
            <p className="sc-faint">
              {systems === null
                ? `${frameworkLabel(framework)} is a Draft, so this Requirement reaches no System until it is published.`
                : `Derived live on the ${systems === 1 ? "1 System" : `${systems} Systems`} you can see that ${systems === 1 ? "has" : "have"} ${frameworkLabel(framework)} in scope: Met when every mapped Control that counts for the System is effectively fulfilled.`}
            </p>
          </section>
        </div>

        <footer className="cv-dfoot">
          <button type="button" className="hc-btn" onClick={() => onStep(-1)}>
            ↑ Previous
          </button>
          <button type="button" className="hc-btn" onClick={() => onStep(1)}>
            Next ↓
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}

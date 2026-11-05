"use client";

import Link from "next/link";
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { SensitivityChip } from "@/components/SensitivityChip";
import { APPLICABILITY_LABEL } from "@/lib/statement-of-applicability-rules";
import "@/app/systems/[id]/system-cockpit.css";
import "./library.css";
import { controlEditHref, controlHref } from "./[code]/control-page-logic";
import { impactLabel, mappingsByFramework, plural, statusLabelOf } from "./library-logic";
import { OwnerCell, StatusDot } from "./library-parts";
import type { LibraryRow } from "./library-types";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The Control drawer of the Control Library (design proposal A "Workbench", issue #313): one Control at a time,
 * opened from a row, the Ctrl+K palette or the URL hash `#<code>`. It shows what the Control is, who owns it, its
 * scope and the actual Requirements it satisfies, grouped by Framework with their coverage. A Draft Framework
 * appears only if the server sent it, which it does only to a role that sees Drafts.
 *
 * A modal dialog like the Statement of Applicability's drawer: Escape, the close button and the scrim close it,
 * Tab stays inside it, j / k and the arrow keys step to the next and previous Control in the table's view while
 * no field has focus, and the page behind does not scroll.
 */
export function LibraryDrawer({
  row,
  canEdit,
  position,
  onClose,
  onStep,
}: {
  row: LibraryRow;
  canEdit: boolean;
  /** "3 of 41": where the Control is among the rows in view; empty when it is not in view. */
  position: string;
  onClose: () => void;
  /** Previous (-1) or next (1) Control in the table's current view. */
  onStep: (delta: -1 | 1) => void;
}) {
  const titleId = useId();
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeNow = useRef(onClose);
  const stepNow = useRef(onStep);
  useEffect(() => {
    closeNow.current = onClose;
    stepNow.current = onStep;
  });

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (event.key === "Escape") {
        if (target === document.body || (target instanceof Node && asideRef.current?.contains(target))) closeNow.current();
        return;
      }
      const typing = target instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        stepNow.current(1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        stepNow.current(-1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, []);

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

  const groups = mappingsByFramework(row);
  const perSystem = row.applicability !== "ORGANIZATIONAL";

  return createPortal(
    <div className="sc-drawer-root cl-drawer-root">
      <div className="sc-scrim" data-testid="library-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={asideRef} className="sc-drawer cl-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={keepFocusInside}>
        <header>
          <button ref={closeRef} type="button" className="hc-btn ghost sc-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <span className="sc-eyebrow">
            <span className="cl-dcode">{row.code}</span>
            {position && <span className="cl-pos"> · {position}</span>}
          </span>
          <h2 id={titleId}>{row.title}</h2>
          <div className="sc-dmeta">
            <span className={`cl-chip ${row.applicability === "BOTH" ? "both" : row.applicability === "ORGANIZATIONAL" ? "org" : ""}`}>{APPLICABILITY_LABEL[row.applicability]}</span>
            {row.source.kind === "supplementary" && (
              <span className="cl-chip sup">
                {row.source.label}
                {row.source.draft ? " (Draft Framework)" : ""}
              </span>
            )}
            {!row.mandatory && <span className="cl-chip">Not mandatory</span>}
            {row.minSensitivityLevel !== null && <SensitivityChip level={row.minSensitivityLevel} label={row.minSensitivityLabel ?? undefined} size="sm" />}
          </div>
        </header>

        <div className="sc-dbody">
          <p>{row.description}</p>

          {(row.question || row.intent || row.examples.length > 0) && (
            <section className="sc-dsec" aria-label="Self-assessment question">
              <h3>Self-assessment question</h3>
              {row.question && <p className="cl-question">{row.question}</p>}
              {row.intent && (
                <p className="cl-faint">
                  <b>Intent:</b> {row.intent}
                </p>
              )}
              {row.examples.length > 0 && (
                <ul aria-label={`Examples for ${row.code}`} className="cl-examples">
                  {row.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="sc-dsec" aria-label="Ownership">
            <h3>Ownership</h3>
            <dl className="cl-kv">
              <dt>Control Owner</dt>
              <dd>
                <OwnerCell name={row.ownerName} />
              </dd>
              <dt>Organization status</dt>
              <dd>
                {row.orgStatus ? (
                  <span className="cl-st">
                    <StatusDot status={row.orgStatus} />
                    {statusLabelOf(row)}
                  </span>
                ) : (
                  <span className="cl-faint">Per System only</span>
                )}
              </dd>
              {perSystem && (
                <>
                  <dt>Applies to</dt>
                  <dd>{plural(row.systemCount, "System")}</dd>
                </>
              )}
            </dl>
          </section>

          <section className="sc-dsec" aria-label="Scope">
            <h3>Scope</h3>
            <dl className="cl-kv">
              <dt>Category</dt>
              <dd>{row.category}</dd>
              <dt>Deployment Facets</dt>
              <dd>{row.deploymentFacets.length > 0 ? row.deploymentFacets.join(", ") : <span className="cl-faint">Any</span>}</dd>
              <dt>Sensitivity Level</dt>
              <dd>
                {row.minSensitivityLevel === null ? (
                  <span className="cl-faint">None</span>
                ) : (
                  <span className="cl-st">
                    From <SensitivityChip level={row.minSensitivityLevel} label={row.minSensitivityLabel ?? undefined} size="sm" />
                  </span>
                )}
              </dd>
              <dt>Minimum Integrity</dt>
              <dd>{row.minIntegrityImpactLevel ? impactLabel(row.minIntegrityImpactLevel) : <span className="cl-faint">None</span>}</dd>
              <dt>Minimum Availability</dt>
              <dd>{row.minAvailabilityImpactLevel ? impactLabel(row.minAvailabilityImpactLevel) : <span className="cl-faint">None</span>}</dd>
            </dl>
          </section>

          <section className="sc-dsec" aria-label="Satisfies">
            <h3>Satisfies</h3>
            {groups.length === 0 ? (
              <p>
                <span className="cl-chip warn">Not mapped to any Requirement</span>
              </p>
            ) : (
              <div className="cl-fws">
                {groups.map((group) => (
                  <div key={group.framework.id} className="cl-fw">
                    <h4>
                      {group.framework.label}
                      {group.draft && <span className="cl-chip draft">Draft Framework</span>}
                    </h4>
                    <ul aria-label={`Requirements in ${group.framework.label}`}>
                      {group.mappings.map((mapping) => (
                        <li key={mapping.id}>
                          <span className="cl-rcode">{mapping.requirementCode}</span>
                          <span className="cl-rtitle">{mapping.requirementTitle}</span>
                          <span className={`cl-cov ${mapping.coverage === "FULL" ? "full" : "partial"}`}>{mapping.coverage === "FULL" ? "Full" : "Partial"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="cl-dfoot">
          <span className="cl-dact">
            {canEdit && (
              <Link href={controlEditHref(row.code)} className="hc-btn" title={`Edit ${row.code}`}>
                Edit
              </Link>
            )}
            <Link href={controlHref(row.code)} className="hc-btn" data-slot="open-full-page">
              Open full page →
            </Link>
          </span>
          <span className="cl-dnav">
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

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { frameworkLabel } from "@/lib/framework-label";
import { unmappedGaps } from "./frameworks-logic";
import type { CatalogRow } from "./frameworks-types";

/**
 * "Publish <Framework>?" from a Draft's row (product-owner decision 3a on #266). It says what publishing does:
 * the open Coverage Gaps become Not Met on every System that declares the Framework, its Supplementary Controls
 * reach Systems, and its Review Group gets a Review Step. Publishing is one-way, through the existing
 * `POST /api/frameworks/[id]/publish`; the caller refreshes the page data in `onDone`.
 */
export function PublishFrameworkDialog({ row, onClose, onDone }: { row: CatalogRow; onClose: () => void; onDone: () => void }) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = frameworkLabel(row);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    // A browser opens it as a modal; jsdom has no showModal, so it falls back to a plain open dialog.
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }, []);

  async function publish() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/frameworks/${row.id}/publish`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Failed to publish the Framework");
        return;
      }
      onDone();
    } catch {
      setError("Failed to publish the Framework");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="fc-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself.
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="in">
        <h2 id={titleId}>Publish {label}?</h2>
        <p className="muted">
          Publishing makes its {row.requirements} {row.requirements === 1 ? "Requirement" : "Requirements"} count on every System that
          declares it in its Framework Scope. It can&apos;t be undone.
        </p>
        <ul>
          {row.gaps > 0 ? (
            <li>
              <b className="bad">
                {row.gaps} Coverage {row.gaps === 1 ? "Gap is" : "Gaps are"}
              </b>{" "}
              still open.
              {unmappedGaps(row) > 0 &&
                ` ${unmappedGaps(row)} with no Control Mapping will be Not Met on every System.`}
              {row.partialOnly > 0 &&
                ` ${row.partialOnly} with Partial mappings only can't be Met: at best Partially Met, depending on each System's Control statuses.`}
            </li>
          ) : (
            <li>Every Requirement is covered or accepted.</li>
          )}
          {row.supplementary > 0 && (
            <li>
              {row.supplementary} Supplementary {row.supplementary === 1 ? "Control" : "Controls"} authored for it reach Systems now.
            </li>
          )}
          {row.reviewGroup && <li>{row.reviewGroup} gets a Review Step on Systems in review.</li>}
        </ul>
        {error && (
          <p role="alert" className="bad">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="hc-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="hc-btn primary" onClick={publish} disabled={busy}>
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

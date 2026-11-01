"use client";

import { useId, useState, type FormEvent } from "react";
import type { ControlAssessmentStatus } from "@prisma/client";
import { ORGANIZATION_BULK_MAX_CONTROLS, bulkLimitMessage, implementationDescriptionRefusal } from "@/lib/organization-implementation-rules";
import { STATUS_LABEL, STATUS_ORDER, needsReason } from "./controls-logic";
import type { OrgControlRow } from "./controls-types";

/** What `PATCH /api/organization/controls` returns for each saved Control (the part the page needs). */
export type SavedControl = {
  id: string;
  implementation: { status: ControlAssessmentStatus; description: string | null; updatedBy: { name: string } | null; updatedAt: string | null };
};

/**
 * The bulk "Set status…" dialog (design proposal A "Implementation register", issue #284, decision 2a): one
 * status for every selected Control, and a description that replaces each Control's own, or keeps it when
 * left empty. Waived and Not Applicable need the description (the reason). Saved through
 * `PATCH /api/organization/controls`, which is all-or-nothing; a refusal is shown with the Controls it names.
 */
export function BulkStatusDialog({
  rows,
  onClose,
  onDone,
}: {
  rows: OrgControlRow[];
  onClose: () => void;
  onDone: (saved: SavedControl[], status: ControlAssessmentStatus) => void;
}) {
  const titleId = useId();
  const [status, setStatus] = useState<ControlAssessmentStatus>("IN_PROGRESS");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tooMany = rows.length > ORGANIZATION_BULK_MAX_CONTROLS;
  const refusal = needsReason(status) ? implementationDescriptionRefusal(status, description) : null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (tooMany || refusal || saving) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/organization/controls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlIds: rows.map((row) => row.id), status, ...(description.trim() && { description: description.trim() }) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const codes = ((body.refusedIds ?? []) as string[]).map((id) => rows.find((row) => row.id === id)?.code ?? id).join(", ");
        setError(`${typeof body.error === "string" ? body.error : "The status could not be set"}${codes ? `: ${codes}` : ""}`);
        return;
      }
      onDone(body.controls as SavedControl[], status);
    } catch {
      setError("The status could not be set");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={save}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="fixed left-1/2 top-[12vh] z-[51] flex max-h-[76vh] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-3 overflow-y-auto rounded-2xl border border-rg-line bg-rg-surface p-5 text-sm text-rg-ink shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Set the status of {rows.length} {rows.length === 1 ? "Control" : "Controls"}
        </h2>
        <p className="max-h-24 shrink-0 overflow-y-auto text-rg-muted">{rows.map((row) => row.code).join(", ")}</p>
        <label className="flex flex-col gap-1">
          Status
          <select
            className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2"
            value={status}
            autoFocus
            onChange={(event) => setStatus(event.target.value as ControlAssessmentStatus)}
          >
            {STATUS_ORDER.map((option) => (
              <option key={option} value={option}>
                {STATUS_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>
            Description <span className="text-rg-muted">{needsReason(status) ? "(required: the reason)" : "(kept as is when empty)"}</span>
          </span>
          <textarea
            className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2"
            rows={3}
            value={description}
            placeholder="Replaces each Control's description"
            aria-invalid={refusal ? true : undefined}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {tooMany && (
          <p role="alert" className="text-rg-danger">
            {bulkLimitMessage(rows.length)}
          </p>
        )}
        {refusal && <p className="font-semibold text-rg-gold-ink">{refusal}</p>}
        {error && (
          <p role="alert" className="text-rg-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="hc-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="hc-btn primary" disabled={tooMany || !!refusal || saving}>
            {saving ? "Applying…" : `Apply to ${rows.length}`}
          </button>
        </div>
      </form>
    </>
  );
}

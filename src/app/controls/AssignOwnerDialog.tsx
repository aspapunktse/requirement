"use client";

import { useId, useState, type FormEvent } from "react";
import { CONTROL_BULK_OWNER_MAX, controlBulkLimitMessage } from "@/lib/control-bulk-rules";
import type { LibraryRow } from "./library-types";

/** What `PATCH /api/controls` returns for each Control (the part the page needs). */
export type OwnedControl = { id: string; owner: { id: string; name: string } | null };

const UNASSIGNED = "__none__";

/**
 * The bulk "Assign owner…" dialog (design proposal A "Workbench", issue #313): one Control Owner, or Unassigned,
 * for every selected Control. Saved through `PATCH /api/controls`, which is all or nothing; a refusal is shown
 * and nothing on the page changes. `owners` is the list the server built from the Users who may own a Control.
 */
export function AssignOwnerDialog({
  rows,
  owners,
  onClose,
  onDone,
}: {
  rows: LibraryRow[];
  owners: { id: string; name: string }[];
  onClose: () => void;
  onDone: (saved: OwnedControl[], ownerName: string | null) => void;
}) {
  const titleId = useId();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tooMany = rows.length > CONTROL_BULK_OWNER_MAX;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (tooMany || choice === "" || saving) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/controls", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlIds: rows.map((row) => row.id), ownerId: choice === UNASSIGNED ? null : choice }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const codes = ((body.missingIds ?? []) as string[]).map((id) => rows.find((row) => row.id === id)?.code ?? id).join(", ");
        setError(`${typeof body.error === "string" ? body.error : "The Control Owner could not be assigned"}${codes ? `: ${codes}` : ""}`);
        return;
      }
      onDone(body.controls as OwnedControl[], choice === UNASSIGNED ? null : (owners.find((owner) => owner.id === choice)?.name ?? null));
    } catch {
      setError("The Control Owner could not be assigned");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-rg-scrim" onClick={onClose} aria-hidden="true" />
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
          Assign a Control Owner to {rows.length} {rows.length === 1 ? "Control" : "Controls"}
        </h2>
        <p className="max-h-24 shrink-0 overflow-y-auto text-rg-muted">{rows.map((row) => row.code).join(", ")}</p>
        <label className="flex flex-col gap-1">
          Control Owner
          <select
            className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2"
            value={choice}
            autoFocus
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="" disabled>
              Choose a Control Owner…
            </option>
            <option value={UNASSIGNED}>Unassigned (clear the Control Owner)</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-rg-muted">It replaces each selected Control&rsquo;s current Control Owner.</p>
        {tooMany && (
          <p role="alert" className="text-rg-danger">
            {controlBulkLimitMessage(rows.length)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-rg-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="hc-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="hc-btn primary" disabled={tooMany || choice === "" || saving}>
            {saving ? "Applying…" : `Apply to ${rows.length}`}
          </button>
        </div>
      </form>
    </>
  );
}

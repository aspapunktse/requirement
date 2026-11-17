"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Reopen a System closed as Not selected (#376, ADR 0015), from its page: an Admin only, with a required comment. `POST
 * /api/systems/[id]/reopen`; the route applies the rules again. The System returns to Draft at the stage it was in, with its Assessments,
 * Risks and documents as they were.
 */
export function ReopenNotSelectedDialog({ systemId, systemName, onClose, onDone }: { systemId: string; systemName: string; onClose: () => void; onDone: () => void }) {
  const titleId = useId();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return setError("A comment is required");
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/reopen`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment }) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Failed to reopen the System");
        return;
      }
      onDone();
    } catch {
      setError("Failed to reopen the System");
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
          Reopen {systemName}
        </h2>
        <p className="text-rg-muted">
          The System returns to Draft at the stage it was in, with its Assessments, Risks and documents as they were. Its applicable Controls are recomputed, since the catalogue may have changed while it was closed.
        </p>
        {error && (
          <p role="alert" className="text-rg-danger">
            {error}
          </p>
        )}
        <label className="flex flex-col gap-1 font-semibold">
          Comment (required)
          <textarea autoFocus rows={4} className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 font-normal" value={comment} onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Reopening…" : "Reopen"}
          </Button>
        </div>
      </form>
    </>
  );
}

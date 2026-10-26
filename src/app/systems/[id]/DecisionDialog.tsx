"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { DecisionStep } from "./system-page-types";

/**
 * Approve or reject a System from its header (#243). It records the decision the way the Approval and
 * activity tab's panel does: `POST /api/systems/[id]/approvals` with the decision, a comment and the
 * Review Step, so the API's own rule (`canDecideStep`) is the only authority. `steps` are the open
 * steps the acting user may decide; with more than one (an Admin), the dialog asks which.
 */
export function DecisionDialog({
  systemId,
  systemName,
  decision,
  steps,
  onClose,
  onDone,
}: {
  systemId: string;
  systemName: string;
  decision: "APPROVED" | "REJECTED";
  steps: DecisionStep[];
  onClose: () => void;
  onDone: () => void;
}) {
  const titleId = useId();
  const [stepKey, setStepKey] = useState(steps[0] ? (steps[0].reviewGroupId ?? "") : "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const approving = decision === "APPROVED";

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!comment.trim()) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment, reviewGroupId: stepKey === "" ? null : stepKey }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Failed to record the decision");
        return;
      }
      onDone();
    } catch {
      setError("Failed to record the decision");
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
          {approving ? "Approve" : "Reject"} {systemName}
        </h2>
        <p className="text-rg-muted">
          {approving
            ? "Record your approval. The System becomes Approved once every Review Step has approved."
            : "Rejecting returns the System to Draft at once and cancels the other open Review Steps."}
        </p>
        {error && (
          <p role="alert" className="text-rg-danger">
            {error}
          </p>
        )}
        {steps.length > 1 && (
          <label className="flex flex-col gap-1">
            Review Step
            <select
              className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2"
              value={stepKey}
              onChange={(event) => setStepKey(event.target.value)}
            >
              {steps.map((step) => (
                <option key={step.reviewGroupId ?? "base"} value={step.reviewGroupId ?? ""}>
                  {step.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {steps.length === 1 && <p>Review Step: {steps[0].name}</p>}
        <label className="flex flex-col gap-1">
          Comment
          <textarea
            autoFocus
            required
            rows={4}
            className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || !comment.trim()}>
            {approving ? "Approve" : "Reject"}
          </Button>
        </div>
      </form>
    </>
  );
}

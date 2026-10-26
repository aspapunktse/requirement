"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";

type DraftAudit = { id: string; title: string; dueDate: string; systemCount: number };
type Result = { audit: DraftAudit; added: number; skipped: number };

/**
 * The picker for adding the selected Systems to a Draft Internal Audit (#234), opened from the Systems
 * list's bulk bar for an Internal Auditor. Lists only Draft audits (`GET /api/internal-audits`); saves
 * through `POST /api/internal-audits/[id]/systems`, which keeps the Systems the audit already has and
 * reports how many were new. After a save the dialog shows the outcome and a link to the audit;
 * `onDone` (close, clear the selection) is called when the user dismisses it.
 */
export function AddToInternalAuditDialog({
  systems,
  onClose,
  onDone,
}: {
  systems: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const titleId = useId();
  const [audits, setAudits] = useState<DraftAudit[] | null>(null);
  const [auditId, setAuditId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/internal-audits")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(body.error ?? "Failed to load the Internal Audits");
        else {
          const all = (body.internalAudits ?? []) as (DraftAudit & { status: string })[];
          setAudits(all.filter((audit) => audit.status === "DRAFT"));
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the Internal Audits");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const audit = audits?.find((candidate) => candidate.id === auditId);
    if (!audit || saving) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/internal-audits/${audit.id}/systems`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemIds: systems.map((system) => system.id) }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Failed to add the Systems to the Internal Audit");
        return;
      }
      setResult({ audit, added: body.added ?? 0, skipped: body.skipped ?? 0 });
    } catch {
      setError("Failed to add the Systems to the Internal Audit");
    } finally {
      setSaving(false);
    }
  }

  const noun = (n: number) => (n === 1 ? "System" : "Systems");
  const dismiss = result ? onDone : onClose;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={dismiss} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={save}
        onKeyDown={(event) => {
          if (event.key === "Escape") dismiss();
        }}
        className="fixed left-1/2 top-[12vh] z-[51] flex max-h-[76vh] w-[min(480px,calc(100vw-32px))] overflow-y-auto -translate-x-1/2 flex-col gap-3 rounded-2xl border border-rg-line bg-rg-surface p-5 text-sm text-rg-ink shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Add to Internal Audit
        </h2>
        <p className="max-h-32 shrink-0 overflow-y-auto text-rg-muted">
          {systems.length} {noun(systems.length)}: {systems.map((system) => system.name).join(", ")}
        </p>

        {result ? (
          <>
            <p role="status">
              Added {result.added} {noun(result.added)} to {result.audit.title}
              {result.skipped > 0 ? `; ${result.skipped} ${result.skipped === 1 ? "was" : "were"} already in it` : ""}.
            </p>
            <div className="flex justify-end gap-2">
              <Link href={`/internal-audits/${result.audit.id}`} className="self-center text-rg-accent underline">
                Open the Internal Audit
              </Link>
              <Button variant="primary" onClick={onDone}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-rg-danger">
                {error}
              </p>
            )}
            {audits === null && !error && <p className="text-rg-muted">Loading…</p>}
            {audits !== null && audits.length === 0 && (
              <p className="text-rg-muted">
                There is no Draft Internal Audit to add to. Only a Draft can take more Systems.{" "}
                <Link href="/internal-audits/new" className="text-rg-accent underline">
                  Create an Internal Audit
                </Link>
              </p>
            )}
            {audits !== null && audits.length > 0 && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1">Draft Internal Audit</legend>
                {audits.map((audit) => (
                  <label key={audit.id} className="flex items-start gap-2 rounded-[var(--rg-radius-md)] border border-rg-line p-2">
                    <input type="radio" name="internal-audit" value={audit.id} checked={auditId === audit.id} onChange={() => setAuditId(audit.id)} />
                    <span>
                      {audit.title}
                      <span className="block text-rg-muted">
                        Due {audit.dueDate} · {audit.systemCount} {noun(audit.systemCount)} now
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving || !auditId}>
                Add to audit
              </Button>
            </div>
          </>
        )}
      </form>
    </>
  );
}

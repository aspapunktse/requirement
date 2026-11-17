"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";

type Open = { id: string; name: string; candidateCount: number };
type Failure = { systemId: string; error: string };
type Done = { id: string; name: string; added: number };

const NEW = "new";

/**
 * "Add to Comparison" on the Systems list's bulk bar (#374): the selected Systems become Candidates of an open Comparison the
 * acting user may add to (`GET /api/comparisons`: open, with room, and the owner, an Admin or a participant), or of a new one
 * made here. All or nothing: when any selected System can't be added, none is, and the dialog lists which and why (the 409's
 * `failures`); the server applies the rules, so this only shows its answer. `onDone` (close, clear the selection) is called when the
 * user dismisses the dialog after a save.
 */
export function AddToComparisonDialog({
  systems,
  canCreateComparison,
  onClose,
  onDone,
}: {
  systems: { id: string; name: string }[];
  /** A role that may create a Comparison (the same ones that may create a System); the server checks it again. */
  canCreateComparison: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const titleId = useId();
  const [comparisons, setComparisons] = useState<Open[] | null>(null);
  const [pick, setPick] = useState("");
  const [name, setName] = useState("");
  const [need, setNeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Done | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/comparisons")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(typeof body?.error === "string" ? body.error : "Failed to load the Comparisons");
        else {
          const all = (body.comparisons ?? []) as (Open & { closed: boolean; canAddCandidate: boolean })[];
          setComparisons(all.filter((comparison) => !comparison.closed && comparison.canAddCandidate));
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the Comparisons");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const creating = pick === NEW;
  const ready = pick !== "" && (!creating || name.trim() !== "");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || saving) return;
    setError(null);
    setFailures([]);
    setSaving(true);
    const systemIds = systems.map((system) => system.id);
    try {
      const response = creating
        ? await fetch("/api/comparisons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), need: need.trim() || undefined, systemIds }) })
        : await fetch(`/api/comparisons/${pick}/candidates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemIds }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body?.error === "string" ? body.error : "Failed to add the Systems to the Comparison");
        setFailures(Array.isArray(body?.failures) ? body.failures : []);
        return;
      }
      const target = creating ? { id: body.comparison.id as string, name: body.comparison.name as string } : (comparisons?.find((comparison) => comparison.id === pick) ?? { id: pick, name: "the Comparison" });
      setResult({ ...target, added: systems.length });
    } catch {
      setError("Failed to add the Systems to the Comparison");
    } finally {
      setSaving(false);
    }
  }

  const noun = (n: number) => (n === 1 ? "System" : "Systems");
  const nameOf = (systemId: string) => systems.find((system) => system.id === systemId)?.name ?? "A System you can't open";
  const dismiss = result ? onDone : onClose;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-rg-scrim" onClick={dismiss} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={save}
        onKeyDown={(event) => {
          if (event.key === "Escape") dismiss();
        }}
        className="fixed left-1/2 top-[12vh] z-[51] flex max-h-[76vh] w-[min(520px,calc(100vw-32px))] overflow-y-auto -translate-x-1/2 flex-col gap-3 rounded-2xl border border-rg-line bg-rg-surface p-5 text-sm text-rg-ink shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Add to Comparison
        </h2>
        <p className="max-h-32 shrink-0 overflow-y-auto text-rg-muted">
          {systems.length} {noun(systems.length)}: {systems.map((system) => system.name).join(", ")}
        </p>

        {result ? (
          <>
            <p role="status">
              Added {result.added} {noun(result.added)} to {result.name} as Candidates.
            </p>
            <div className="flex justify-end gap-2">
              <Link href={`/comparisons/${result.id}`} className="self-center text-rg-accent underline">
                Open the Comparison
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
            {failures.length > 0 && (
              <ul className="grid gap-1 text-rg-danger" aria-label="Systems that can't be added">
                {failures.map((failure) => (
                  <li key={failure.systemId}>
                    <b>{nameOf(failure.systemId)}</b>: {failure.error}
                  </li>
                ))}
              </ul>
            )}
            {comparisons === null && !error && <p className="text-rg-muted">Loading…</p>}
            {comparisons !== null && (
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1">Comparison</legend>
                {comparisons.length === 0 && <p className="text-rg-muted">There is no open Comparison you can add to.{canCreateComparison ? " Create one below." : ""}</p>}
                {comparisons.map((comparison) => (
                  <label key={comparison.id} className="flex items-start gap-2 rounded-[var(--rg-radius-md)] border border-rg-line p-2">
                    <input type="radio" name="comparison" value={comparison.id} checked={pick === comparison.id} onChange={() => setPick(comparison.id)} />
                    <span>
                      {comparison.name}
                      <span className="block text-rg-muted">
                        {comparison.candidateCount} {comparison.candidateCount === 1 ? "Candidate" : "Candidates"} now
                      </span>
                    </span>
                  </label>
                ))}
                {canCreateComparison && (
                  <label className="flex items-start gap-2 rounded-[var(--rg-radius-md)] border border-rg-line p-2">
                    <input type="radio" name="comparison" value={NEW} checked={creating} onChange={() => setPick(NEW)} />
                    <span>A new Comparison</span>
                  </label>
                )}
              </fieldset>
            )}
            {creating && (
              <>
                <label className="flex flex-col gap-1 font-semibold">
                  Name
                  <input className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 font-normal" value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="New HR system 2027" />
                </label>
                <label className="flex flex-col gap-1 font-semibold">
                  Need
                  <textarea className="min-h-20 rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 font-normal" value={need} maxLength={5000} onChange={(event) => setNeed(event.target.value)} placeholder="What the Candidates are meant to meet" />
                </label>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving || !ready}>
                {saving ? "Adding…" : "Add to Comparison"}
              </Button>
            </div>
          </>
        )}
      </form>
    </>
  );
}

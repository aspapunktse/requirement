"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { FIELD, Shell, send } from "./ComparisonDialogs";

type Addable = { id: string; name: string; vendor: string | null; owner: { id: string; name: string }; stage: string | null; reason: string | null };
type Loaded = { systems: Addable[]; full: boolean; stagedEvaluation: boolean; canCreateSystem: boolean };

/** Why "Create a new System" is not offered, or null when it is. */
function createRefusal(loaded: Loaded): string | null {
  if (!loaded.canCreateSystem) return "Only a System Owner, Risk Owner or Admin can create a System.";
  if (!loaded.stagedEvaluation) return "Staged evaluation for new Systems is off, so a new System would not be staged and can't be a Candidate. An Admin can switch it on in Settings.";
  return null;
}

/**
 * Add Candidate (#374), design proposal B: pick one of the Systems the acting user may add (`GET /api/comparisons/[id]/candidates`:
 * the owner's Systems they see, a participant's own, an Admin's all), or choose "Create a new System", which opens the onboarding
 * interview with this Comparison carried along. A System that can't be added now stays in the list, greyed, with the reason
 * (not staged, closed, already a Candidate). Saves through `POST /api/comparisons/[id]/candidates`; the server applies the rules again.
 */
export function AddCandidateDialog({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const titleId = useId();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/comparisons/${id}/candidates`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setLoadError(typeof body?.error === "string" ? body.error : "Failed to load the Systems");
        else setLoaded(body as Loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load the Systems");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Systems that can be added first, then the ones that can't, each group by name (the server sends it that way; kept here too).
    const byName = (a: Addable, b: Addable) => a.name.localeCompare(b.name);
    const all = [...(loaded?.systems ?? [])];
    all.sort((a, b) => Number(a.reason !== null) - Number(b.reason !== null) || byName(a, b));
    return needle === "" ? all : all.filter((system) => `${system.name} ${system.vendor ?? ""} ${system.owner.name}`.toLowerCase().includes(needle));
  }, [loaded, query]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!pick || saving) return;
    setError(null);
    setSaving(true);
    const result = await send(`/api/comparisons/${id}/candidates`, "POST", { systemId: pick });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onDone();
  }

  const refusal = loaded ? createRefusal(loaded) : null;

  return (
    <Shell title="Add Candidate" titleId={titleId} onClose={onClose} onSubmit={save}>
      <p className="text-rg-muted">Pick a System to set beside the others. A Candidate is an ordinary System: its first-round answers stay on its own page.</p>
      {(error ?? loadError) && (
        <p role="alert" className="text-rg-danger">
          {error ?? loadError}
        </p>
      )}
      {loaded === null && !loadError && <p role="status">Loading the Systems…</p>}
      {loaded && (
        <>
          {loaded.full && <p className="text-rg-danger">This Comparison already holds five Candidates, the most it can.</p>}
          <label className="flex flex-col gap-1 font-semibold">
            Find a System
            <input className={FIELD} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, vendor or owner" autoFocus />
          </label>
          <ul className="grid max-h-64 gap-1 overflow-y-auto" aria-label="Systems">
            {shown.length === 0 && <li className="text-rg-muted">{loaded.systems.length === 0 ? "You have no Systems to add." : "No System matches."}</li>}
            {shown.map((system) => (
              <li key={system.id} className="border-b border-rg-line py-1.5">
                <label className={`flex items-start gap-2 ${system.reason ? "opacity-60" : ""}`}>
                  <input type="radio" name="candidate" value={system.id} checked={pick === system.id} disabled={system.reason !== null || loaded.full} onChange={() => setPick(system.id)} className="mt-1" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{system.name}</span>
                    <small className="text-rg-muted">
                      {system.vendor ? `${system.vendor} · ` : ""}owner {system.owner.name}
                    </small>
                    {system.reason && <small className="text-rg-danger">{system.reason}</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <p className="border-t border-rg-line pt-3">
            Not in the list yet?{" "}
            {refusal ? (
              <span className="text-rg-muted" role="note">
                {refusal}
              </span>
            ) : loaded.full ? null : (
              <Link href={`/systems/new?comparison=${encodeURIComponent(id)}`} className="font-semibold underline">
                Create a new System
              </Link>
            )}
          </p>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!pick || saving}>
          {saving ? "Adding…" : "Add Candidate"}
        </Button>
      </div>
    </Shell>
  );
}

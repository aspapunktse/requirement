"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { Person } from "./comparison-types";

/** The dialogs of the Comparison pages (#373): new Comparison, edit name and need, participants, change owner, delete. Each saves through the API and reports back; the page reloads. */

type Pickable = { id: string; name: string; email: string; role: string };
export type Sent = { ok: true; body: Record<string, unknown> } | { ok: false; error: string };

/** The Register dialog shell, as the other dialogs of the app (ChangeOwnerDialog): a scrim, a labelled form, Escape closes. */
export function Shell({ title, titleId, onClose, onSubmit, children }: { title: string; titleId: string; onClose: () => void; onSubmit?: (event: FormEvent) => void; children: ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-50 bg-rg-scrim" onClick={onClose} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit ?? ((event) => event.preventDefault())}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="fixed left-1/2 top-[12vh] z-[51] flex max-h-[76vh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-3 overflow-y-auto rounded-2xl border border-rg-line bg-rg-surface p-5 text-sm text-rg-ink shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </form>
    </>
  );
}

export const FIELD = "rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 font-normal text-rg-ink";

export async function send(url: string, method: string, body?: unknown): Promise<Sent> {
  try {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: typeof json?.error === "string" ? json.error : "The change could not be saved" };
    return { ok: true, body: json };
  } catch {
    return { ok: false, error: "The change could not be saved" };
  }
}

/** Name and need: creates (`POST /api/comparisons`) or, with `comparison`, edits (`PATCH /api/comparisons/[id]`). */
export function ComparisonFormDialog({
  comparison,
  onClose,
  onDone,
}: {
  comparison?: { id: string; name: string; need: string | null };
  onClose: () => void;
  /** The saved Comparison's id. */
  onDone: (id: string) => void;
}) {
  const titleId = useId();
  const [name, setName] = useState(comparison?.name ?? "");
  const [need, setNeed] = useState(comparison?.need ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") {
      setError("A name is required");
      return;
    }
    setError(null);
    setSaving(true);
    const result = comparison ? await send(`/api/comparisons/${comparison.id}`, "PATCH", { name, need }) : await send("/api/comparisons", "POST", { name, need });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    const saved = result.body.comparison as { id: string } | undefined;
    onDone(saved?.id ?? comparison?.id ?? "");
  }

  return (
    <Shell title={comparison ? "Edit name and need" : "New Comparison"} titleId={titleId} onClose={onClose} onSubmit={save}>
      {error && (
        <p role="alert" className="text-rg-danger">
          {error}
        </p>
      )}
      <label className="flex flex-col gap-1 font-semibold">
        Name
        <input className={FIELD} value={name} maxLength={200} onChange={(event) => setName(event.target.value)} placeholder="New HR system 2027" autoFocus />
      </label>
      <label className="flex flex-col gap-1 font-semibold">
        Need
        <textarea className={`${FIELD} min-h-24`} value={need} maxLength={5000} onChange={(event) => setNeed(event.target.value)} placeholder="What the Candidates are meant to meet" />
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Saving…" : comparison ? "Save" : "Create Comparison"}
        </Button>
      </div>
    </Shell>
  );
}

/** Loads the people the owner or an Admin can pick (`GET /api/comparisons/[id]/people`). */
function usePeople(id: string) {
  const [people, setPeople] = useState<Pickable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/comparisons/${id}/people`)
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(body.error ?? "Failed to load the people");
        else setPeople(body.users ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the people");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return { people, error };
}

/** Names and removes participants (`POST` and `DELETE /api/comparisons/[id]/participants`). `onChanged` runs after each change so the page reloads behind the dialog. */
export function ParticipantsDialog({ id, owner, participants, onClose, onChanged }: { id: string; owner: Person; participants: Person[]; onClose: () => void; onChanged: () => void }) {
  const titleId = useId();
  const { people, error: loadError } = usePeople(id);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const taken = new Set([owner.id, ...participants.map((participant) => participant.id)]);

  async function change(request: Promise<Sent>) {
    setError(null);
    setBusy(true);
    const result = await request;
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setPick("");
    onChanged();
  }

  return (
    <Shell title="Participants" titleId={titleId} onClose={onClose}>
      <p className="text-rg-muted">A participant sees this Comparison and can add Systems they own as Candidates. The owner, {owner.name}, is always part of it.</p>
      {(error ?? loadError) && (
        <p role="alert" className="text-rg-danger">
          {error ?? loadError}
        </p>
      )}
      {participants.length === 0 ? (
        <p className="text-rg-muted">No participants named.</p>
      ) : (
        <ul className="grid gap-1">
          {participants.map((participant) => (
            <li key={participant.id} className="flex items-center justify-between gap-2 border-b border-rg-line py-1.5">
              <span>{participant.name}</span>
              <Button disabled={busy} aria-label={`Remove ${participant.name} as a participant`} onClick={() => change(send(`/api/comparisons/${id}/participants/${participant.id}`, "DELETE"))}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 font-semibold">
          Add a participant
          <select className={FIELD} value={pick} disabled={people === null} onChange={(event) => setPick(event.target.value)}>
            <option value="">{people === null && !loadError ? "Loading…" : "Pick a user"}</option>
            {(people ?? [])
              .filter((person) => !taken.has(person.id))
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} ({person.email})
                </option>
              ))}
          </select>
        </label>
        <Button variant="primary" disabled={busy || pick === ""} onClick={() => change(send(`/api/comparisons/${id}/participants`, "POST", { userId: pick }))}>
          Add
        </Button>
      </div>
      <div className="flex justify-end">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Shell>
  );
}

/** An Admin hands the Comparison to another owner (`PATCH /api/comparisons/[id]` with `ownerId`). */
export function ChangeComparisonOwnerDialog({ id, owner, onClose, onDone }: { id: string; owner: Person; onClose: () => void; onDone: () => void }) {
  const titleId = useId();
  const { people, error: loadError } = usePeople(id);
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!ownerId) return;
    setError(null);
    setSaving(true);
    const result = await send(`/api/comparisons/${id}`, "PATCH", { ownerId });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onDone();
  }

  return (
    <Shell title="Change owner" titleId={titleId} onClose={onClose} onSubmit={save}>
      <p className="text-rg-muted">This Comparison is owned by {owner.name}. The new owner needs a role that may create a System.</p>
      {(error ?? loadError) && (
        <p role="alert" className="text-rg-danger">
          {error ?? loadError}
        </p>
      )}
      <label className="flex flex-col gap-1 font-semibold">
        New owner
        <select className={FIELD} value={ownerId} disabled={people === null} onChange={(event) => setOwnerId(event.target.value)}>
          <option value="">{people === null && !loadError ? "Loading…" : "Pick a user"}</option>
          {(people ?? [])
            .filter((person) => person.id !== owner.id)
            .map((person) => (
              <option key={person.id} value={person.id}>
                {person.name} ({person.email})
              </option>
            ))}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!ownerId || saving}>
          {saving ? "Saving…" : "Change owner"}
        </Button>
      </div>
    </Shell>
  );
}

/** Deleting asks first: the Systems are untouched, the Candidates just leave the Comparison. */
export function DeleteComparisonDialog({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone: () => void }) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await send(`/api/comparisons/${id}`, "DELETE");
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onDone();
  }

  return (
    <Shell title="Delete this Comparison?" titleId={titleId} onClose={onClose} onSubmit={confirm}>
      <p>
        <b>{name}</b> and its list of Candidates are deleted. The Systems are not touched. This can&apos;t be undone.
      </p>
      {error && (
        <p role="alert" className="text-rg-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Deleting…" : "Delete Comparison"}
        </Button>
      </div>
    </Shell>
  );
}

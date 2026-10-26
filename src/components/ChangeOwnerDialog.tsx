"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";

export type OwnerChangeSystem = { id: string; name: string; ownerId: string; ownerName: string; canChange: boolean };
type Candidate = { id: string; name: string; email: string; role: string };

/**
 * The picker for changing the owner of one or several Systems (#233), shared by the System page and the
 * Systems list's bulk bar. Loads the eligible new owners (System-creating roles) from
 * `/api/systems/owner-candidates` and saves through `POST /api/systems/owner`, which is all-or-nothing:
 * if the selection holds a System the acting user may not change, the dialog says so up front and
 * can't be saved, instead of failing with a 403 afterwards.
 */
export function ChangeOwnerDialog({
  systems,
  actor,
  onClose,
  onDone,
}: {
  systems: OwnerChangeSystem[];
  /** The acting user: a non-Admin handing their own Systems away loses the right to change them. */
  actor: { id: string; role: string };
  onClose: () => void;
  /** Called after a successful save, with the Systems that actually changed owner, and whether the actor just handed one of their own away without being an Admin. */
  onDone: (
    result: { changed: { id: string; name: string }[]; unchanged: { id: string; name: string }[] },
    handedAway: boolean,
  ) => void;
}) {
  const titleId = useId();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refused = systems.filter((system) => !system.canChange);
  const unchanged = ownerId ? systems.filter((system) => system.ownerId === ownerId) : [];
  const losing = actor.role !== "ADMIN" && ownerId !== "" && ownerId !== actor.id ? systems.filter((system) => system.ownerId === actor.id) : [];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/systems/owner-candidates")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(body.error ?? "Failed to load the possible owners");
        else setCandidates(body.users ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the possible owners");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!ownerId || refused.length > 0) return;
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/systems/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemIds: systems.map((system) => system.id), ownerId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const names = ((body.refusedIds ?? []) as string[])
          .map((id) => systems.find((system) => system.id === id)?.name ?? id)
          .join(", ");
        setError(`${body.error ?? "Failed to change the owner"}${names ? `: ${names}` : ""}`);
        return;
      }
      onDone(body, losing.length > 0);
    } catch {
      setError("Failed to change the owner");
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
        className="fixed left-1/2 top-[12vh] z-[51] flex max-h-[76vh] w-[min(480px,calc(100vw-32px))] overflow-y-auto -translate-x-1/2 flex-col gap-3 rounded-2xl border border-rg-line bg-rg-surface p-5 text-sm text-rg-ink shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          Change owner{systems.length > 1 ? ` of ${systems.length} Systems` : ""}
        </h2>
        {/* A large bulk selection scrolls here, so the picker and buttons stay in view. */}
        <p className="max-h-32 shrink-0 overflow-y-auto text-rg-muted">
          {systems.length === 1
            ? `${systems[0].name} is owned by ${systems[0].ownerName}.`
            : systems.map((system) => system.name).join(", ")}
        </p>

        {refused.length > 0 && (
          <p role="alert" className="text-rg-danger">
            You can&apos;t change the owner of {refused.map((system) => system.name).join(", ")}: only a System&apos;s
            owner or an Admin can. Take {refused.length === 1 ? "it" : "them"} out of the selection to continue.
          </p>
        )}
        {error && (
          <p role="alert" className="text-rg-danger">
            {error}
          </p>
        )}

        <label className="flex flex-col gap-1">
          New owner
          <select
            className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2"
            value={ownerId}
            disabled={candidates === null}
            onChange={(event) => setOwnerId(event.target.value)}
          >
            <option value="">{candidates === null && !error ? "Loading…" : "Pick a user"}</option>
            {(candidates ?? []).map((user) => (
              <option key={user.id} value={user.id}>
                {user.name} ({user.email})
              </option>
            ))}
          </select>
        </label>
        {losing.length > 0 && (
          <p className="text-rg-muted">
            You will no longer be able to change {losing.length === 1 ? "this System" : "these Systems"} after handing {losing.length === 1 ? "it" : "them"} over.
          </p>
        )}
        {unchanged.length > 0 && (
          <p className="text-rg-muted">
            {unchanged.map((system) => system.name).join(", ")} {unchanged.length === 1 ? "is" : "are"} already owned by
            this user and stays as it is.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving || !ownerId || refused.length > 0}>
            Save owner
          </Button>
        </div>
      </form>
    </>
  );
}

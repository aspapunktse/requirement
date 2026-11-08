"use client";

import { useEffect, useId, useState } from "react";

type Candidate = { id: string; name: string; email: string; role: string };

/**
 * The picker for a System's Business System Owner (#321), shared by the onboarding interview and the System
 * page's dialog. Loads every User (any role may be one) from `/api/systems/bso-candidates` and leaves out
 * `excludeUserId`, the System's owner (or the creator in the interview), who can't be it. An empty value means
 * "none". If the list can't load, the picker says so itself.
 */
export function BusinessSystemOwnerPicker({
  value,
  onChange,
  excludeUserId,
  label = "Business System Owner (optional)",
  noneLabel = "Not set",
  disabled = false,
}: {
  value: string;
  onChange: (userId: string) => void;
  excludeUserId?: string;
  label?: string;
  noneLabel?: string;
  disabled?: boolean;
}) {
  const hintId = useId();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/systems/bso-candidates")
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) setError(body.error ?? "Failed to load the possible Business System Owners");
        else setCandidates(body.users ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load the possible Business System Owners");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = (candidates ?? []).filter((user) => user.id !== excludeUserId);

  return (
    <div className="flex flex-col gap-1">
      <label className="flex flex-col gap-1">
        {label}
        <select
          className="rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 text-rg-ink"
          value={value}
          disabled={disabled || candidates === null}
          aria-describedby={error ? hintId : undefined}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{candidates === null && !error ? "Loading…" : noneLabel}</option>
          {options.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} ({user.email})
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p id={hintId} role="alert" className="text-rg-danger">
          {error}
        </p>
      )}
    </div>
  );
}

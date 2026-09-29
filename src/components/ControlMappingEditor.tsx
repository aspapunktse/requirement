"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

export type Coverage = "FULL" | "PARTIAL";
export type MappedControl = {
  id: string;
  coverage: Coverage;
  rationale: string | null;
  control: { id: string; code: string; title: string };
};
export type PickableControl = { id: string; code: string; title: string };

const COVERAGE_LABEL: Record<Coverage, string> = { FULL: "Full", PARTIAL: "Partial" };

/** How many Controls the picker lists at once; the search box narrows the rest. */
const MAX_PICKER_OPTIONS = 50;

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return (await response.json()).error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * The Control Mapping editor for one Requirement: lists the Controls mapped
 * to it (change Coverage Full/Partial, edit the rationale, remove), and adds
 * new ones through a searchable Control picker. Every change goes straight to
 * the API and then calls `onChanged` so the parent reloads the Requirement's
 * mappings. Each add/remove/Coverage change is logged as a System-less
 * CONTROL_MAPPING_CHANGED Change Event server-side. See #73.
 */
export function ControlMappingEditor({
  frameworkId,
  requirementId,
  requirementCode,
  mappings,
  controls,
  onChanged,
}: {
  frameworkId: string;
  requirementId: string;
  requirementCode: string;
  mappings: MappedControl[];
  controls: PickableControl[];
  onChanged: () => Promise<void> | void;
}) {
  const [search, setSearch] = useState("");
  const [controlId, setControlId] = useState("");
  const [coverage, setCoverage] = useState<Coverage>("FULL");
  const [rationale, setRationale] = useState("");
  const [rationaleDrafts, setRationaleDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const basePath = `/api/frameworks/${frameworkId}/requirements/${requirementId}/mappings`;

  const mappedControlIds = new Set(mappings.map((mapping) => mapping.control.id));
  const query = search.trim().toLowerCase();
  const matches = controls.filter(
    (control) =>
      !mappedControlIds.has(control.id) &&
      (query === "" || `${control.code} ${control.title}`.toLowerCase().includes(query)),
  );
  const shown = matches.slice(0, MAX_PICKER_OPTIONS);

  async function send(url: string, init: RequestInit, failure: string): Promise<boolean> {
    setError(null);
    const response = await fetch(url, init);
    if (!response.ok) {
      setError(await errorMessage(response, failure));
      return false;
    }
    await onChanged();
    return true;
  }

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!controlId) return;
    const ok = await send(
      basePath,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ controlId, coverage, rationale: rationale.trim() || undefined }),
      },
      "Failed to add the Control Mapping",
    );
    if (ok) {
      setControlId("");
      setSearch("");
      setRationale("");
      setCoverage("FULL");
    }
  }

  function patchMapping(mapping: MappedControl, body: { coverage?: Coverage; rationale?: string | null }) {
    return send(
      `${basePath}/${mapping.id}`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      "Failed to update the Control Mapping",
    );
  }

  async function saveRationale(mapping: MappedControl) {
    const draft = (rationaleDrafts[mapping.id] ?? mapping.rationale ?? "").trim();
    if (draft === (mapping.rationale ?? "")) return;
    const ok = await patchMapping(mapping, { rationale: draft === "" ? null : draft });
    if (ok) {
      setRationaleDrafts((prev) => {
        const next = { ...prev };
        delete next[mapping.id];
        return next;
      });
    }
  }

  function handleRemove(mapping: MappedControl) {
    return send(`${basePath}/${mapping.id}`, { method: "DELETE" }, "Failed to remove the Control Mapping");
  }

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Mapped Controls ({mappings.length})
      </h4>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {mappings.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No Controls mapped yet, so this Requirement is a Coverage Gap.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {mappings.map((mapping) => (
            <li
              key={mapping.id}
              className="flex flex-col gap-2 rounded border border-zinc-200 p-2 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{mapping.control.code}</span>
                <span className="text-zinc-600 dark:text-zinc-400">{mapping.control.title}</span>
                <select
                  aria-label={`Coverage of ${mapping.control.code} for ${requirementCode}`}
                  className="ml-auto rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
                  value={mapping.coverage}
                  onChange={(event) => patchMapping(mapping, { coverage: event.target.value as Coverage })}
                >
                  {(Object.keys(COVERAGE_LABEL) as Coverage[]).map((value) => (
                    <option key={value} value={value}>
                      {COVERAGE_LABEL[value]}
                    </option>
                  ))}
                </select>
                <Button className="px-2 py-0.5 text-xs" onClick={() => handleRemove(mapping)}>
                  Remove
                </Button>
              </div>
              <input
                aria-label={`Rationale for ${mapping.control.code} on ${requirementCode}`}
                placeholder="Rationale (optional)"
                className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
                value={rationaleDrafts[mapping.id] ?? mapping.rationale ?? ""}
                onChange={(event) => setRationaleDrafts((prev) => ({ ...prev, [mapping.id]: event.target.value }))}
                onBlur={() => saveRationale(mapping)}
              />
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            aria-label={`Search Controls to map to ${requirementCode}`}
            placeholder="Search Controls by code or title"
            className="min-w-48 flex-1 rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setControlId("");
            }}
          />
          <select
            aria-label={`Control to map to ${requirementCode}`}
            className="min-w-48 flex-1 rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={controlId}
            onChange={(event) => setControlId(event.target.value)}
          >
            <option value="">
              {matches.length === 0 ? "No matching Controls" : `Select a Control (${matches.length})…`}
            </option>
            {shown.map((control) => (
              <option key={control.id} value={control.id}>
                {control.code} — {control.title}
              </option>
            ))}
          </select>
          <select
            aria-label={`Coverage for the new mapping on ${requirementCode}`}
            className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={coverage}
            onChange={(event) => setCoverage(event.target.value as Coverage)}
          >
            <option value="FULL">Full coverage</option>
            <option value="PARTIAL">Partial coverage</option>
          </select>
        </div>
        {matches.length > shown.length && (
          <p className="text-xs text-zinc-500">
            Showing the first {shown.length} of {matches.length} Controls. Search to narrow the list.
          </p>
        )}
        <input
          aria-label={`Rationale for the new mapping on ${requirementCode}`}
          placeholder="Rationale (optional)"
          className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={!controlId}>
          Map Control
        </Button>
      </form>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  isEmptyFilter,
  ONBOARDING_STATUS_LABEL,
  ONBOARDING_STATUSES,
  type SystemFilter,
} from "@/lib/internal-audit-system-filter";
import type { SystemFilterMatch, SystemFilterOptions } from "@/lib/internal-audits";

const SELECT_CLASSES = "rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";

const systems = (count: number) => `${count} System${count === 1 ? "" : "s"}`;

/**
 * "Select Systems by filter" on a draft Internal Audit's form (PRD 0001 F-IA.1, #153). The auditor
 * sets up to four criteria (combined with AND; "Any" leaves one out), previews the matching
 * Systems and then adds them to the form's picked Systems. The filter is only a way to pick:
 * nothing is stored but the Systems, and only when the form is saved. The preview is the server's
 * answer (`GET /api/internal-audits/system-filter`); adding is the parent's `onAdd`.
 */
export function SystemFilterPanel({
  options,
  pickedIds,
  onAdd,
}: {
  options: SystemFilterOptions;
  pickedIds: string[];
  onAdd: (matches: SystemFilterMatch[]) => void;
}) {
  const [filter, setFilter] = useState<SystemFilter>({});
  const [matches, setMatches] = useState<SystemFilterMatch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function change(next: SystemFilter) {
    setFilter(next);
    // The preview described the previous criteria.
    setMatches(null);
    setError(null);
  }

  async function show() {
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
      const response = await fetch(`/api/internal-audits/system-filter?${query}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMatches(null);
        setError(body.error ?? "Failed to look up the matching Systems");
        return;
      }
      setMatches(body.systems);
    } finally {
      setBusy(false);
    }
  }

  const picked = new Set(pickedIds);
  const fresh = matches?.filter((match) => !picked.has(match.id)) ?? [];

  return (
    <fieldset className="flex flex-col gap-3 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <legend className="px-1">Select Systems by filter</legend>
      <p className="text-zinc-500">
        Pick the criteria a System must meet (all of them), look at the Systems that match, then add them. The audit keeps
        the Systems, not the filter, so Systems created later are not added.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          Framework
          <select
            className={SELECT_CLASSES}
            value={filter.frameworkId ?? ""}
            onChange={(event) => change({ ...filter, frameworkId: event.target.value || undefined })}
          >
            <option value="">Any</option>
            {options.frameworks.map((framework) => (
              <option key={framework.id} value={framework.id}>
                {framework.name} {framework.version}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Deployment Facet
          <select
            className={SELECT_CLASSES}
            value={filter.deploymentFacetId ?? ""}
            onChange={(event) => change({ ...filter, deploymentFacetId: event.target.value || undefined })}
          >
            <option value="">Any</option>
            {options.deploymentFacets.map((facet) => (
              <option key={facet.id} value={facet.id}>
                {facet.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Business Unit
          <select
            className={SELECT_CLASSES}
            value={filter.businessUnitId ?? ""}
            onChange={(event) => change({ ...filter, businessUnitId: event.target.value || undefined })}
          >
            <option value="">Any</option>
            {options.businessUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          Onboarding status
          <select
            className={SELECT_CLASSES}
            value={filter.status ?? ""}
            onChange={(event) => change({ ...filter, status: (event.target.value || undefined) as SystemFilter["status"] })}
          >
            <option value="">Any</option>
            {ONBOARDING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ONBOARDING_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <Button onClick={show} disabled={busy}>
          Show matching Systems
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}

      {matches && (
        <div className="flex flex-col gap-2">
          <p role="status">
            {systems(matches.length)} match{matches.length === 1 ? "es" : ""}; {matches.length - fresh.length}{" "}
            {matches.length - fresh.length === 1 ? "is" : "are"} already picked
          </p>
          {isEmptyFilter(filter) && matches.length > 0 && (
            <p className="text-amber-700 dark:text-amber-400">No criteria are set, so this is every System.</p>
          )}
          {matches.length > 0 && (
            <ul aria-label="Matching Systems" className="max-h-56 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800">
              {matches.map((match) => (
                <li key={match.id} className="px-2 py-1">
                  {match.name}{" "}
                  <span className="text-zinc-500">
                    {[
                      ONBOARDING_STATUS_LABEL[match.status],
                      match.vendor,
                      match.deploymentFacets.join(" + "),
                      match.businessUnits.join(", "),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    {picked.has(match.id) && " · already picked"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {fresh.length > 0 && (
            <div>
              <Button variant="primary" onClick={() => onAdd(fresh)}>
                Add {systems(fresh.length)}
              </Button>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

"use client";

import { useState } from "react";
import { Icon } from "@/app/home/HomeGraphics";
import { frameworkLabel } from "@/lib/framework-label";
import { isEmptyFilter, ONBOARDING_STATUS_LABEL, ONBOARDING_STATUSES, type SystemFilter } from "@/lib/internal-audit-system-filter";
import type { SystemFilterMatch, SystemFilterOptions } from "@/lib/internal-audits";

/** A System as the planner lists it: the loaded ones, and any the filter found that the page didn't load. */
export type WhereSystem = { id: string; name: string; vendor: string | null; status: keyof typeof ONBOARDING_STATUS_LABEL; detail: string };

const PAGE = 48;
const plural = (n: number) => `${n} System${n === 1 ? "" : "s"}`;

/**
 * Step 3, "Where?": the System filter with "Add matches" (the server's rules, `GET /api/internal-audits/system-filter`;
 * the filter is never saved, only the Systems), the picked Systems as chips, a search with tiles, and the
 * Organization switch with how many Check-ups it adds.
 */
export function PlannerWhere({
  options,
  systems,
  picked,
  onToggle,
  onAddMatches,
  includeOrganization,
  onOrganization,
  organizationCheckUps,
}: {
  options: SystemFilterOptions;
  systems: WhereSystem[];
  picked: string[];
  onToggle: (id: string) => void;
  onAddMatches: (matches: SystemFilterMatch[]) => number;
  includeOrganization: boolean;
  onOrganization: (on: boolean) => void;
  /** Organization-level Check-ups the preview counts, or null while there is no answer. */
  organizationCheckUps: number | null;
}) {
  const [filter, setFilter] = useState<SystemFilter>({});
  const [said, setSaid] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  const pickedSet = new Set(picked);
  const byId = new Map(systems.map((system) => [system.id, system]));
  const needle = query.trim().toLowerCase();
  const visible = systems.filter((system) => !needle || [system.name, system.vendor ?? ""].some((text) => text.toLowerCase().includes(needle)));

  function change(next: SystemFilter) {
    setFilter(next);
    setSaid(null);
    setFailed(null);
  }

  async function addMatches() {
    setBusy(true);
    setSaid(null);
    setFailed(null);
    try {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(filter)) if (value) search.set(key, value);
      const response = await fetch(`/api/internal-audits/system-filter?${search}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFailed(body.error ?? "Failed to look up the matching Systems");
        return;
      }
      const matches: SystemFilterMatch[] = body.systems;
      const added = onAddMatches(matches);
      setSaid(
        matches.length === 0
          ? "No System matches."
          : `${plural(matches.length)} match${matches.length === 1 ? "es" : ""}: ${added} added, ${matches.length - added} already picked.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ap-card" aria-labelledby="ap-w-h">
      <div className="ap-card-h">
        <span className={`ap-step${picked.length > 0 || includeOrganization ? " done" : ""}`}>3</span>
        <h2 id="ap-w-h">Where?</h2>
        <p>
          {plural(picked.length)} picked{includeOrganization ? " · Organization" : ""}
        </p>
      </div>
      <div className="ap-card-b ap-where">
        <div className="ap-filter" role="group" aria-label="Select Systems by filter">
          <label className="ap-field">
            Framework
            <select value={filter.frameworkId ?? ""} onChange={(event) => change({ ...filter, frameworkId: event.target.value || undefined })}>
              <option value="">Any</option>
              {options.frameworks.map((framework) => (
                <option key={framework.id} value={framework.id}>
                  {frameworkLabel(framework)}
                </option>
              ))}
            </select>
          </label>
          <label className="ap-field">
            Deployment Facet
            <select value={filter.deploymentFacetId ?? ""} onChange={(event) => change({ ...filter, deploymentFacetId: event.target.value || undefined })}>
              <option value="">Any</option>
              {options.deploymentFacets.map((facet) => (
                <option key={facet.id} value={facet.id}>
                  {facet.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ap-field">
            Business Unit
            <select value={filter.businessUnitId ?? ""} onChange={(event) => change({ ...filter, businessUnitId: event.target.value || undefined })}>
              <option value="">Any</option>
              {options.businessUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ap-field">
            Onboarding status
            <select value={filter.status ?? ""} onChange={(event) => change({ ...filter, status: (event.target.value || undefined) as SystemFilter["status"] })}>
              <option value="">Any</option>
              {ONBOARDING_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {ONBOARDING_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </label>
          <div className="ap-filter-go">
            <button type="button" className="hc-btn" disabled={busy} onClick={addMatches}>
              Add matches
            </button>
            {isEmptyFilter(filter) && <small>No criteria: adds every System</small>}
          </div>
        </div>
        <p className="ap-said" role="status">
          {said}
        </p>
        {failed && (
          <p role="alert" className="ap-note">
            {failed}
          </p>
        )}

        <div className="ap-picked" aria-label="Picked Systems">
          {picked.length === 0 && <span className="ap-muted">No System picked yet</span>}
          {picked.slice(0, 40).map((id) => (
            <span key={id} className="ap-pchip">
              {byId.get(id)?.name ?? "System"}
              <button type="button" aria-label={`Remove ${byId.get(id)?.name ?? "System"}`} onClick={() => onToggle(id)}>
                <Icon name="plus" size={12} />
              </button>
            </span>
          ))}
          {picked.length > 40 && <span className="ap-muted">+{picked.length - 40} more</span>}
        </div>

        <label className="hc-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            aria-label="Search Systems by name or vendor"
            placeholder="Search Systems by name or vendor"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(PAGE);
            }}
          />
        </label>
        <div className="ap-sgrid" role="group" aria-label="Systems">
          {visible.slice(0, shown).map((system) => (
            <button key={system.id} type="button" className="ap-stile" aria-pressed={pickedSet.has(system.id)} onClick={() => onToggle(system.id)}>
              <b>{system.name}</b>
              <small>{[ONBOARDING_STATUS_LABEL[system.status], system.vendor, system.detail].filter(Boolean).join(" · ")}</small>
              <span className="tick">
                <Icon name="check" size={12} />
              </span>
            </button>
          ))}
        </div>
        {visible.length === 0 && <p className="ap-empty">{systems.length === 0 ? "There are no Systems yet." : "No System matches."}</p>}
        {visible.length > shown && (
          <button type="button" className="ap-more" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({visible.length - shown} left)
          </button>
        )}

        <div className="ap-org">
          <span className="ib">
            <Icon name="building" size={20} />
          </span>
          <span>
            <b>The Organization</b>
            <small>
              Also check the Organization&apos;s own Control Implementations
              {includeOrganization && organizationCheckUps !== null ? ` · ${organizationCheckUps} Check-ups` : ""}
            </small>
          </span>
          <label className="ap-toggle">
            <input type="checkbox" role="switch" aria-label="Include the Organization" checked={includeOrganization} onChange={(event) => onOrganization(event.target.checked)} />
            <span className="track" />
          </label>
        </div>
      </div>
    </section>
  );
}

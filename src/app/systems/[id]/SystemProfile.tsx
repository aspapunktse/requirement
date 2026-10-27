"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImpactLevel } from "@prisma/client";
import { frameworkLabel } from "@/lib/framework-label";
import { IMPACT_LABEL, IMPACT_ORDER } from "@/app/systems/systems-types";
import { formatDay } from "./system-page-logic";
import { useRemote } from "./use-remote";

type ImpactLevels = {
  confidentialityImpactLevel: ImpactLevel | null;
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
};

const AXES: { key: keyof ImpactLevels; label: string }[] = [
  { key: "confidentialityImpactLevel", label: "Confidentiality" },
  { key: "integrityImpactLevel", label: "Integrity" },
  { key: "availabilityImpactLevel", label: "Availability" },
];

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((id) => bSet.has(id));
}

async function errorOf(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}));
  return typeof body.error === "string" ? body.error : fallback;
}

export type SystemAbout = {
  vendor: string | null;
  ownerName: string;
  /** ISO timestamps. */
  createdAt: string;
  onboardedAt: string | null;
  description: string | null;
};

/** About: read-only. Editing it is its own issue (#246), whose Edit button goes in the header's slot. */
function About({ about }: { about: SystemAbout }) {
  return (
    <section className="hc-card" aria-labelledby="sc-about-h">
      <div className="hc-card-h">
        <h2 id="sc-about-h">About</h2>
        {/* Slot for the Edit button of #246. */}
        <span className="sc-about-slot" data-slot="about-edit" />
      </div>
      <dl className="hc-card-b sc-about">
        <div>
          <dt>Vendor</dt>
          <dd>{about.vendor || <span className="muted">Not set</span>}</dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>{about.ownerName}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDay(about.createdAt)}</dd>
        </div>
        <div>
          <dt>Onboarded</dt>
          <dd>{about.onboardedAt ? formatDay(about.onboardedAt) : <span className="muted">Not yet</span>}</dd>
        </div>
        <div className="wide">
          <dt>Description</dt>
          <dd>{about.description || <span className="muted">No description</span>}</dd>
        </div>
      </dl>
    </section>
  );
}

type DeploymentFacet = { id: string; name: string };

function DeploymentFacets({ systemId, canChange, currentIds }: { systemId: string; canChange: boolean; currentIds: string[] }) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState(currentIds);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const read = useCallback(async (): Promise<DeploymentFacet[]> => {
    const response = await fetch("/api/deployment-facets");
    if (!response.ok) throw new Error("Failed to load the Deployment Facets");
    return (await response.json()).deploymentFacets ?? [];
  }, []);
  const { data: facets, failed: loadError, reload: load } = useRemote(read);

  const unchanged = sameSet(selectedIds, currentIds);

  async function handleSave() {
    setError(null);
    setMessage(null);
    if (unchanged || selectedIds.length === 0) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deploymentFacetIds: selectedIds }),
      });
      if (!response.ok) {
        setError(await errorOf(response, "Failed to change Deployment Facets"));
        return;
      }
      const body = await response.json();
      setMessage(`Deployment Facets changed: ${body.added} Control(s) added, ${body.removed} untouched Control(s) removed.`);
      router.refresh();
    } catch {
      setError("Failed to change Deployment Facets");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hc-card" aria-labelledby="sc-facets-h">
      <div className="hc-card-h">
        <h2 id="sc-facets-h">Deployment Facets</h2>
        <p>More than one means Hybrid</p>
      </div>
      <div className="hc-card-b sc-formblock">
        {error && (
          <p role="alert" className="sc-err">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="sc-saved">
            {message}
          </p>
        )}
        {loadError && (
          <p role="alert" className="sc-err">
            Couldn&apos;t load the Deployment Facets.{" "}
            <button type="button" className="sc-link" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {facets === null ? (
          !loadError && (
            <p role="status" className="hc-empty">
              Loading Deployment Facets…
            </p>
          )
        ) : (
          <fieldset className="sc-facetpick" disabled={!canChange}>
            <legend className="sc-sr">Deployment Facets</legend>
            {facets.map((facet) => (
              <label key={facet.id}>
                <input
                  type="checkbox"
                  aria-label={facet.name}
                  checked={selectedIds.includes(facet.id)}
                  onChange={(event) => setSelectedIds((previous) => (event.target.checked ? [...previous, facet.id] : previous.filter((id) => id !== facet.id)))}
                />
                {facet.name}
              </label>
            ))}
          </fieldset>
        )}
        {canChange ? (
          <div className="sc-btnrow">
            <button type="button" className="hc-btn primary" onClick={handleSave} disabled={saving || unchanged || selectedIds.length === 0}>
              Change Deployment Facets
            </button>
          </div>
        ) : (
          <p className="sc-faint">Only the System&apos;s owner or an Admin can change its classification.</p>
        )}
      </div>
    </section>
  );
}

function ImpactLevelsCard({ systemId, canChange, current }: { systemId: string; canChange: boolean; current: ImpactLevels }) {
  const router = useRouter();
  const [levels, setLevels] = useState<ImpactLevels>(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unchanged = AXES.every(({ key }) => levels[key] === current[key]);

  async function handleSave() {
    setError(null);
    if (unchanged) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(levels),
      });
      if (!response.ok) {
        setError(await errorOf(response, "Failed to change Impact Levels"));
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to change Impact Levels");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hc-card" aria-labelledby="sc-impact-h">
      <div className="hc-card-h">
        <h2 id="sc-impact-h">Impact Level</h2>
        <p>Set per axis. Changing it recomputes the applicable Controls.</p>
      </div>
      <div className="hc-card-b sc-formblock">
        {error && (
          <p role="alert" className="sc-err">
            {error}
          </p>
        )}
        {AXES.map(({ key, label }) => (
          <div key={key} className="sc-lvl-row">
            <b id={`sc-lvl-${key}`}>{label}</b>
            <div className="sc-seg" role="group" aria-labelledby={`sc-lvl-${key}`}>
              {([null, ...IMPACT_ORDER] as (ImpactLevel | null)[]).map((level) => (
                <button
                  key={level ?? "none"}
                  type="button"
                  aria-pressed={levels[key] === level}
                  disabled={!canChange}
                  onClick={() => setLevels((previous) => ({ ...previous, [key]: level }))}
                >
                  {level ? IMPACT_LABEL[level] : "Not classified"}
                </button>
              ))}
            </div>
          </div>
        ))}
        {canChange ? (
          <div className="sc-btnrow">
            <button type="button" className="hc-btn primary" onClick={handleSave} disabled={saving || unchanged}>
              Change Impact Levels
            </button>
          </div>
        ) : (
          <p className="sc-faint">Only the System&apos;s owner or an Admin can change its classification.</p>
        )}
      </div>
    </section>
  );
}

// `version` is only set on Frameworks, where it disambiguates two versions of one standard.
type CatalogItem = {
  id: string;
  name: string;
  version?: string;
  description: string | null;
  // Only Frameworks have a status; a Draft one can't be declared (the API rejects it too).
  status?: "DRAFT" | "PUBLISHED";
  // Only set on Frameworks: the base Framework is always in scope and can't be removed.
  isBase?: boolean;
};

type TagRelationProps = {
  /** Base API path for this System-level relation, e.g. "/api/systems/{id}/business-units". */
  resourcePath: string;
  /** Key the relation endpoint nests its array under, e.g. "businessUnits". */
  resourceKey: string;
  /** Catalog list endpoint to pick new entries from, e.g. "/api/business-units". */
  catalogPath: string;
  /** Key the catalog endpoint nests its array under. */
  catalogKey: string;
  /** POST field name the declare endpoint expects, e.g. "businessUnitId". */
  idField: string;
  /** Singular, human-readable name of one entry, e.g. "Business Unit". */
  itemLabel: string;
  /** The group's heading, e.g. "Framework Scope". */
  heading: string;
  canManage: boolean;
  emptyLabel: string;
};

/**
 * Tags for the entries of an admin catalog declared on the System (Business Units, Framework Scope): remove with
 * the tag's ✕, add from the catalog with "+ Add". The base Framework is "always" in scope and has no ✕. Read-only
 * when the viewer can't manage it.
 */
function TagRelation({ resourcePath, resourceKey, catalogPath, catalogKey, idField, itemLabel, heading, canManage, emptyLabel }: TagRelationProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (): Promise<{ declared: CatalogItem[]; catalog: CatalogItem[] }> => {
    const [declaredResponse, catalogResponse] = await Promise.all([fetch(resourcePath), canManage ? fetch(catalogPath) : Promise.resolve(null)]);
    if (!declaredResponse.ok || (catalogResponse && !catalogResponse.ok)) throw new Error(`Failed to load the ${itemLabel}s`);
    return {
      declared: (await declaredResponse.json())[resourceKey] ?? [],
      catalog: catalogResponse ? ((await catalogResponse.json())[catalogKey] ?? []) : [],
    };
  }, [resourcePath, resourceKey, catalogPath, catalogKey, canManage, itemLabel]);
  const { data: loaded, failed: loadError, reload: load, setData: setLoaded } = useRemote(read);
  const declared = loaded?.declared ?? null;
  const catalog = loaded?.catalog ?? [];

  async function change(request: Promise<Response>, fallback: string) {
    setError(null);
    try {
      const response = await request;
      if (!response.ok) {
        setError(await errorOf(response, fallback));
        return false;
      }
      const next = (await response.json())[resourceKey];
      setLoaded((previous) => (previous ? { ...previous, declared: next } : previous));
      // The Overview's Classification tile and the timeline are read on the server.
      router.refresh();
      return true;
    } catch {
      setError(fallback);
      return false;
    }
  }

  async function handleDeclare(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const done = await change(
      fetch(resourcePath, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [idField]: selectedId }) }),
      `Failed to declare ${itemLabel}`,
    );
    if (done) {
      setSelectedId("");
      setAdding(false);
    }
  }

  const declaredIds = new Set((declared ?? []).map((item) => item.id));
  const available = catalog.filter((item) => !declaredIds.has(item.id) && item.status !== "DRAFT");

  return (
    <div className="sc-rel">
      <h3 className="sc-sub">{heading}</h3>
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      {loadError && (
        <p role="alert" className="sc-err">
          Couldn&apos;t load the {itemLabel}s.{" "}
          <button type="button" className="sc-link" onClick={load}>
            Try again
          </button>
        </p>
      )}
      {declared === null ? (
        !loadError && <p role="status">Loading {itemLabel}s…</p>
      ) : (
        <>
          {declared.length === 0 ? (
            <p className="sc-faint">{emptyLabel}</p>
          ) : (
            <ul className="sc-tags sc-tagedit" aria-label={`${itemLabel}s`}>
              {declared.map((item) => (
                <li key={item.id}>
                  {frameworkLabel(item)}
                  {item.isBase && <span className="sc-faint"> · always</span>}
                  {item.status === "DRAFT" && <span className="sc-faint"> · Draft, no effect until published</span>}
                  {canManage && !item.isBase && (
                    <button type="button" className="sc-x-tag" aria-label={`Remove ${frameworkLabel(item)}`} onClick={() => change(fetch(`${resourcePath}/${item.id}`, { method: "DELETE" }), `Failed to remove ${itemLabel}`)}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManage &&
            (adding ? (
              <form onSubmit={handleDeclare} className="sc-picker">
                <select aria-label={`Declare a ${itemLabel}`} value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  <option value="">Select a {itemLabel}…</option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {frameworkLabel(item)}
                    </option>
                  ))}
                </select>
                <div className="sc-btnrow">
                  <button type="submit" className="hc-btn primary" disabled={!selectedId}>
                    Declare
                  </button>
                  <button type="button" className="hc-btn" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button type="button" className="sc-tagbtn" onClick={() => setAdding(true)}>
                + Add
              </button>
            ))}
        </>
      )}
    </div>
  );
}

/**
 * The Profile tab (design proposal A, #245): About (read-only, a slot for the Edit button of #246), Deployment
 * Facets, Impact Level per axis, and Business Units and Framework Scope as tags. The permissions are the page's,
 * computed with the rules the API enforces; every control calls the API it always did.
 */
export function SystemProfile({
  systemId,
  about,
  canChangeClassification,
  canManageBusinessUnits,
  canManageFrameworkScopes,
  deploymentFacetIds,
  impactLevels,
}: {
  systemId: string;
  about: SystemAbout;
  canChangeClassification: boolean;
  canManageBusinessUnits: boolean;
  canManageFrameworkScopes: boolean;
  deploymentFacetIds: string[];
  impactLevels: ImpactLevels;
}) {
  return (
    <div className="sc-stackgap">
      <About about={about} />
      <DeploymentFacets systemId={systemId} canChange={canChangeClassification} currentIds={deploymentFacetIds} />
      <ImpactLevelsCard systemId={systemId} canChange={canChangeClassification} current={impactLevels} />
      <section className="hc-card" aria-labelledby="sc-scope-h">
        <div className="hc-card-h">
          <h2 id="sc-scope-h">Business Units and Framework Scope</h2>
        </div>
        <div className="hc-card-b sc-prof">
          <TagRelation
            resourcePath={`/api/systems/${systemId}/business-units`}
            resourceKey="businessUnits"
            catalogPath="/api/business-units"
            catalogKey="businessUnits"
            idField="businessUnitId"
            itemLabel="Business Unit"
            heading="Business Units"
            canManage={canManageBusinessUnits}
            emptyLabel="No Business Units consuming this System yet."
          />
          <TagRelation
            resourcePath={`/api/systems/${systemId}/framework-scopes`}
            resourceKey="frameworkScopes"
            catalogPath="/api/frameworks"
            catalogKey="frameworks"
            idField="frameworkId"
            itemLabel="Framework"
            heading="Framework Scope"
            canManage={canManageFrameworkScopes}
            emptyLabel="This System isn't in scope for any Framework yet."
          />
        </div>
      </section>
    </div>
  );
}

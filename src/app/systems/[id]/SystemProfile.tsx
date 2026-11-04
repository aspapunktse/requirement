"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ImpactLevel } from "@prisma/client";
import { frameworkLabel } from "@/lib/framework-label";
import { IMPACT_LABEL, IMPACT_ORDER } from "@/app/systems/systems-types";
import { SensitivityChip } from "@/components/SensitivityChip";
import { SensitivityLevelPicker } from "@/components/SensitivityLevelPicker";
import { FloorOffer, InformationTypeChecklist, levelLabelOf } from "@/components/InformationTypeDeclaration";
import type { InformationTypeRow } from "@/lib/information-type";
import { floorCulprit, informationTypeFloor, type FloorType } from "@/lib/information-type-floor";
import { joinNames } from "@/lib/framework-suggestions";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";
import { formatDay } from "./system-page-logic";
import { useRemote } from "./use-remote";

type ImpactLevels = {
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
};

const AXES: { key: keyof ImpactLevels; label: string }[] = [
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
  name: string;
  vendor: string | null;
  ownerName: string;
  /** ISO timestamps. */
  createdAt: string;
  onboardedAt: string | null;
  description: string | null;
};

const NAME_MAX = 200;
const VENDOR_MAX = 200;
const DESCRIPTION_MAX = 2000;

/** The same rules the API enforces (`src/lib/system-details.ts`), so most mistakes are caught before the request. */
function validateDetails({ name, vendor, description }: { name: string; vendor: string; description: string }) {
  if (name.trim() === "") return "Name is required";
  if (name.trim().length > NAME_MAX) return `Name can be at most ${NAME_MAX} characters`;
  if (vendor.trim().length > VENDOR_MAX) return `Vendor can be at most ${VENDOR_MAX} characters`;
  if (description.trim().length > DESCRIPTION_MAX) return `Description can be at most ${DESCRIPTION_MAX} characters`;
  return null;
}

/**
 * About: the System's vendor, owner, dates and description. Its owner or an Admin gets an Edit button (#246)
 * that turns the card into a form for the name, vendor and description; the rest are not editable here.
 */
function About({ systemId, about, canEdit }: { systemId: string; about: SystemAbout; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(about.name);
  const [vendor, setVendor] = useState(about.vendor ?? "");
  const [description, setDescription] = useState(about.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setName(about.name);
    setVendor(about.vendor ?? "");
    setDescription(about.description ?? "");
    setError(null);
    setEditing(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    const invalid = validateDetails({ name, vendor, description });
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), vendor: vendor.trim() || null, description: description.trim() || null }),
      });
      if (!response.ok) {
        setError(await errorOf(response, "Failed to save the details"));
        return;
      }
      setEditing(false);
      // The hero, breadcrumb, this card and the timeline are read on the server.
      router.refresh();
    } catch {
      setError("Failed to save the details");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="hc-card" aria-labelledby="sc-about-h">
      <div className="hc-card-h">
        <h2 id="sc-about-h">About</h2>
        {canEdit && !editing && (
          <button type="button" className="hc-btn" onClick={startEditing}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form className="hc-card-b sc-formblock sc-aboutform" onSubmit={handleSave} noValidate>
          {error && (
            <p role="alert" className="sc-err">
              {error}
            </p>
          )}
          <label className="sc-field">
            <span>Name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required disabled={saving} />
          </label>
          <label className="sc-field">
            <span>Vendor</span>
            <input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Leave empty if built in-house" disabled={saving} />
          </label>
          <label className="sc-field">
            <span>Description</span>
            <textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} disabled={saving} />
          </label>
          <div className="sc-btnrow">
            <button type="submit" className="hc-btn primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="hc-btn" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
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
      )}
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

/**
 * The System's Information Types and Sensitivity Level (ADR 0011, ADR 0012, design proposal A for #302): tick the kinds of
 * information it handles, then choose the level. The level can't be below the highest of the ticked types, so those levels
 * are disabled, and a ticked type above the chosen level offers to raise the level in the same save. The owner or an Admin
 * changes both at any Onboarding Status; one request carries the types and the level, and changing the level recomputes
 * the applicable Controls. A System with no level can't be submitted for review, nor can one below its types. The server
 * is the authority on the floor; this computes it only to show what it will accept.
 */
function SensitivityLevelCard({
  systemId,
  canChange,
  current,
  levels,
  declaredTypes,
  belowInformationTypes,
  ownerName,
}: {
  systemId: string;
  canChange: boolean;
  current: number | null;
  levels: SensitivityLevelInfo[];
  declaredTypes: FloorType[];
  belowInformationTypes: boolean;
  ownerName: string;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<number | null>(current);
  const [typeIds, setTypeIds] = useState<string[]>(() => declaredTypes.map((type) => type.id));
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const read = useCallback(async (): Promise<InformationTypeRow[]> => {
    const response = await fetch("/api/information-types");
    if (!response.ok) throw new Error("Failed to load the Information Types");
    return (await response.json()).informationTypes ?? [];
  }, []);
  const { data: catalogue, failed: loadError, reload: load } = useRemote(read);

  // The ticked types with their current levels: the catalogue's, falling back to the System's own read.
  const byId = new Map<string, FloorType>(declaredTypes.map((type) => [type.id, type]));
  for (const type of catalogue ?? []) byId.set(type.id, { id: type.id, name: type.name, sensitivityLevel: type.sensitivityLevel });
  const ticked = typeIds.flatMap((id) => byId.get(id) ?? []);
  const floor = informationTypeFloor(ticked);
  const culprit = floorCulprit(ticked, lastAdded);
  const short = floor !== null && (chosen === null || chosen < floor);
  const savedFloor = informationTypeFloor(declaredTypes);

  const typesUnchanged = sameSet(typeIds, declaredTypes.map((type) => type.id));
  const unchanged = chosen === current && typesUnchanged;

  async function save(body: { informationTypeIds?: string[]; sensitivityLevel?: number | null }, fallback: string) {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setError(await errorOf(response, fallback));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError(fallback);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (unchanged || short) return;
    await save(
      {
        ...(!typesUnchanged && { informationTypeIds: typeIds }),
        ...(chosen !== current && { sensitivityLevel: chosen }),
      },
      "Failed to change the Sensitivity Level",
    );
  }

  /** The fix for a System below its Information Types: raise the saved level to the saved floor, nothing else. */
  async function handleFix() {
    if (savedFloor === null) return;
    if (await save({ sensitivityLevel: savedFloor }, "Failed to raise the Sensitivity Level")) setChosen(savedFloor);
  }

  function toggle(type: { id: string }, checked: boolean) {
    setTypeIds((previous) => (checked ? [...previous.filter((id) => id !== type.id), type.id] : previous.filter((id) => id !== type.id)));
    setLastAdded(checked ? type.id : null);
  }

  const blockedReason = (level: number | "none") => {
    if (floor === null || culprit === null) return null;
    if (level === "none") return `Choose ${levelLabelOf(levels, floor)} or higher: ${culprit.name} sets the floor.`;
    return level < floor ? `Below the floor (${culprit.name})` : null;
  };

  // Untouched, a System below its types already has the banner above with the same fix: no second offer.
  const bannerCoversIt = belowInformationTypes && unchanged;
  const floorLabel = savedFloor === null ? null : levelLabelOf(levels, savedFloor);
  const offending = declaredTypes.filter((type) => current !== null && type.sensitivityLevel > current);

  return (
    <section className="hc-card" aria-labelledby="sc-sens-h">
      <div className="hc-card-h">
        <h2 id="sc-sens-h">Sensitivity Level</h2>
        <p>How sensitive the information in this System is. Changing it recomputes the applicable Controls.</p>
      </div>
      <div className="hc-card-b sc-formblock">
        {error && (
          <p role="alert" className="sc-err">
            {error}
          </p>
        )}
        {belowInformationTypes && floorLabel !== null && (
          <div role="alert" className="grid gap-2 rounded-[10px] border border-rg-gold bg-rg-gold-soft p-2.5 text-[0.9rem] text-rg-gold-ink">
            <b>Below its Information Types.</b>
            <span>
              The level is {current === null ? "not set" : levelLabelOf(levels, current)}, but{" "}
              {offending.map((type) => `${type.name} is ${levelLabelOf(levels, type.sensitivityLevel)}`).join(" and ")}. A curator may have raised{" "}
              {offending.length === 1 ? "it" : "them"} after the types were declared. Nothing changed on its own, but the System can&apos;t be submitted for
              review until the level is {floorLabel} or higher.
            </span>
            {canChange ? (
              <span>
                <button type="button" className="hc-btn primary" onClick={handleFix} disabled={saving}>
                  Raise to {floorLabel}
                </button>
              </span>
            ) : (
              <span>Only {ownerName}, the System&apos;s owner, or an Admin can raise it.</span>
            )}
          </div>
        )}

        <b id="sc-types-h">Information Types</b>
        <p className="sc-faint">What this System may handle. The highest of them sets the least Sensitivity Level it can have.</p>
        {canChange ? (
          <>
            {loadError && (
              <p role="alert" className="sc-err">
                Couldn&apos;t load the Information Types.{" "}
                <button type="button" className="sc-link" onClick={load}>
                  Try again
                </button>
              </p>
            )}
            {catalogue === null ? (
              !loadError && (
                <p role="status" className="hc-empty">
                  Loading Information Types…
                </p>
              )
            ) : catalogue.length === 0 ? (
              <p className="sc-faint">No Information Types exist yet. The Compliance Manager or an Admin adds them; until then you set the level directly.</p>
            ) : (
              <InformationTypeChecklist types={catalogue} levels={levels} selectedIds={typeIds} onToggle={toggle} labelledBy="sc-types-h" />
            )}
          </>
        ) : declaredTypes.length === 0 ? (
          <p className="sc-faint">None declared. The owner sets the Sensitivity Level directly.</p>
        ) : (
          <ul aria-labelledby="sc-types-h" className="sc-tags">
            {declaredTypes.map((type) => (
              <li key={type.id}>
                {type.name} · {levelLabelOf(levels, type.sensitivityLevel)}
              </li>
            ))}
          </ul>
        )}

        <b id="sc-lvl-sensitivity">Sensitivity Level</b>
        {floor !== null && culprit !== null ? (
          <p className="sc-faint">
            Nothing below {levelLabelOf(levels, floor)}: {culprit.name} sets the floor. You may go higher.
          </p>
        ) : (
          <p className="sc-faint">No Information Type is ticked, so you set the level freely.</p>
        )}
        <SensitivityLevelPicker
          levels={levels}
          value={chosen}
          onChange={setChosen}
          name="sc-sensitivity"
          labelledBy="sc-lvl-sensitivity"
          disabled={!canChange}
          noneLabel={<SensitivityChip level={null} />}
          noneDescription="No level declared. The System can't be submitted for review until one is picked."
          blockedReason={blockedReason}
        />
        {canChange && short && !bannerCoversIt && floor !== null && culprit !== null && (
          <FloorOffer
            culprit={culprit}
            floor={floor}
            chosen={chosen}
            levels={levels}
            onRaise={() => setChosen(floor)}
            onLeaveOut={() => {
              setTypeIds((previous) => previous.filter((id) => id !== culprit.id));
              setLastAdded(null);
            }}
          />
        )}
        {canChange ? (
          <div className="sc-btnrow">
            <button type="button" className="hc-btn primary" onClick={handleSave} disabled={saving || unchanged || short}>
              Change Sensitivity Level
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
        <p>Set per axis (Integrity and Availability). Changing it recomputes the applicable Controls.</p>
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
  /** Changing it reads the declared entries again (the Suggested Frameworks section changed the scope next to it). */
  reloadKey?: number;
};

/**
 * Tags for the entries of an admin catalog declared on the System (Business Units, Framework Scope): remove with
 * the tag's ✕, add from the catalog with "+ Add". The base Framework is "always" in scope and has no ✕. Read-only
 * when the viewer can't manage it.
 */
function TagRelation({ resourcePath, resourceKey, catalogPath, catalogKey, idField, itemLabel, heading, canManage, emptyLabel, reloadKey = 0 }: TagRelationProps) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // `reloadKey` is a dependency on purpose: a new value makes `read` a new function, which reads again.
  const read = useCallback(async (): Promise<{ declared: CatalogItem[]; catalog: CatalogItem[] }> => {
    void reloadKey; // read again whenever it changes
    const [declaredResponse, catalogResponse] = await Promise.all([fetch(resourcePath), canManage ? fetch(catalogPath) : Promise.resolve(null)]);
    if (!declaredResponse.ok || (catalogResponse && !catalogResponse.ok)) throw new Error(`Failed to load the ${itemLabel}s`);
    return {
      declared: (await declaredResponse.json())[resourceKey] ?? [],
      catalog: catalogResponse ? ((await catalogResponse.json())[catalogKey] ?? []) : [],
    };
  }, [resourcePath, resourceKey, catalogPath, catalogKey, canManage, itemLabel, reloadKey]);
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

/** A suggested Framework not in the System's Framework Scope, as the server worked it out (see `framework-suggestions.ts`). */
export type SuggestedFrameworkItem = { frameworkId: string; label: string; name: string; types: string[]; state: "open" | "left-out" };

/**
 * The Frameworks the System's Information Types suggest (ADR 0013), under its Framework Scope. The owner (or an Admin)
 * adds one to the scope (the Framework Scope route) or leaves it out (recorded per type, so it doesn't flag the System
 * again while the types stay); a left-out one stays listed quietly with a way to add it anyway. Nothing here is
 * automatic, and the server decides who may write.
 */
function SuggestedFrameworks({
  systemId,
  suggestions,
  canManage,
  onScopeChanged,
}: {
  systemId: string;
  suggestions: SuggestedFrameworkItem[];
  canManage: boolean;
  onScopeChanged: () => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(frameworkId: string, request: () => Promise<Response>, fallback: string, scopeChanged: boolean) {
    setBusyId(frameworkId);
    setError(null);
    try {
      const response = await request();
      if (!response.ok) {
        setError(await errorOf(response, fallback));
        return;
      }
      if (scopeChanged) onScopeChanged();
      // The suggestions, the notice and the Systems list are read on the server.
      router.refresh();
    } catch {
      setError(fallback);
    } finally {
      setBusyId(null);
    }
  }

  const post = (url: string, frameworkId: string) => () =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ frameworkId }) });
  const open = suggestions.filter((suggestion) => suggestion.state === "open");
  const leftOut = suggestions.filter((suggestion) => suggestion.state === "left-out");
  if (suggestions.length === 0) return null;

  return (
    <div id="sc-suggest" tabIndex={-1} className="sc-rel sc-suggest" role="group" aria-label="Suggested Frameworks">
      <h3 className="sc-sub">Suggested Frameworks</h3>
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      {open.length > 0 && (
        <ul className="sc-suggest-list">
          {open.map((suggestion) => (
            <li key={suggestion.frameworkId} className="sc-callout warn">
              <span>
                {joinNames(suggestion.types)} {suggestion.types.length === 1 ? "usually falls" : "usually fall"} under {suggestion.name}. Put {suggestion.name} in this System&apos;s Framework Scope?
              </span>
              {canManage ? (
                <span className="sc-btnrow">
                  <button
                    type="button"
                    className="hc-btn primary"
                    disabled={busyId === suggestion.frameworkId}
                    aria-label={`Add ${suggestion.label} to scope`}
                    onClick={() => run(suggestion.frameworkId, post(`/api/systems/${systemId}/framework-scopes`, suggestion.frameworkId), `Failed to add ${suggestion.label}`, true)}
                  >
                    Add to scope
                  </button>
                  <button
                    type="button"
                    className="hc-btn"
                    disabled={busyId === suggestion.frameworkId}
                    aria-label={`Leave out ${suggestion.label}`}
                    onClick={() => run(suggestion.frameworkId, post(`/api/systems/${systemId}/framework-suggestions`, suggestion.frameworkId), `Failed to leave out ${suggestion.label}`, false)}
                  >
                    Leave out
                  </button>
                </span>
              ) : (
                <span className="sc-faint">Only the System&apos;s owner or an Admin decides.</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {leftOut.length > 0 && (
        <ul className="sc-suggest-list quiet" aria-label="Left out">
          {leftOut.map((suggestion) => (
            <li key={suggestion.frameworkId} className="sc-faint">
              Left out: {suggestion.label}, suggested by {joinNames(suggestion.types)}.{" "}
              {canManage && (
                <button
                  type="button"
                  className="sc-link"
                  disabled={busyId === suggestion.frameworkId}
                  aria-label={`Add ${suggestion.label} to scope anyway`}
                  onClick={() => run(suggestion.frameworkId, post(`/api/systems/${systemId}/framework-scopes`, suggestion.frameworkId), `Failed to add ${suggestion.label}`, true)}
                >
                  Add it anyway
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The Profile tab (design proposal A, #245): About (editable by the System's owner or an Admin, #246), Deployment
 * Facets, Information Types and Sensitivity Level, Impact Level per axis (Integrity and Availability), and Business Units and Framework Scope as tags. The permissions are the page's,
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
  sensitivityLevel,
  sensitivityLevels,
  informationTypes,
  belowInformationTypes,
  suggestedFrameworks = [],
}: {
  systemId: string;
  about: SystemAbout;
  canChangeClassification: boolean;
  canManageBusinessUnits: boolean;
  canManageFrameworkScopes: boolean;
  deploymentFacetIds: string[];
  impactLevels: ImpactLevels;
  sensitivityLevel: number | null;
  sensitivityLevels: SensitivityLevelInfo[];
  /** The Information Types the System declares, with their current levels. */
  informationTypes: FloorType[];
  /** The level is declared and below the highest of those types (computed on the server with `isBelowInformationTypes`). */
  belowInformationTypes: boolean;
  /** The Frameworks its Information Types suggest that are not in its Framework Scope (ADR 0013). */
  suggestedFrameworks?: SuggestedFrameworkItem[];
}) {
  // Bumped when the Suggested Frameworks section changes the Framework Scope, so the tags next to it read it again.
  const [scopeVersion, setScopeVersion] = useState(0);
  return (
    <div className="sc-stackgap">
      <About systemId={systemId} about={about} canEdit={canChangeClassification} />
      <DeploymentFacets systemId={systemId} canChange={canChangeClassification} currentIds={deploymentFacetIds} />
      <SensitivityLevelCard
        systemId={systemId}
        canChange={canChangeClassification}
        current={sensitivityLevel}
        levels={sensitivityLevels}
        declaredTypes={informationTypes}
        belowInformationTypes={belowInformationTypes}
        ownerName={about.ownerName}
      />
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
            reloadKey={scopeVersion}
          />
          <SuggestedFrameworks
            systemId={systemId}
            suggestions={suggestedFrameworks}
            canManage={canManageFrameworkScopes}
            onScopeChanged={() => setScopeVersion((current) => current + 1)}
          />
        </div>
      </section>
    </div>
  );
}

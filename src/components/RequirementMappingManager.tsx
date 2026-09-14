"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type Catalog = { id: string; name: string };
type ImpactLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
type Applicability = "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH";

type RequirementSummary = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  framework: string[];
  mandatory: boolean;
  applicability: Applicability;
  question: string | null;
  intent: string | null;
  examples: string[];
  deploymentFacets: Catalog[];
  regulatoryOverlays: Catalog[];
  capabilities: Catalog[];
  minConfidentialityImpactLevel: ImpactLevel | null;
  minIntegrityImpactLevel: ImpactLevel | null;
  minAvailabilityImpactLevel: ImpactLevel | null;
};

const IMPACT_LEVELS: ImpactLevel[] = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

const IMPACT_AXES: { key: "minConfidentialityImpactLevel" | "minIntegrityImpactLevel" | "minAvailabilityImpactLevel"; label: string }[] = [
  { key: "minConfidentialityImpactLevel", label: "Min. Confidentiality" },
  { key: "minIntegrityImpactLevel", label: "Min. Integrity" },
  { key: "minAvailabilityImpactLevel", label: "Min. Availability" },
];

function parseFrameworkInput(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function summarizeTags(requirement: RequirementSummary): string {
  const parts: string[] = [];
  if (requirement.framework.length > 0) parts.push(requirement.framework.join(", "));
  if (requirement.deploymentFacets.length > 0) {
    parts.push(`Facets: ${requirement.deploymentFacets.map((f) => f.name).join(", ")}`);
  }
  if (requirement.regulatoryOverlays.length > 0) {
    parts.push(`Overlays: ${requirement.regulatoryOverlays.map((o) => o.name).join(", ")}`);
  }
  const thresholds = IMPACT_AXES.filter(({ key }) => requirement[key]).map(
    ({ key, label }) => `${label}: ${requirement[key]}`,
  );
  if (thresholds.length > 0) parts.push(thresholds.join(", "));
  return parts.length > 0 ? parts.join(" · ") : "Unscoped (applies regardless)";
}

const NEW_REQUIREMENT_DRAFT = {
  code: "",
  title: "",
  description: "",
  category: "",
  framework: "",
  mandatory: true,
  applicability: "PER_SYSTEM" as Applicability,
  question: "",
  intent: "",
  examples: "",
};

export function RequirementMappingManager() {
  const [requirements, setRequirements] = useState<RequirementSummary[]>([]);
  const [deploymentFacets, setDeploymentFacets] = useState<Catalog[]>([]);
  const [regulatoryOverlays, setRegulatoryOverlays] = useState<Catalog[]>([]);
  const [capabilities, setCapabilities] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedDeploymentFacetIds, setSelectedDeploymentFacetIds] = useState<Set<string>>(new Set());
  const [selectedRegulatoryOverlayIds, setSelectedRegulatoryOverlayIds] = useState<Set<string>>(new Set());
  const [selectedCapabilityIds, setSelectedCapabilityIds] = useState<Set<string>>(new Set());
  const [frameworkInput, setFrameworkInput] = useState("");
  const [impactLevels, setImpactLevels] = useState<{
    minConfidentialityImpactLevel: ImpactLevel | null;
    minIntegrityImpactLevel: ImpactLevel | null;
    minAvailabilityImpactLevel: ImpactLevel | null;
  }>({ minConfidentialityImpactLevel: null, minIntegrityImpactLevel: null, minAvailabilityImpactLevel: null });

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(NEW_REQUIREMENT_DRAFT);

  async function loadAll() {
    const [requirementsRes, deploymentFacetsRes, regulatoryOverlaysRes, capabilitiesRes] = await Promise.all([
      fetch("/api/requirements"),
      fetch("/api/deployment-facets"),
      fetch("/api/regulatory-overlays"),
      fetch("/api/capabilities"),
    ]);
    const requirementsBody = await requirementsRes.json();
    const deploymentFacetsBody = await deploymentFacetsRes.json();
    const regulatoryOverlaysBody = await regulatoryOverlaysRes.json();
    const capabilitiesBody = await capabilitiesRes.json();
    return {
      requirements: (requirementsBody.requirements ?? []) as RequirementSummary[],
      deploymentFacets: (deploymentFacetsBody.deploymentFacets ?? []) as Catalog[],
      regulatoryOverlays: (regulatoryOverlaysBody.regulatoryOverlays ?? []) as Catalog[],
      capabilities: (capabilitiesBody.capabilities ?? []) as Catalog[],
    };
  }

  useEffect(() => {
    let cancelled = false;

    loadAll().then((data) => {
      if (cancelled) return;
      setRequirements(data.requirements);
      setDeploymentFacets(data.deploymentFacets);
      setRegulatoryOverlays(data.regulatoryOverlays);
      setCapabilities(data.capabilities);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const selected = requirements.find((r) => r.id === selectedId) ?? null;

  function selectRequirement(id: string) {
    setCreating(false);
    setSelectedId(id);
    const requirement = requirements.find((r) => r.id === id);
    setSelectedDeploymentFacetIds(new Set(requirement?.deploymentFacets.map((t) => t.id) ?? []));
    setSelectedRegulatoryOverlayIds(new Set(requirement?.regulatoryOverlays.map((o) => o.id) ?? []));
    setSelectedCapabilityIds(new Set(requirement?.capabilities.map((c) => c.id) ?? []));
    setFrameworkInput(requirement?.framework.join(", ") ?? "");
    setImpactLevels({
      minConfidentialityImpactLevel: requirement?.minConfidentialityImpactLevel ?? null,
      minIntegrityImpactLevel: requirement?.minIntegrityImpactLevel ?? null,
      minAvailabilityImpactLevel: requirement?.minAvailabilityImpactLevel ?? null,
    });
    setError(null);
  }

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  }

  async function handleSave() {
    if (!selected) return;
    setError(null);

    const body: {
      deploymentFacetIds?: string[];
      regulatoryOverlayIds?: string[];
      capabilityIds?: string[];
      framework?: string[];
      minConfidentialityImpactLevel?: ImpactLevel | null;
      minIntegrityImpactLevel?: ImpactLevel | null;
      minAvailabilityImpactLevel?: ImpactLevel | null;
    } = {
      capabilityIds: Array.from(selectedCapabilityIds),
      framework: parseFrameworkInput(frameworkInput),
    };
    if (selected.applicability !== "ORGANIZATIONAL") {
      body.deploymentFacetIds = Array.from(selectedDeploymentFacetIds);
      body.regulatoryOverlayIds = Array.from(selectedRegulatoryOverlayIds);
      body.minConfidentialityImpactLevel = impactLevels.minConfidentialityImpactLevel;
      body.minIntegrityImpactLevel = impactLevels.minIntegrityImpactLevel;
      body.minAvailabilityImpactLevel = impactLevels.minAvailabilityImpactLevel;
    }

    const response = await fetch(`/api/requirements/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.json();
      setError(responseBody.error ?? "Failed to save mapping");
      return;
    }

    const data = await loadAll();
    setRequirements(data.requirements);
  }

  function startCreating() {
    setSelectedId("");
    setCreating(true);
    setDraft(NEW_REQUIREMENT_DRAFT);
    setError(null);
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: draft.code,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        framework: parseFrameworkInput(draft.framework),
        mandatory: draft.mandatory,
        applicability: draft.applicability,
        question: draft.applicability === "ORGANIZATIONAL" ? undefined : draft.question || undefined,
        intent: draft.intent || undefined,
        examples: draft.examples
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to create Requirement");
      return;
    }

    const body = await response.json();
    const data = await loadAll();
    setRequirements(data.requirements);
    setCreating(false);
    selectRequirement(body.requirement.id);
  }

  if (loading) {
    return <p>Loading Requirements…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="p-2 font-semibold">Code</th>
              <th className="p-2 font-semibold">Title</th>
              <th className="p-2 font-semibold">Tags</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((requirement) => (
              <tr
                key={requirement.id}
                className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-900 dark:hover:bg-zinc-900"
                onClick={() => selectRequirement(requirement.id)}
              >
                <td className="p-2 whitespace-nowrap">{requirement.code}</td>
                <td className="p-2">{requirement.title}</td>
                <td className="p-2 text-zinc-500">{summarizeTags(requirement)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Requirement
          <select
            aria-label="Requirement"
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={selectedId}
            onChange={(event) => selectRequirement(event.target.value)}
          >
            <option value="">Select a Requirement…</option>
            {requirements.map((requirement) => (
              <option key={requirement.id} value={requirement.id}>
                {requirement.code} — {requirement.title}
              </option>
            ))}
          </select>
        </label>
        <Button variant="secondary" onClick={startCreating}>
          + New Requirement
        </Button>
      </div>

      {creating && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-2 rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h3 className="text-sm font-semibold">New Requirement</h3>
          <input
            aria-label="Code"
            placeholder="Code (e.g. SEC-042)"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={draft.code}
            onChange={(event) => setDraft((prev) => ({ ...prev, code: event.target.value }))}
            required
          />
          <input
            aria-label="Title"
            placeholder="Title"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={draft.title}
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            required
          />
          <textarea
            aria-label="Description"
            placeholder="Description"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
            required
          />
          <input
            aria-label="Category"
            placeholder="Category (e.g. Security)"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={draft.category}
            onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))}
            required
          />
          <input
            aria-label="Framework(s)"
            placeholder="Framework(s), comma-separated — e.g. ISO27001:2022 Annex A, CSA CCM 4.0"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={draft.framework}
            onChange={(event) => setDraft((prev) => ({ ...prev, framework: event.target.value }))}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.mandatory}
              onChange={(event) => setDraft((prev) => ({ ...prev, mandatory: event.target.checked }))}
            />
            Mandatory
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Applicability
            <select
              aria-label="Applicability"
              className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
              value={draft.applicability}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, applicability: event.target.value as Applicability }))
              }
            >
              <option value="ORGANIZATIONAL">Organizational</option>
              <option value="PER_SYSTEM">Per-System</option>
              <option value="BOTH">Both</option>
            </select>
          </label>
          {draft.applicability !== "ORGANIZATIONAL" && (
            <>
              <input
                aria-label="Self-Assessment Question"
                placeholder="Self-Assessment Question"
                className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
                value={draft.question}
                onChange={(event) => setDraft((prev) => ({ ...prev, question: event.target.value }))}
                required
              />
              <input
                aria-label="Intent"
                placeholder="Intent (why the question matters, optional)"
                className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
                value={draft.intent}
                onChange={(event) => setDraft((prev) => ({ ...prev, intent: event.target.value }))}
              />
              <textarea
                aria-label="Examples"
                placeholder="Example ways to satisfy it, one per line (optional)"
                className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
                value={draft.examples}
                onChange={(event) => setDraft((prev) => ({ ...prev, examples: event.target.value }))}
              />
            </>
          )}
          <Button type="submit" variant="primary">
            Create
          </Button>
        </form>
      )}

      {selected && (
        <div className="flex flex-col gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <h3 className="text-sm font-semibold">
            {selected.code} — {selected.title}
          </h3>

          <label className="flex flex-col gap-1 text-sm">
            Framework(s)
            <input
              aria-label="Framework(s)"
              className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
              placeholder="Comma-separated — e.g. ISO27001:2022 Annex A, CSA CCM 4.0"
              value={frameworkInput}
              onChange={(event) => setFrameworkInput(event.target.value)}
            />
          </label>

          {selected.applicability === "ORGANIZATIONAL" ? (
            <p className="text-sm text-zinc-500">
              Organizational requirements are never assessed per System, so they can&apos;t be
              scoped to Deployment Facets, Regulatory Overlays, or Impact Level.
            </p>
          ) : (
            <>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">
                  Applicable Deployment Facets (none selected = all)
                </legend>
                {deploymentFacets.map((facet) => (
                  <label key={facet.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedDeploymentFacetIds.has(facet.id)}
                      onChange={() =>
                        setSelectedDeploymentFacetIds((prev) => toggle(prev, facet.id))
                      }
                    />
                    {facet.name}
                  </label>
                ))}
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">
                  Applicable Regulatory Overlays (none selected = all)
                </legend>
                {regulatoryOverlays.map((overlay) => (
                  <label key={overlay.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedRegulatoryOverlayIds.has(overlay.id)}
                      onChange={() =>
                        setSelectedRegulatoryOverlayIds((prev) => toggle(prev, overlay.id))
                      }
                    />
                    {overlay.name}
                  </label>
                ))}
              </fieldset>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-sm font-semibold">
                  Minimum Impact Level thresholds (not classified = no threshold)
                </legend>
                {IMPACT_AXES.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    {label}
                    <select
                      aria-label={label}
                      className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
                      value={impactLevels[key] ?? ""}
                      onChange={(event) =>
                        setImpactLevels((prev) => ({
                          ...prev,
                          [key]: event.target.value === "" ? null : (event.target.value as ImpactLevel),
                        }))
                      }
                    >
                      <option value="">No threshold</option>
                      {IMPACT_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </fieldset>
            </>
          )}

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-semibold">Fulfilling Capabilities</legend>
            {capabilities.map((capability) => (
              <label key={capability.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedCapabilityIds.has(capability.id)}
                  onChange={() => setSelectedCapabilityIds((prev) => toggle(prev, capability.id))}
                />
                {capability.name}
              </label>
            ))}
          </fieldset>

          <Button variant="secondary" onClick={handleSave}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

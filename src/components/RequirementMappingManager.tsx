"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type Catalog = { id: string; name: string };
type RequirementSummary = {
  id: string;
  code: string;
  title: string;
  applicability: "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH";
  deploymentFacets: Catalog[];
  regulatoryOverlays: Catalog[];
  capabilities: Catalog[];
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
    setSelectedId(id);
    const requirement = requirements.find((r) => r.id === id);
    setSelectedDeploymentFacetIds(new Set(requirement?.deploymentFacets.map((t) => t.id) ?? []));
    setSelectedRegulatoryOverlayIds(new Set(requirement?.regulatoryOverlays.map((o) => o.id) ?? []));
    setSelectedCapabilityIds(new Set(requirement?.capabilities.map((c) => c.id) ?? []));
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
    } = {
      capabilityIds: Array.from(selectedCapabilityIds),
    };
    if (selected.applicability !== "ORGANIZATIONAL") {
      body.deploymentFacetIds = Array.from(selectedDeploymentFacetIds);
      body.regulatoryOverlayIds = Array.from(selectedRegulatoryOverlayIds);
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

  if (loading) {
    return <p>Loading Requirements…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <label className="flex flex-col gap-1 text-sm">
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

      {selected && (
        <div className="flex flex-col gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          {selected.applicability === "ORGANIZATIONAL" ? (
            <p className="text-sm text-zinc-500">
              Organizational requirements are never assessed per System, so they can&apos;t be
              scoped to Deployment Facets or Regulatory Overlays.
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

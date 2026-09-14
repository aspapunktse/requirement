"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { IMPACT_LEVELS, type ImpactLevel } from "@/components/ImpactLevelsChanger";

type DeploymentFacet = { id: string; name: string };

const IMPACT_AXES: { key: "confidentialityImpactLevel" | "integrityImpactLevel" | "availabilityImpactLevel"; label: string }[] = [
  { key: "confidentialityImpactLevel", label: "Confidentiality" },
  { key: "integrityImpactLevel", label: "Integrity" },
  { key: "availabilityImpactLevel", label: "Availability" },
];

export function NewSystemForm() {
  const router = useRouter();
  const [deploymentFacets, setDeploymentFacets] = useState<DeploymentFacet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [impactLevels, setImpactLevels] = useState<Record<string, ImpactLevel | null>>({
    confidentialityImpactLevel: null,
    integrityImpactLevel: null,
    availabilityImpactLevel: null,
  });
  const [deploymentFacetIds, setDeploymentFacetIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/deployment-facets")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setDeploymentFacets(body.deploymentFacets ?? []);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleFacet(facetId: string, checked: boolean) {
    setDeploymentFacetIds((prev) =>
      checked ? [...prev, facetId] : prev.filter((id) => id !== facetId),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/systems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        vendor: vendor || undefined,
        description: description || undefined,
        confidentialityImpactLevel: impactLevels.confidentialityImpactLevel ?? undefined,
        integrityImpactLevel: impactLevels.integrityImpactLevel ?? undefined,
        availabilityImpactLevel: impactLevels.availabilityImpactLevel ?? undefined,
        deploymentFacetIds,
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to create System");
      return;
    }

    const body = await response.json();
    router.push(`/systems/${body.system.id}`);
  }

  if (loading) {
    return <p>Loading Deployment Facets…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend>
          Deployment Facets — select one or more (more than one means Hybrid)
        </legend>
        {deploymentFacets.map((facet) => (
          <label key={facet.id} className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={deploymentFacetIds.includes(facet.id)}
              onChange={(event) => toggleFacet(facet.id, event.target.checked)}
            />
            {facet.name}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        Vendor (optional)
        <input
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={vendor}
          onChange={(event) => setVendor(event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Description (optional)
        <textarea
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend>Impact Level (optional, set independently per axis)</legend>
        {IMPACT_AXES.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 font-normal">
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
              <option value="">Not classified</option>
              {IMPACT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <Button type="submit" variant="primary" disabled={deploymentFacetIds.length === 0}>
        Create
      </Button>
    </form>
  );
}

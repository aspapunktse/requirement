"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

type DeploymentFacet = { id: string; name: string };

function sameSet(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((id) => bSet.has(id));
}

export function DeploymentFacetsChanger({
  systemId,
  currentDeploymentFacetIds,
}: {
  systemId: string;
  currentDeploymentFacetIds: string[];
}) {
  const router = useRouter();
  const [deploymentFacets, setDeploymentFacets] = useState<DeploymentFacet[]>([]);
  const [selectedIds, setSelectedIds] = useState(currentDeploymentFacetIds);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/deployment-facets")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setDeploymentFacets(body.deploymentFacets ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function toggleFacet(facetId: string, checked: boolean) {
    setSelectedIds((prev) => (checked ? [...prev, facetId] : prev.filter((id) => id !== facetId)));
  }

  const unchanged = sameSet(selectedIds, currentDeploymentFacetIds);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
        const body = await response.json();
        setError(body.error ?? "Failed to change Deployment Facets");
        return;
      }

      const body = await response.json();
      setMessage(
        `Deployment Facets changed: ${body.added} Control(s) added, ${body.removed} untouched Control(s) removed.`,
      );
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-zinc-500">{message}</p>}

      <fieldset className="flex flex-col gap-1 text-sm">
        <legend>Deployment Facets — more than one means Hybrid</legend>
        {deploymentFacets.map((facet) => (
          <label key={facet.id} className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              aria-label={facet.name}
              checked={selectedIds.includes(facet.id)}
              onChange={(event) => toggleFacet(facet.id, event.target.checked)}
            />
            {facet.name}
          </label>
        ))}
      </fieldset>

      <Button type="submit" variant="secondary" disabled={saving || unchanged || selectedIds.length === 0}>
        Change Deployment Facets
      </Button>
    </form>
  );
}

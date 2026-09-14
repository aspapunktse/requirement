"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type RegulatoryOverlay = { id: string; name: string; description: string | null };

export function SystemRegulatoryOverlays({
  systemId,
  canManage,
}: {
  systemId: string;
  canManage: boolean;
}) {
  const [declared, setDeclared] = useState<RegulatoryOverlay[] | null>(null);
  const [catalog, setCatalog] = useState<RegulatoryOverlay[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [declaredRes, catalogRes] = await Promise.all([
      fetch(`/api/systems/${systemId}/regulatory-overlays`),
      canManage ? fetch("/api/regulatory-overlays") : Promise.resolve(null),
    ]);
    const declaredBody = await declaredRes.json();
    setDeclared(declaredBody.regulatoryOverlays ?? []);
    if (catalogRes) {
      const catalogBody = await catalogRes.json();
      setCatalog(catalogBody.regulatoryOverlays ?? []);
    }
  }

  useEffect(() => {
    let cancelled = false;

    load().then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, canManage]);

  async function handleDeclare(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    setError(null);

    const response = await fetch(`/api/systems/${systemId}/regulatory-overlays`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regulatoryOverlayId: selectedId }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to declare Regulatory Overlay");
      return;
    }

    setSelectedId("");
    const body = await response.json();
    setDeclared(body.regulatoryOverlays);
  }

  async function handleRemove(overlayId: string) {
    setError(null);

    const response = await fetch(`/api/systems/${systemId}/regulatory-overlays/${overlayId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to remove Regulatory Overlay");
      return;
    }

    const body = await response.json();
    setDeclared(body.regulatoryOverlays);
  }

  if (declared === null) {
    return <p>Loading Regulatory Overlays…</p>;
  }

  const declaredIds = new Set(declared.map((o) => o.id));
  const available = catalog.filter((o) => !declaredIds.has(o.id));

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {declared.length === 0 ? (
        <p className="text-sm text-zinc-500">No Regulatory Overlays declared for this System.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {declared.map((overlay) => (
            <li
              key={overlay.id}
              className="flex items-center justify-between rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800"
            >
              <span>{overlay.name}</span>
              {canManage && (
                <Button className="px-2 py-0.5 text-xs" onClick={() => handleRemove(overlay.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form onSubmit={handleDeclare} className="flex gap-2">
          <select
            aria-label="Declare a Regulatory Overlay"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Select a Regulatory Overlay…</option>
            {available.map((overlay) => (
              <option key={overlay.id} value={overlay.id}>
                {overlay.name}
              </option>
            ))}
          </select>
          <Button type="submit" variant="primary">
            Declare
          </Button>
        </form>
      )}
    </div>
  );
}

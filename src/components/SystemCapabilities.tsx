"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type Capability = { id: string; name: string; description: string | null };

export function SystemCapabilities({
  systemId,
  canManage,
}: {
  systemId: string;
  canManage: boolean;
}) {
  const [declared, setDeclared] = useState<Capability[] | null>(null);
  const [catalog, setCatalog] = useState<Capability[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [declaredRes, catalogRes] = await Promise.all([
      fetch(`/api/systems/${systemId}/capabilities`),
      canManage ? fetch("/api/capabilities") : Promise.resolve(null),
    ]);
    const declaredBody = await declaredRes.json();
    setDeclared(declaredBody.capabilities ?? []);
    if (catalogRes) {
      const catalogBody = await catalogRes.json();
      setCatalog(catalogBody.capabilities ?? []);
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

    const response = await fetch(`/api/systems/${systemId}/capabilities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capabilityId: selectedId }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to declare Capability");
      return;
    }

    setSelectedId("");
    const body = await response.json();
    setDeclared(body.capabilities);
  }

  async function handleRemove(capabilityId: string) {
    setError(null);

    const response = await fetch(`/api/systems/${systemId}/capabilities/${capabilityId}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to remove Capability");
      return;
    }

    const body = await response.json();
    setDeclared(body.capabilities);
  }

  if (declared === null) {
    return <p>Loading Capabilities…</p>;
  }

  const declaredIds = new Set(declared.map((c) => c.id));
  const available = catalog.filter((c) => !declaredIds.has(c.id));

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {declared.length === 0 ? (
        <p className="text-sm text-zinc-500">No Capabilities declared for this System.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {declared.map((capability) => (
            <li
              key={capability.id}
              className="flex items-center justify-between rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800"
            >
              <span>{capability.name}</span>
              {canManage && (
                <Button className="px-2 py-0.5 text-xs" onClick={() => handleRemove(capability.id)}>
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
            aria-label="Declare a Capability"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Select a Capability…</option>
            {available.map((capability) => (
              <option key={capability.id} value={capability.id}>
                {capability.name}
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

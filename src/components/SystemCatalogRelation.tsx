"use client";

import { useEffect, useState } from "react";
import { frameworkLabel } from "@/lib/framework-label";
import { Button } from "@/components/ui/Button";

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

type SystemCatalogRelationProps = {
  systemId: string;
  canManage: boolean;
  /** Base API path for this System-level relation, e.g. "/api/systems/{id}/business-units". */
  resourcePath: string;
  /** Key the relation endpoint nests its array under, e.g. "businessUnits". */
  resourceKey: string;
  /** Catalog list endpoint to pick new entries from, e.g. "/api/business-units". */
  catalogPath: string;
  /** Key the catalog endpoint nests its array under, e.g. "businessUnits". */
  catalogKey: string;
  /** POST/id-param field name the declare endpoint expects, e.g. "businessUnitId". */
  idField: string;
  /** Singular, human-readable name of one entry, e.g. "Business Unit". */
  itemLabel: string;
  emptyLabel?: string;
};

/**
 * A generic "declare/remove entries from an admin catalog on a System"
 * widget — the shared shape behind Business Unit and Framework Scope
 * declaration.
 */
export function SystemCatalogRelation({
  systemId,
  canManage,
  resourcePath,
  resourceKey,
  catalogPath,
  catalogKey,
  idField,
  itemLabel,
  emptyLabel,
}: SystemCatalogRelationProps) {
  const [declared, setDeclared] = useState<CatalogItem[] | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [declaredRes, catalogRes] = await Promise.all([
      fetch(resourcePath),
      canManage ? fetch(catalogPath) : Promise.resolve(null),
    ]);
    const declaredBody = await declaredRes.json();
    setDeclared(declaredBody[resourceKey] ?? []);
    if (catalogRes) {
      const catalogBody = await catalogRes.json();
      setCatalog(catalogBody[catalogKey] ?? []);
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

    const response = await fetch(resourcePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [idField]: selectedId }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? `Failed to declare ${itemLabel}`);
      return;
    }

    setSelectedId("");
    const body = await response.json();
    setDeclared(body[resourceKey]);
  }

  async function handleRemove(itemId: string) {
    setError(null);

    const response = await fetch(`${resourcePath}/${itemId}`, { method: "DELETE" });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? `Failed to remove ${itemLabel}`);
      return;
    }

    const body = await response.json();
    setDeclared(body[resourceKey]);
  }

  if (declared === null) {
    return <p>Loading {itemLabel}s…</p>;
  }

  const declaredIds = new Set(declared.map((item) => item.id));
  const available = catalog.filter((item) => !declaredIds.has(item.id) && item.status !== "DRAFT");

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      {declared.length === 0 ? (
        <p className="text-sm text-zinc-500">{emptyLabel ?? `No ${itemLabel}s declared for this System.`}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {declared.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800"
            >
              <span>
                {frameworkLabel(item)}
                {item.isBase && (
                  <span className="ml-2 text-xs text-zinc-500">Base Framework, always in scope</span>
                )}
                {item.status === "DRAFT" && (
                  <span className="ml-2 text-xs text-zinc-500">Draft, no effect until published</span>
                )}
              </span>
              {canManage && !item.isBase && (
                <Button className="px-2 py-0.5 text-xs" onClick={() => handleRemove(item.id)}>
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
            aria-label={`Declare a ${itemLabel}`}
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            <option value="">Select a {itemLabel}…</option>
            {available.map((item) => (
              <option key={item.id} value={item.id}>
                {frameworkLabel(item)}
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

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type CatalogItem = { id: string; name: string; description: string | null; [flag: string]: unknown };
type Draft = { name: string; description: string; flag: boolean };

type CatalogManagerProps = {
  /** Base API path for this catalog, e.g. "/api/deployment-facets". */
  resourcePath: string;
  /** Key the list endpoint nests its array under, e.g. "deploymentFacets". */
  resourceKey: string;
  /** Singular, human-readable name of one entry, e.g. "Deployment Facet". */
  itemLabel: string;
  /** Plural form, e.g. "Categories". Defaults to `${itemLabel}s`. */
  itemLabelPlural?: string;
  /** An optional on/off setting on each entry (e.g. a Deployment Facet's "Needs vendor details"): the field's key in the API, its label and a one-line hint. */
  flag?: { key: string; label: string; hint?: string };
};

async function fetchItems(resourcePath: string, resourceKey: string): Promise<CatalogItem[]> {
  const response = await fetch(resourcePath);
  const body = await response.json();
  return body[resourceKey] ?? [];
}

/**
 * A simple admin CRUD screen (list, create, edit) for one of the small
 * name+description catalogs (Deployment Facet, Business Unit, ...).
 */
export function CatalogManager({
  resourcePath,
  resourceKey,
  itemLabel,
  itemLabelPlural = `${itemLabel}s`,
  flag,
}: CatalogManagerProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newFlag, setNewFlag] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  function draftFor(item: CatalogItem): Draft {
    return drafts[item.id] ?? { name: item.name, description: item.description ?? "", flag: flag ? item[flag.key] === true : false };
  }

  function updateDraft(item: CatalogItem, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [item.id]: { ...draftFor(item), ...patch } }));
  }

  async function refresh() {
    setItems(await fetchItems(resourcePath, resourceKey));
  }

  useEffect(() => {
    let cancelled = false;

    fetchItems(resourcePath, resourceKey).then((fetched) => {
      if (cancelled) return;
      setItems(fetched);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [resourcePath, resourceKey]);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch(resourcePath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDescription || undefined, ...(flag && { [flag.key]: newFlag }) }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? `Failed to create ${itemLabel}`);
      return;
    }

    setNewName("");
    setNewDescription("");
    setNewFlag(false);
    await refresh();
  }

  async function handleSave(item: CatalogItem) {
    setError(null);
    const draft = draftFor(item);

    const response = await fetch(`${resourcePath}/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draft.name, description: draft.description, ...(flag && { [flag.key]: draft.flag }) }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? `Failed to update ${itemLabel}`);
      return;
    }

    await refresh();
  }

  async function handleDelete(item: CatalogItem) {
    setError(null);

    const response = await fetch(`${resourcePath}/${item.id}`, { method: "DELETE" });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? `Failed to retire ${itemLabel}`);
      return;
    }

    await refresh();
  }

  if (loading) {
    return <p>Loading {itemLabelPlural}…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-rg-danger">{error}</p>}

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const draft = draftFor(item);
          return (
            <li key={item.id} className="rounded border border-rg-line p-3">
              <input
                aria-label={`Name for ${item.name}`}
                className="w-full rounded border border-rg-control p-2 text-sm font-medium"
                value={draft.name}
                onChange={(event) => updateDraft(item, { name: event.target.value })}
              />
              <textarea
                aria-label={`Description for ${item.name}`}
                className="mt-2 w-full rounded border border-rg-control p-2 text-sm"
                value={draft.description}
                onChange={(event) => updateDraft(item, { description: event.target.value })}
              />
              {flag && (
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`${flag.label} for ${item.name}`}
                    checked={draft.flag}
                    onChange={(event) => updateDraft(item, { flag: event.target.checked })}
                  />
                  <span>
                    {flag.label}
                    {flag.hint && <span className="text-rg-muted"> {flag.hint}</span>}
                  </span>
                </label>
              )}
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" onClick={() => handleSave(item)}>
                  Save
                </Button>
                <Button onClick={() => handleDelete(item)}>Retire</Button>
              </div>
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2 border-t border-rg-line pt-4"
      >
        <h2 className="text-base">Add a {itemLabel}</h2>
        <input
          aria-label="Name"
          placeholder="Name"
          className="rounded border border-rg-control p-2 text-sm"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          required
        />
        <textarea
          aria-label={`New ${itemLabel} description`}
          placeholder="Description (optional)"
          className="rounded border border-rg-control p-2 text-sm"
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
        />
        {flag && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" aria-label={`New ${itemLabel}: ${flag.label}`} checked={newFlag} onChange={(event) => setNewFlag(event.target.checked)} />
            <span>{flag.label}</span>
          </label>
        )}
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

type CatalogItem = { id: string; name: string; description: string | null };
type Draft = { name: string; description: string };

type CatalogManagerProps = {
  /** Base API path for this catalog, e.g. "/api/system-types". */
  resourcePath: string;
  /** Key the list endpoint nests its array under, e.g. "systemTypes". */
  resourceKey: string;
  /** Singular, human-readable name of one entry, e.g. "System Type". */
  itemLabel: string;
  /** Plural form, e.g. "Capabilities". Defaults to `${itemLabel}s`. */
  itemLabelPlural?: string;
};

async function fetchItems(resourcePath: string, resourceKey: string): Promise<CatalogItem[]> {
  const response = await fetch(resourcePath);
  const body = await response.json();
  return body[resourceKey] ?? [];
}

/**
 * A simple admin CRUD screen (list, create, edit) for one of the small
 * name+description catalogs (System Type, Capability, ...).
 */
export function CatalogManager({
  resourcePath,
  resourceKey,
  itemLabel,
  itemLabelPlural = `${itemLabel}s`,
}: CatalogManagerProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  function draftFor(item: CatalogItem): Draft {
    return drafts[item.id] ?? { name: item.name, description: item.description ?? "" };
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
      body: JSON.stringify({ name: newName, description: newDescription || undefined }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? `Failed to create ${itemLabel}`);
      return;
    }

    setNewName("");
    setNewDescription("");
    await refresh();
  }

  async function handleSave(item: CatalogItem) {
    setError(null);
    const draft = draftFor(item);

    const response = await fetch(`${resourcePath}/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: draft.name, description: draft.description }),
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
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const draft = draftFor(item);
          return (
            <li key={item.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <input
                aria-label={`Name for ${item.name}`}
                className="w-full rounded border border-zinc-200 p-2 text-sm font-medium dark:border-zinc-800 dark:bg-transparent"
                value={draft.name}
                onChange={(event) => updateDraft(item, { name: event.target.value })}
              />
              <textarea
                aria-label={`Description for ${item.name}`}
                className="mt-2 w-full rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
                value={draft.description}
                onChange={(event) => updateDraft(item, { description: event.target.value })}
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
                  onClick={() => handleSave(item)}
                >
                  Save
                </button>
                <button
                  type="button"
                  className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
                  onClick={() => handleDelete(item)}
                >
                  Retire
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
      >
        <h2 className="text-sm font-semibold">Add a {itemLabel}</h2>
        <input
          aria-label="Name"
          placeholder="Name"
          className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          required
        />
        <textarea
          aria-label={`New ${itemLabel} description`}
          placeholder="Description (optional)"
          className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={newDescription}
          onChange={(event) => setNewDescription(event.target.value)}
        />
        <button
          type="submit"
          className="self-start rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
        >
          Create
        </button>
      </form>
    </div>
  );
}

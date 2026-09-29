"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { frameworkLabel } from "@/lib/framework-label";

type Framework = {
  id: string;
  name: string;
  version: string;
  description: string | null;
  strictComplianceRequired: boolean;
  licensing: "PARAPHRASE_ONLY" | "QUOTABLE";
  isBase: boolean;
  status: "DRAFT" | "PUBLISHED";
  _count?: { requirements: number };
};
type Draft = { name: string; version: string; description: string; strictComplianceRequired: boolean };

const EMPTY_DRAFT: Draft = { name: "", version: "", description: "", strictComplianceRequired: false };

async function fetchFrameworks(): Promise<Framework[]> {
  const response = await fetch("/api/frameworks");
  const body = await response.json();
  return body.frameworks ?? [];
}

/**
 * Admin CRUD for the Framework catalog — like CatalogManager's generic
 * name+description screen, but with the version and the extra
 * strictComplianceRequired flag (some frameworks only accept 100% Fulfilled
 * — no partial credit for Waived/Not Applicable — when computing compliance
 * percentage against them). Each row also shows its read-only status
 * (Draft/Published), base-Framework marker and Requirement count. Authoring
 * Requirements, Control Mappings and publishing are #73. See #55, #72.
 */
export function FrameworkManager() {
  const [items, setItems] = useState<Framework[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);

  function draftFor(item: Framework): Draft {
    return (
      drafts[item.id] ?? {
        name: item.name,
        version: item.version,
        description: item.description ?? "",
        strictComplianceRequired: item.strictComplianceRequired,
      }
    );
  }

  function updateDraft(item: Framework, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [item.id]: { ...draftFor(item), ...patch } }));
  }

  async function refresh() {
    setItems(await fetchFrameworks());
  }

  useEffect(() => {
    let cancelled = false;

    fetchFrameworks().then((fetched) => {
      if (cancelled) return;
      setItems(fetched);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/frameworks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newDraft.name,
        version: newDraft.version,
        description: newDraft.description || undefined,
        strictComplianceRequired: newDraft.strictComplianceRequired,
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to create Framework");
      return;
    }

    setNewDraft(EMPTY_DRAFT);
    await refresh();
  }

  async function handleSave(item: Framework) {
    setError(null);
    const draft = draftFor(item);

    const response = await fetch(`/api/frameworks/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to update Framework");
      return;
    }

    await refresh();
  }

  async function handleDelete(item: Framework) {
    setError(null);

    const response = await fetch(`/api/frameworks/${item.id}`, { method: "DELETE" });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to retire Framework");
      return;
    }

    await refresh();
  }

  if (loading) {
    return <p>Loading Frameworks…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const draft = draftFor(item);
          return (
            <li key={item.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex gap-2">
                <input
                  aria-label={`Name for ${frameworkLabel(item)}`}
                  className="w-full rounded border border-zinc-200 p-2 text-sm font-medium dark:border-zinc-800 dark:bg-transparent"
                  value={draft.name}
                  onChange={(event) => updateDraft(item, { name: event.target.value })}
                />
                <input
                  aria-label={`Version for ${frameworkLabel(item)}`}
                  className="w-32 rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
                  value={draft.version}
                  onChange={(event) => updateDraft(item, { version: event.target.value })}
                />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {item.status === "PUBLISHED" ? "Published" : "Draft"}
                {item.isBase ? " · Base Framework" : ""}
                {` · ${item._count?.requirements ?? 0} Requirements`}
                {item.licensing === "PARAPHRASE_ONLY" ? " · Paraphrase only" : " · Quotable"}
              </p>
              <textarea
                aria-label={`Description for ${frameworkLabel(item)}`}
                className="mt-2 w-full rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
                value={draft.description}
                onChange={(event) => updateDraft(item, { description: event.target.value })}
              />
              <label className="mt-2 flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.strictComplianceRequired}
                  onChange={(event) => updateDraft(item, { strictComplianceRequired: event.target.checked })}
                />
                Requires 100% Fulfilled (no partial credit for Waived/Not Applicable)
              </label>
              <div className="mt-2 flex gap-2">
                <Button variant="secondary" onClick={() => handleSave(item)}>
                  Save
                </Button>
                <Button
                  onClick={() => handleDelete(item)}
                  disabled={item.isBase}
                  title={item.isBase ? "The base Framework can't be retired" : undefined}
                >
                  Retire
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
      >
        <h2 className="text-base">Add a Framework</h2>
        <input
          aria-label="Name"
          placeholder="Name"
          className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={newDraft.name}
          onChange={(event) => setNewDraft((prev) => ({ ...prev, name: event.target.value }))}
          required
        />
        <input
          aria-label="Version"
          placeholder="Version (e.g. 2022)"
          className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={newDraft.version}
          onChange={(event) => setNewDraft((prev) => ({ ...prev, version: event.target.value }))}
          required
        />
        <textarea
          aria-label="New Framework description"
          placeholder="Description (optional)"
          className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={newDraft.description}
          onChange={(event) => setNewDraft((prev) => ({ ...prev, description: event.target.value }))}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={newDraft.strictComplianceRequired}
            onChange={(event) =>
              setNewDraft((prev) => ({ ...prev, strictComplianceRequired: event.target.checked }))
            }
          />
          Requires 100% Fulfilled (no partial credit for Waived/Not Applicable)
        </label>
        <Button type="submit" variant="primary">
          Create
        </Button>
      </form>
    </div>
  );
}

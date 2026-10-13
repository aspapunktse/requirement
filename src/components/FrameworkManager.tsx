"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { CoverageCounts } from "@/components/CoverageCounts";
import type { CoverageSummary } from "@/lib/coverage-state";
import { frameworkLabel } from "@/lib/framework-label";
import { buildLineages } from "@/lib/framework-lineage";
import { FrameworkLineage } from "@/components/FrameworkLineage";

export type FrameworkRow = {
  id: string;
  name: string;
  version: string;
  description: string | null;
  strictComplianceRequired: boolean;
  licensing: "PARAPHRASE_ONLY" | "QUOTABLE";
  supersedesId: string | null;
  isBase: boolean;
  status: "DRAFT" | "PUBLISHED";
  _count?: { requirements: number };
  // Covered / gap / accepted counts (F-FW.6); GET /api/frameworks and the server page both supply it.
  coverage?: CoverageSummary;
};
type Draft = {
  name: string;
  version: string;
  description: string;
  strictComplianceRequired: boolean;
  licensing: FrameworkRow["licensing"];
  supersedesId: string;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  version: "",
  description: "",
  strictComplianceRequired: false,
  licensing: "PARAPHRASE_ONLY",
  supersedesId: "",
};

const INPUT_CLASS = "rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";

async function fetchFrameworks(): Promise<FrameworkRow[]> {
  const response = await fetch("/api/frameworks");
  const body = await response.json();
  return body.frameworks ?? [];
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return (await response.json()).error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Admin CRUD for the Framework catalog: name, version, the Framework it
 * supersedes, licensing (paraphrase-only vs quotable), and the extra
 * strictComplianceRequired flag (some frameworks only accept 100% Fulfilled
 * — no partial credit for Waived/Not Applicable — when computing compliance
 * percentage against them). Each row shows its status (Draft/Published) and
 * Requirement count, links to the per-Framework authoring page (Requirements
 * and Control Mappings), and has the one-way Publish action for a Draft.
 * The server page passes the initial list; changes reload it from the API.
 * See #55, #72, #73.
 */
export function FrameworkManager({ initialFrameworks }: { initialFrameworks: FrameworkRow[] }) {
  const [items, setItems] = useState<FrameworkRow[]>(initialFrameworks);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT);
  // Only Compliance Managers and Admins reach this component, and they see Drafts, so every Framework is in `items`.
  const lineages = buildLineages(items, true);

  function draftFor(item: FrameworkRow): Draft {
    return (
      drafts[item.id] ?? {
        name: item.name,
        version: item.version,
        description: item.description ?? "",
        strictComplianceRequired: item.strictComplianceRequired,
        licensing: item.licensing,
        supersedesId: item.supersedesId ?? "",
      }
    );
  }

  function updateDraft(item: FrameworkRow, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [item.id]: { ...draftFor(item), ...patch } }));
  }

  async function refresh() {
    setItems(await fetchFrameworks());
    setDrafts({});
  }

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
        licensing: newDraft.licensing,
        supersedesId: newDraft.supersedesId || null,
      }),
    });

    if (!response.ok) {
      setError(await errorMessage(response, "Failed to create Framework"));
      return;
    }

    setNewDraft(EMPTY_DRAFT);
    await refresh();
  }

  async function handleSave(item: FrameworkRow) {
    setError(null);
    const draft = draftFor(item);

    const response = await fetch(`/api/frameworks/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, supersedesId: draft.supersedesId || null }),
    });

    if (!response.ok) {
      setError(await errorMessage(response, "Failed to update Framework"));
      return;
    }

    await refresh();
  }

  async function handlePublish(item: FrameworkRow) {
    const count = item._count?.requirements ?? 0;
    const confirmed = window.confirm(
      `Publish ${frameworkLabel(item)} (${count} Requirement${count === 1 ? "" : "s"})? ` +
        "Once published it becomes visible to everyone and can be put in a System's Framework Scope. " +
        "This can't be undone.",
    );
    if (!confirmed) return;
    setError(null);

    const response = await fetch(`/api/frameworks/${item.id}/publish`, { method: "POST" });

    if (!response.ok) {
      setError(await errorMessage(response, "Failed to publish Framework"));
      return;
    }

    await refresh();
  }

  async function handleDelete(item: FrameworkRow) {
    setError(null);

    const response = await fetch(`/api/frameworks/${item.id}`, { method: "DELETE" });

    if (!response.ok) {
      setError(await errorMessage(response, "Failed to retire Framework"));
      return;
    }

    await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((item) => {
          const draft = draftFor(item);
          const label = frameworkLabel(item);
          return (
            <li key={item.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{label}</span>
                <StatusChip tone={item.status === "PUBLISHED" ? "success" : "warn"}>
                  {item.status === "PUBLISHED" ? "Published" : "Draft"}
                </StatusChip>
                {item.isBase && <StatusChip tone="accent">Base Framework</StatusChip>}
                <span className="text-xs text-zinc-500">
                  {`${item._count?.requirements ?? 0} Requirements`}
                </span>
                <span className="ml-auto flex gap-3">
                  <Link
                    href={`/frameworks/${item.id}/coverage`}
                    className="text-ems-blue hover:underline"
                    aria-label={`Coverage of ${label}`}
                  >
                    Coverage &rarr;
                  </Link>
                  <Link
                    href={`/admin/frameworks/${item.id}`}
                    className="text-ems-blue hover:underline"
                    aria-label={`Requirements and Control Mappings for ${label}`}
                  >
                    Requirements &amp; mappings &rarr;
                  </Link>
                </span>
              </div>
              {item.coverage && (
                <div className="mb-2">
                  <CoverageCounts summary={item.coverage} />
                </div>
              )}
              {lineages.has(item.id) && (
                <div className="mb-2">
                  <FrameworkLineage paths={lineages.get(item.id)!} />
                </div>
              )}
              <div className="flex gap-2">
                <input
                  aria-label={`Name for ${label}`}
                  className={`${INPUT_CLASS} w-full font-medium`}
                  value={draft.name}
                  onChange={(event) => updateDraft(item, { name: event.target.value })}
                />
                <input
                  aria-label={`Version for ${label}`}
                  className={`${INPUT_CLASS} w-32`}
                  value={draft.version}
                  onChange={(event) => updateDraft(item, { version: event.target.value })}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500">
                  Supersedes
                  <select
                    aria-label={`Supersedes for ${label}`}
                    className={`${INPUT_CLASS} text-zinc-900 dark:text-zinc-100`}
                    value={draft.supersedesId}
                    onChange={(event) => updateDraft(item, { supersedesId: event.target.value })}
                  >
                    <option value="">Nothing (first version)</option>
                    {items
                      .filter((other) => other.id !== item.id)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          {frameworkLabel(other)}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs text-zinc-500">
                  Licensing
                  <select
                    aria-label={`Licensing for ${label}`}
                    className={`${INPUT_CLASS} text-zinc-900 dark:text-zinc-100`}
                    value={draft.licensing}
                    onChange={(event) => updateDraft(item, { licensing: event.target.value as Draft["licensing"] })}
                  >
                    <option value="PARAPHRASE_ONLY">Paraphrase only (licensed standard)</option>
                    <option value="QUOTABLE">Quotable (public domain)</option>
                  </select>
                </label>
              </div>
              <textarea
                aria-label={`Description for ${label}`}
                className={`${INPUT_CLASS} mt-2 w-full`}
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
                {item.status === "DRAFT" && (
                  <Button variant="primary" onClick={() => handlePublish(item)}>
                    Publish
                  </Button>
                )}
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
        <p className="text-xs text-zinc-500">New Frameworks start as a Draft, visible only to Compliance Managers and Admins.</p>
        <input
          aria-label="Name"
          placeholder="Name"
          className={INPUT_CLASS}
          value={newDraft.name}
          onChange={(event) => setNewDraft((prev) => ({ ...prev, name: event.target.value }))}
          required
        />
        <input
          aria-label="Version"
          placeholder="Version (e.g. 2022)"
          className={INPUT_CLASS}
          value={newDraft.version}
          onChange={(event) => setNewDraft((prev) => ({ ...prev, version: event.target.value }))}
          required
        />
        <select
          aria-label="New Framework supersedes"
          className={INPUT_CLASS}
          value={newDraft.supersedesId}
          onChange={(event) => setNewDraft((prev) => ({ ...prev, supersedesId: event.target.value }))}
        >
          <option value="">Supersedes nothing (first version)</option>
          {items.map((other) => (
            <option key={other.id} value={other.id}>
              Supersedes {frameworkLabel(other)}
            </option>
          ))}
        </select>
        <select
          aria-label="New Framework licensing"
          className={INPUT_CLASS}
          value={newDraft.licensing}
          onChange={(event) => setNewDraft((prev) => ({ ...prev, licensing: event.target.value as Draft["licensing"] }))}
        >
          <option value="PARAPHRASE_ONLY">Paraphrase only (licensed standard)</option>
          <option value="QUOTABLE">Quotable (public domain)</option>
        </select>
        <textarea
          aria-label="New Framework description"
          placeholder="Description (optional)"
          className={INPUT_CLASS}
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

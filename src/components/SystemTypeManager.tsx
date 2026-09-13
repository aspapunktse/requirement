"use client";

import { useEffect, useState } from "react";

type SystemType = { id: string; name: string; description: string | null };

async function fetchSystemTypes(): Promise<SystemType[]> {
  const response = await fetch("/api/system-types");
  const body = await response.json();
  return body.systemTypes ?? [];
}

export function SystemTypeManager() {
  const [systemTypes, setSystemTypes] = useState<SystemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function refresh() {
    setSystemTypes(await fetchSystemTypes());
  }

  useEffect(() => {
    let cancelled = false;

    fetchSystemTypes().then((types) => {
      if (cancelled) return;
      setSystemTypes(types);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/system-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, description: newDescription || undefined }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to create System Type");
      return;
    }

    setNewName("");
    setNewDescription("");
    await refresh();
  }

  async function handleSaveDescription(id: string) {
    setError(null);
    const response = await fetch(`/api/system-types/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: drafts[id] ?? "" }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to update System Type");
      return;
    }

    await refresh();
  }

  if (loading) {
    return <p>Loading System Types…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="flex flex-col gap-3">
        {systemTypes.map((systemType) => (
          <li key={systemType.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="font-medium">{systemType.name}</div>
            <textarea
              aria-label={`Description for ${systemType.name}`}
              className="mt-2 w-full rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
              defaultValue={systemType.description ?? ""}
              onChange={(event) =>
                setDrafts((prev) => ({ ...prev, [systemType.id]: event.target.value }))
              }
            />
            <button
              type="button"
              className="mt-2 rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              onClick={() => handleSaveDescription(systemType.id)}
            >
              Save
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleCreate} className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Add a System Type</h2>
        <input
          aria-label="Name"
          placeholder="Name"
          className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          required
        />
        <textarea
          aria-label="New System Type description"
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

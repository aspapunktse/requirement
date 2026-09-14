"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SystemType = { id: string; name: string };

export function SystemTypeChanger({
  systemId,
  currentSystemTypeId,
}: {
  systemId: string;
  currentSystemTypeId: string;
}) {
  const router = useRouter();
  const [systemTypes, setSystemTypes] = useState<SystemType[]>([]);
  const [selectedId, setSelectedId] = useState(currentSystemTypeId);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/system-types")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setSystemTypes(body.systemTypes ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (selectedId === currentSystemTypeId) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemTypeId: selectedId }),
      });

      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to change System Type");
        return;
      }

      const body = await response.json();
      setMessage(
        `System Type changed: ${body.added} Requirement(s) added, ${body.removed} untouched Requirement(s) removed.`,
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

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          System Type
          <select
            aria-label="System Type"
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {systemTypes.map((systemType) => (
              <option key={systemType.id} value={systemType.id}>
                {systemType.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
          disabled={saving || selectedId === currentSystemTypeId}
        >
          Change Type
        </button>
      </div>
    </form>
  );
}

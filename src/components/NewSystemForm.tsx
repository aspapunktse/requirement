"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

type SystemType = { id: string; name: string };

export function NewSystemForm() {
  const router = useRouter();
  const [systemTypes, setSystemTypes] = useState<SystemType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [description, setDescription] = useState("");
  const [dataClassification, setDataClassification] = useState("");
  const [systemTypeId, setSystemTypeId] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/system-types")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setSystemTypes(body.systemTypes ?? []);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const response = await fetch("/api/systems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        vendor: vendor || undefined,
        description: description || undefined,
        dataClassification: dataClassification || undefined,
        systemTypeId,
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      setError(body.error ?? "Failed to create System");
      return;
    }

    const body = await response.json();
    router.push(`/systems/${body.system.id}`);
  }

  if (loading) {
    return <p>Loading System Types…</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <label className="flex flex-col gap-1 text-sm">
        Name
        <input
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        System Type
        <select
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={systemTypeId}
          onChange={(event) => setSystemTypeId(event.target.value)}
          required
        >
          <option value="">Select a System Type…</option>
          {systemTypes.map((systemType) => (
            <option key={systemType.id} value={systemType.id}>
              {systemType.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Vendor (optional)
        <input
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={vendor}
          onChange={(event) => setVendor(event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Description (optional)
        <textarea
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Data Classification (optional)
        <input
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={dataClassification}
          onChange={(event) => setDataClassification(event.target.value)}
        />
      </label>

      <Button type="submit" variant="primary">
        Create
      </Button>
    </form>
  );
}

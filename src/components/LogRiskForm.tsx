"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

const SEVERITIES: RiskSeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function LogRiskForm({
  systemId,
  onLogged,
}: {
  systemId: string;
  onLogged: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<RiskSeverity>("MEDIUM");
  const [likelihood, setLikelihood] = useState<RiskSeverity>("MEDIUM");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, severity, likelihood }),
      });

      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to log Risk");
        return;
      }

      setTitle("");
      setDescription("");
      setSeverity("MEDIUM");
      setLikelihood("MEDIUM");
      onLogged();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-col gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <label className="flex flex-col gap-1 text-sm">
        Title
        <input
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Description
        <textarea
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          required
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Severity
        <select
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={severity}
          onChange={(event) => setSeverity(event.target.value as RiskSeverity)}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Likelihood
        <select
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={likelihood}
          onChange={(event) => setLikelihood(event.target.value as RiskSeverity)}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <Button type="submit" variant="primary" disabled={saving}>
        Log Risk
      </Button>
    </form>
  );
}

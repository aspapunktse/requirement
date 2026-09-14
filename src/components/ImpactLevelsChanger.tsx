"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export const IMPACT_LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

type ImpactLevels = {
  confidentialityImpactLevel: ImpactLevel | null;
  integrityImpactLevel: ImpactLevel | null;
  availabilityImpactLevel: ImpactLevel | null;
};

const AXES: { key: keyof ImpactLevels; label: string }[] = [
  { key: "confidentialityImpactLevel", label: "Confidentiality" },
  { key: "integrityImpactLevel", label: "Integrity" },
  { key: "availabilityImpactLevel", label: "Availability" },
];

function toSelectValue(level: ImpactLevel | null) {
  return level ?? "";
}

function fromSelectValue(value: string): ImpactLevel | null {
  return value === "" ? null : (value as ImpactLevel);
}

export function ImpactLevelsChanger({
  systemId,
  current,
}: {
  systemId: string;
  current: ImpactLevels;
}) {
  const router = useRouter();
  const [levels, setLevels] = useState<ImpactLevels>(current);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unchanged = AXES.every(({ key }) => levels[key] === current[key]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (unchanged) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(levels),
      });

      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to change Impact Levels");
        return;
      }

      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend>Impact Level — set independently per axis</legend>
        {AXES.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 font-normal">
            {label}
            <select
              aria-label={label}
              className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
              value={toSelectValue(levels[key])}
              onChange={(event) =>
                setLevels((prev) => ({ ...prev, [key]: fromSelectValue(event.target.value) }))
              }
            >
              <option value="">Not classified</option>
              {IMPACT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      <Button type="submit" variant="secondary" disabled={saving || unchanged}>
        Change Impact Levels
      </Button>
    </form>
  );
}

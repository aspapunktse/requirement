"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { AppSettingDefinition, AppSettingValue } from "@/lib/app-settings";

const INPUT_CLASS =
  "w-24 rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-2 text-sm text-rg-ink";

const when = (iso: string) => new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

/** One setting: its current value, default and last change, and a Save. Saves with PATCH /api/settings. */
function SettingRow({ definition, initial }: { definition: AppSettingDefinition; initial: AppSettingValue }) {
  const [current, setCurrent] = useState(initial);
  const [draft, setDraft] = useState(String(initial.value));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const inputId = `setting-${definition.key}`;

  const parsed = /^\d+$/.test(draft.trim()) ? Number(draft.trim()) : NaN;
  const inRange = Number.isInteger(parsed) && parsed >= definition.min && parsed <= definition.max;
  const unchanged = inRange && parsed === current.value;

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: definition.key, value: parsed }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ kind: "error", text: body.error ?? "Failed to save" });
        return;
      }
      setCurrent(body.setting as AppSettingValue);
      setDraft(String((body.setting as AppSettingValue).value));
      setMessage({ kind: "ok", text: "Saved" });
    } catch {
      setMessage({ kind: "error", text: "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 border-t border-rg-line py-4 first:border-t-0 first:pt-0">
      <label htmlFor={inputId} className="font-semibold text-rg-ink">
        {definition.label}
      </label>
      <p className="text-sm text-rg-muted">{definition.help}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          inputMode="numeric"
          className={INPUT_CLASS}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setMessage(null);
          }}
          aria-invalid={!inRange}
          aria-describedby={`${inputId}-meta`}
        />
        <span className="text-sm text-rg-muted">{definition.unit}</span>
        <Button variant="primary" disabled={saving || !inRange || unchanged} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {!inRange && (
          <span role="alert" className="text-sm text-rg-danger">
            A whole number from {definition.min} to {definition.max}
          </span>
        )}
        {message && (
          <span role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-rg-danger" : "text-rg-success"}`}>
            {message.text}
          </span>
        )}
      </div>
      <p id={`${inputId}-meta`} className="text-xs text-rg-muted">
        Default {definition.default} {definition.unit}.{" "}
        {current.updatedAt
          ? `Last changed by ${current.updatedByName ?? "a removed user"} on ${when(current.updatedAt)}.`
          : "Not changed yet; the default is in use."}
      </p>
    </li>
  );
}

/** The settings page's body: a card per section, rendered from the registry passed in by the server page. */
export function AppSettingsForm({
  sections,
  definitions,
  values,
}: {
  sections: readonly string[];
  definitions: readonly AppSettingDefinition[];
  values: AppSettingValue[];
}) {
  const byKey = new Map(values.map((value) => [value.key, value]));
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => {
        const inSection = definitions.filter((definition) => definition.section === section);
        return (
          <section key={section} aria-labelledby={`section-${section}`} className="rounded-2xl border border-rg-line bg-rg-surface p-5">
            <h2 id={`section-${section}`} className="mb-4 text-lg font-semibold text-rg-ink">
              {section}
            </h2>
            <ul className="flex flex-col">
              {inSection.map((definition) => (
                <SettingRow key={definition.key} definition={definition} initial={byKey.get(definition.key)!} />
              ))}
            </ul>
            {inSection.some((definition) => definition.affectsTrends) && (
              <p className="mt-4 text-sm text-rg-muted">
                The trend lines on the Systems list count earlier days under the value that was in force then, so a line can jump on the
                day a threshold changes.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

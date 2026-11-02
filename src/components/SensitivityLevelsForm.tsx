"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { SensitivityChip } from "@/components/SensitivityChip";
import { contrastRatio, deriveDark, formatRatio, isHexColour, MIN_CONTRAST, normaliseHex } from "@/lib/sensitivity-colours";
import {
  checkSensitivityLevelEdit,
  MAX_SENSITIVITY_DESCRIPTION_LENGTH,
  MAX_SENSITIVITY_LABEL_LENGTH,
  sensitivityLevelEditSchema,
  type SensitivityLevelInfo,
} from "@/lib/sensitivity-level";

const INPUT_CLASS = "w-full rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface px-2 py-1.5 text-sm text-rg-ink";
const CAPTION_CLASS = "text-xs font-semibold uppercase tracking-wide text-rg-muted";

type Draft = { label: string; description: string; textColor: string; backgroundColor: string };
const toDraft = (level: SensitivityLevelInfo): Draft => ({
  label: level.label,
  description: level.description,
  textColor: level.textColor,
  backgroundColor: level.backgroundColor,
});

/** A colour field: the browser's picker and the hex text. The picker only takes a full `#rrggbb`, so it shows the saved colour until the hex is one. */
function ColourField({ id, name, value, fallback, onChange }: { id: string; name: string; value: string; fallback: string; onChange: (value: string) => void }) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label={`${name} picker`}
        className="h-9 w-10 flex-none cursor-pointer rounded-[var(--rg-radius-md)] border border-rg-line bg-rg-surface p-0.5"
        value={isHexColour(value.trim()) ? value.trim().toLowerCase() : fallback.toLowerCase()}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
      />
      <input
        id={id}
        aria-label={`${name} hex`}
        className={`${INPUT_CLASS} max-w-[7.5rem] font-mono uppercase`}
        value={value}
        maxLength={7}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}

/** One level: the draft being edited, its live preview and contrast, and a Save for this level alone. Saves with PATCH /api/sensitivity-levels. */
function LevelRow({
  saved,
  siblings,
  defaults,
  onSaved,
}: {
  saved: SensitivityLevelInfo;
  siblings: SensitivityLevelInfo[];
  defaults: SensitivityLevelInfo;
  onSaved: (level: SensitivityLevelInfo) => void;
}) {
  const n = saved.level;
  const [draft, setDraft] = useState<Draft>(toDraft(saved));
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [justSaved, setJustSaved] = useState(false);
  const edit = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setServerErrors([]);
    setJustSaved(false);
  };

  const parsed = sensitivityLevelEditSchema.safeParse({ level: n, ...draft });
  const problems = parsed.success
    ? checkSensitivityLevelEdit(parsed.data, [...siblings, ...(siblings.some((s) => s.level === n) ? [] : [saved])])
    : parsed.error.issues.map((issue) => issue.message);
  const unchanged =
    parsed.success &&
    parsed.data.label === saved.label &&
    parsed.data.description === saved.description &&
    parsed.data.textColor === saved.textColor.toUpperCase() &&
    parsed.data.backgroundColor === saved.backgroundColor.toUpperCase();
  const dirty =
    draft.label !== saved.label ||
    draft.description !== saved.description ||
    normaliseHex(draft.textColor) !== saved.textColor.toUpperCase() ||
    normaliseHex(draft.backgroundColor) !== saved.backgroundColor.toUpperCase();

  const colours = parsed.success
    ? { textColor: parsed.data.textColor, backgroundColor: parsed.data.backgroundColor }
    : isHexColour(normaliseHex(draft.textColor)) && isHexColour(normaliseHex(draft.backgroundColor))
      ? { textColor: normaliseHex(draft.textColor), backgroundColor: normaliseHex(draft.backgroundColor) }
      : null;
  const ratio = colours ? contrastRatio(colours.textColor, colours.backgroundColor) : null;
  const dark = colours ? deriveDark(colours.textColor, colours.backgroundColor) : null;
  const previewLabel = draft.label.trim() || "Label";
  const shownProblems = [...problems, ...serverErrors.filter((message) => !problems.includes(message))];

  async function save() {
    setSaving(true);
    setServerErrors([]);
    setJustSaved(false);
    try {
      const response = await fetch("/api/sensitivity-levels", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ level: n, ...draft }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setServerErrors(Array.isArray(body.errors) ? body.errors : [body.error ?? "Failed to save"]);
        return;
      }
      const next = body.level as SensitivityLevelInfo;
      setDraft(toDraft(next));
      onSaved(next);
      setJustSaved(true);
    } catch {
      setServerErrors(["Failed to save"]);
    } finally {
      setSaving(false);
    }
  }

  const messages = dirty ? shownProblems : serverErrors;
  const messageId = `sensitivity-${n}-messages`;
  return (
    <li
      data-level-row={n}
      className="grid gap-3 border-t border-rg-line py-4 first:border-t-0 first:pt-0 lg:grid-cols-[11rem_minmax(0,1.6fr)_9rem_9rem_minmax(0,1fr)_auto] lg:items-start"
    >
      <div className="flex flex-col gap-1.5">
        <span className={`${CAPTION_CLASS} lg:sr-only`}>Level</span>
        <div className="flex items-center gap-2">
          <span className="inline-grid h-[22px] w-[22px] place-items-center rounded-md border border-rg-line bg-rg-paper text-xs font-bold text-rg-muted">{n}</span>
          <SensitivityChip level={n} label={previewLabel} colors={colours ?? undefined} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={`${CAPTION_CLASS} lg:sr-only`}>Label and description</span>
        <input
          aria-label={`Label for level ${n}`}
          className={INPUT_CLASS}
          value={draft.label}
          maxLength={MAX_SENSITIVITY_LABEL_LENGTH + 10}
          autoComplete="off"
          onChange={(event) => edit({ label: event.target.value })}
        />
        <textarea
          aria-label={`Description for level ${n}`}
          className={`${INPUT_CLASS} min-h-[3.5rem] resize-y`}
          rows={2}
          value={draft.description}
          maxLength={MAX_SENSITIVITY_DESCRIPTION_LENGTH + 50}
          onChange={(event) => edit({ description: event.target.value })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={`${CAPTION_CLASS} lg:sr-only`}>Text colour</span>
        <ColourField id={`sensitivity-${n}-text`} name={`Text colour, level ${n}`} value={draft.textColor} fallback={saved.textColor} onChange={(value) => edit({ textColor: value })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className={`${CAPTION_CLASS} lg:sr-only`}>Background colour</span>
        <ColourField id={`sensitivity-${n}-background`} name={`Background colour, level ${n}`} value={draft.backgroundColor} fallback={saved.backgroundColor} onChange={(value) => edit({ backgroundColor: value })} />
      </div>

      <div className="flex flex-col gap-1.5 text-sm">
        <span className={`${CAPTION_CLASS} lg:sr-only`}>Contrast (WCAG AA)</span>
        {ratio === null || dark === null ? (
          <span className="text-rg-muted">Enter two hex colours</span>
        ) : (
          <>
            <span data-testid={`light-ratio-${n}`} className={ratio >= MIN_CONTRAST ? "text-rg-success" : "font-semibold text-rg-danger"}>
              <b>{formatRatio(ratio)}</b> {ratio >= MIN_CONTRAST ? "Passes AA" : `Fails AA (needs ${MIN_CONTRAST}:1)`}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <SensitivityChip level={n} label={previewLabel} size="sm" colors={{ textColor: dark.textColor, backgroundColor: dark.backgroundColor }} />
              <span data-testid={`dark-ratio-${n}`} className={dark.ratio >= MIN_CONTRAST ? "text-rg-success" : "font-semibold text-rg-danger"}>
                <b>{formatRatio(dark.ratio)}</b> {dark.ratio >= MIN_CONTRAST ? "Passes AA" : "Fails AA"}
              </span>
            </span>
            <small className="text-xs text-rg-muted">Dark is derived from the light pair.</small>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
        <Button variant="primary" disabled={saving || !parsed.success || problems.length > 0 || unchanged} onClick={save} aria-label={`Save level ${n}`}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" disabled={saving || !dirty} onClick={() => { setDraft(toDraft(saved)); setServerErrors([]); }} aria-label={`Revert level ${n}`}>
          Revert
        </Button>
        <Button
          variant="outline"
          disabled={saving}
          title="Back to the default wording and colours"
          aria-label={`Default for level ${n}`}
          onClick={() => { setDraft(toDraft(defaults)); setServerErrors([]); setJustSaved(false); }}
        >
          Default
        </Button>
        {dirty && <span className="text-xs font-semibold text-rg-muted">Unsaved</span>}
        {justSaved && !dirty && <span role="status" className="text-sm text-rg-success">Saved</span>}
      </div>

      {messages.length > 0 && (
        <div id={messageId} role="alert" className="rounded-[var(--rg-radius-md)] bg-rg-danger-soft px-3 py-1.5 text-sm text-rg-danger lg:col-span-6">
          {messages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * The Sensitivity Levels section of the Settings page (#291, design proposal A): a row per level with its label, description,
 * text and background colour, a live preview and the contrast, and a Save per row. The five levels can't be added,
 * removed or reordered. Dark mode colours are derived from the light pair. Edits are not Change Events.
 */
export function SensitivityLevelsForm({ levels, defaults }: { levels: SensitivityLevelInfo[]; defaults: readonly SensitivityLevelInfo[] }) {
  const [current, setCurrent] = useState(levels);
  return (
    <section aria-labelledby="section-sensitivity-levels" className="rounded-2xl border border-rg-line bg-rg-surface p-5">
      <h2 id="section-sensitivity-levels" className="mb-1 text-lg font-semibold text-rg-ink">
        Sensitivity Levels
      </h2>
      <p className="mb-4 text-sm text-rg-muted">
        The five levels a System&apos;s owner picks from. Change the wording and the colours; the levels themselves stay fixed. A pair needs a contrast of at least 4.5:1
        (WCAG AA), and the dark mode colours are derived from it. These changes are not recorded in Recent activity, and show on the next page load.
      </p>
      <ul className="flex flex-col">
        {current.map((level) => (
          <LevelRow
            key={level.level}
            saved={level}
            siblings={current.filter((other) => other.level !== level.level)}
            defaults={defaults.find((row) => row.level === level.level) ?? level}
            onSaved={(next) => setCurrent((rows) => rows.map((row) => (row.level === next.level ? next : row)))}
          />
        ))}
      </ul>
    </section>
  );
}

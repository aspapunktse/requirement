"use client";

import { useState } from "react";

export type Choice = { id: string; label: string; detail?: string };

const MAX_SHOWN = 100;
const INPUT_CLASSES = "rounded border border-rg-control p-2 text-sm";

/**
 * A picker for choosing some of many items (118 Controls, every System): the picked ones
 * stay visible above a search box, and the checklist below shows only the items matching
 * the search (by label or detail), so nothing needs scrolling past hundreds of rows.
 * Controlled: the parent owns `selected`.
 */
export function ChoicePicker({
  legend,
  searchLabel,
  items,
  selected,
  onChange,
}: {
  legend: string;
  searchLabel: string;
  items: Choice[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const picked = new Set(selected);
  const needle = query.trim().toLowerCase();
  const matches = items.filter((item) => needle === "" || `${item.label} ${item.detail ?? ""}`.toLowerCase().includes(needle));
  const shown = matches.slice(0, MAX_SHOWN);
  const pickedItems = items.filter((item) => picked.has(item.id));

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...selected, id] : selected.filter((existing) => existing !== id));
  }

  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend>
        {legend} <span className="text-rg-muted">({selected.length} picked)</span>
      </legend>

      {pickedItems.length > 0 && (
        <ul aria-label={`Picked: ${legend}`} className="flex flex-wrap gap-1">
          {pickedItems.map((item) => (
            <li key={item.id} className="flex items-center gap-1 rounded bg-rg-line px-2 py-0.5">
              <span>{item.label}</span>
              <button
                type="button"
                aria-label={`Remove ${item.label}`}
                className="text-rg-muted hover:text-rg-ink"
                onClick={() => toggle(item.id, false)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        type="search"
        aria-label={searchLabel}
        placeholder={searchLabel}
        className={INPUT_CLASSES}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <ul className="max-h-56 overflow-y-auto rounded border border-rg-line">
        {shown.map((item) => (
          <li key={item.id}>
            <label className="flex items-start gap-2 px-2 py-1 font-normal hover:bg-rg-line">
              <input type="checkbox" checked={picked.has(item.id)} onChange={(event) => toggle(item.id, event.target.checked)} />
              <span>
                {item.label}
                {item.detail && <span className="text-rg-muted"> {item.detail}</span>}
              </span>
            </label>
          </li>
        ))}
        {matches.length === 0 && <li className="px-2 py-1 text-rg-muted">Nothing matches.</li>}
      </ul>
      {matches.length > shown.length && (
        <p className="text-xs text-rg-muted">
          Showing the first {shown.length} of {matches.length} matches; search to narrow them down.
        </p>
      )}
    </fieldset>
  );
}

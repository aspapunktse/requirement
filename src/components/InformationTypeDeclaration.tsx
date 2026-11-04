"use client";

import { useId, useState } from "react";
import { SensitivityChip } from "@/components/SensitivityChip";
import type { InformationTypeRow } from "@/lib/information-type";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";

/** What the pieces need of a level: its number and its (editable) label. */
export type LevelLabel = Pick<SensitivityLevelInfo, "level" | "label">;
/** A type to tick: the catalogue row without its System count. */
export type TickableType = Omit<InformationTypeRow, "systemCount" | "suggestedFrameworks">;

/**
 * The pieces of declaring Information Types (#304, ADR 0012, design proposal A), shared by the System page's Profile
 * tab and the onboarding interview: the list of types to tick, and the offer shown when a ticked type is above the
 * chosen level. The floor rule is `src/lib/information-type-floor.ts`; the server is its authority.
 */

export function levelLabelOf(levels: readonly LevelLabel[], level: number): string {
  return levels.find((info) => info.level === level)?.label ?? `Level ${level}`;
}

/** The types to tick, each with its description and level, and a search box. Highest level first, as the catalogue lists them. */
export function InformationTypeChecklist({
  types,
  levels,
  selectedIds,
  onToggle,
  disabled = false,
  labelledBy,
}: {
  types: readonly TickableType[];
  levels: readonly LevelLabel[];
  selectedIds: readonly string[];
  onToggle: (type: TickableType, checked: boolean) => void;
  disabled?: boolean;
  /** The id of the heading that names this list. */
  labelledBy: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = types.filter((type) => needle === "" || `${type.name} ${type.description ?? ""}`.toLowerCase().includes(needle));
  return (
    <div className="grid gap-2">
      <input
        type="search"
        aria-label="Search Information Types"
        placeholder="Search Information Types"
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full min-w-0 rounded-[10px] border border-rg-line bg-rg-surface px-2.5 py-2 text-rg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-rg-accent"
      />
      <ul aria-labelledby={labelledBy} className="m-0 grid max-h-72 list-none gap-1.5 overflow-y-auto p-0">
        {shown.map((type) => {
          const checked = selectedIds.includes(type.id);
          return (
            <li key={type.id}>
              <label
                className={`grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-[10px] border p-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-rg-accent ${
                  checked ? "border-rg-accent bg-rg-accent-soft" : "border-rg-line bg-rg-surface hover:border-rg-accent"
                } ${disabled ? "cursor-default opacity-80" : ""}`}
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-rg-accent"
                  checked={checked}
                  disabled={disabled}
                  aria-labelledby={`${id}-${type.id}-n`}
                  aria-describedby={`${id}-${type.id}-d`}
                  onChange={(event) => onToggle(type, event.target.checked)}
                />
                <span id={`${id}-${type.id}-n`} className="font-semibold">
                  {type.name}
                </span>
                <span className="row-span-2 self-start">
                  <SensitivityChip level={type.sensitivityLevel} label={levelLabelOf(levels, type.sensitivityLevel)} size="sm" />
                </span>
                <span id={`${id}-${type.id}-d`} className="col-start-2 text-[0.84rem] text-rg-muted">
                  {type.description ?? `${levelLabelOf(levels, type.sensitivityLevel)} information`}
                </span>
              </label>
            </li>
          );
        })}
        {shown.length === 0 && <li className="p-2.5 text-[0.84rem] text-rg-muted">No Information Type matches.</li>}
      </ul>
    </div>
  );
}

/**
 * Shown when a ticked type is above the chosen level (design proposal A): says which type, and offers to raise the level
 * in the same save or to leave the type out. With no level chosen it only says what the floor is.
 */
export function FloorOffer({
  culprit,
  floor,
  chosen,
  levels,
  onRaise,
  onLeaveOut,
}: {
  culprit: { id: string; name: string; sensitivityLevel: number };
  floor: number;
  chosen: number | null;
  levels: readonly LevelLabel[];
  onRaise: () => void;
  onLeaveOut: () => void;
}) {
  const floorLabel = levelLabelOf(levels, floor);
  if (chosen === null) {
    return (
      <p role="note" className="m-0 rounded-[10px] border border-rg-line bg-rg-accent-soft p-2.5 text-[0.9rem]">
        Choose {floorLabel} or higher. {culprit.name} sets the floor.
      </p>
    );
  }
  return (
    <div role="alert" className="grid gap-2 rounded-[10px] border border-rg-gold bg-rg-gold-soft p-2.5 text-[0.9rem] text-rg-gold-ink">
      <b>
        {culprit.name} is {floorLabel}, above this System&apos;s level ({levelLabelOf(levels, chosen)}).
      </b>
      <span>A System can&apos;t be set below its Information Types. Raise the level in the same save, or leave {culprit.name} out.</span>
      <span className="flex flex-wrap gap-2">
        <button type="button" className="hc-btn primary" onClick={onRaise}>
          Raise to {floorLabel}
        </button>
        <button type="button" className="hc-btn" onClick={onLeaveOut}>
          Don&apos;t add {culprit.name}
        </button>
      </span>
    </div>
  );
}

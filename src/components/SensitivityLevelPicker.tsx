"use client";

import { useId, type ReactNode } from "react";
import { SensitivityChip } from "@/components/SensitivityChip";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";

/**
 * Picks one Sensitivity Level (#292, design proposal A): a radio group, one row per level showing its chip and
 * description, plus a row for "none" (Not set for a System, No minimum for a Control). The chip's text is the
 * option's accessible name and the description is its description. The arrow keys move between the rows, as for any
 * native radio group.
 */
export function SensitivityLevelPicker({
  levels,
  value,
  onChange,
  name,
  labelledBy,
  disabled = false,
  noneLabel,
  noneDescription,
  blockedReason,
}: {
  levels: readonly SensitivityLevelInfo[];
  /** The chosen level (1 to 5), or null for none. */
  value: number | null;
  onChange: (level: number | null) => void;
  /** Groups the radios; unique per picker on the page. */
  name: string;
  labelledBy: string;
  disabled?: boolean;
  /** The row that clears the choice: the "Not set" chip for a System, plain text such as "No minimum" for a Control. */
  noneLabel: ReactNode;
  noneDescription: string;
  /**
   * Why a level can't be chosen, or null when it can: the Information Types' floor (ADR 0012). A blocked level is
   * disabled and shows the reason in place of its description. `none` is the row that clears the choice.
   */
  blockedReason?: (level: number | "none") => string | null;
}) {
  const id = useId();
  const noneBlocked = blockedReason?.("none") ?? null;
  const rowClass = (checked: boolean) =>
    `grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 rounded-[10px] border p-2.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-rg-accent ${
      checked ? "border-rg-accent bg-rg-accent-soft" : "border-rg-line bg-rg-surface hover:border-rg-accent"
    } ${disabled ? "cursor-default opacity-80" : ""}`;
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2">
      {levels.map((level) => {
        const blocked = blockedReason?.(level.level) ?? null;
        return (
          <label key={level.level} className={`${rowClass(value === level.level)} ${blocked ? "cursor-not-allowed opacity-60" : ""}`}>
            <input
              type="radio"
              name={name}
              className="mt-1 h-4 w-4 accent-rg-accent"
              checked={value === level.level}
              disabled={disabled || blocked !== null}
              aria-labelledby={`${id}-${level.level}-t`}
              aria-describedby={`${id}-${level.level}-d`}
              onChange={() => onChange(level.level)}
            />
            <span id={`${id}-${level.level}-t`} className="flex flex-wrap items-center gap-2">
              <SensitivityChip level={level.level} label={level.label} />
            </span>
            <span id={`${id}-${level.level}-d`} className="col-start-2 text-[0.84rem] text-rg-muted">
              {blocked ?? level.description}
            </span>
          </label>
        );
      })}
      <label className={`${rowClass(value === null)} ${noneBlocked ? "cursor-not-allowed opacity-60" : ""}`}>
        <input
          type="radio"
          name={name}
          className="mt-1 h-4 w-4 accent-rg-accent"
          checked={value === null}
          disabled={disabled || noneBlocked !== null}
          aria-labelledby={`${id}-none-t`}
          aria-describedby={`${id}-none-d`}
          onChange={() => onChange(null)}
        />
        <span id={`${id}-none-t`} className="flex flex-wrap items-center gap-2">
          {noneLabel}
        </span>
        <span id={`${id}-none-d`} className="col-start-2 text-[0.84rem] text-rg-muted">
          {noneBlocked ?? noneDescription}
        </span>
      </label>
    </div>
  );
}

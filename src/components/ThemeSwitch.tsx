"use client";

import { useSyncExternalStore } from "react";
import { THEME_CHOICES, getThemeServerSnapshot, getThemeSnapshot, saveTheme, subscribeTheme } from "@/lib/theme";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rg-accent";

/**
 * The colour theme switch (#282): System (follows the OS), Light or Dark, as a group of toggle buttons. The server
 * renders System pressed; the stored choice is read after hydration (`useSyncExternalStore`), while the inline
 * script in the root layout has already set `data-theme` before first paint.
 */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const choice = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);
  return (
    <div role="group" aria-label="Theme" className={`rounded-[10px] border border-rg-line bg-rg-surface p-0.5 ${className}`}>
      {THEME_CHOICES.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          onClick={() => saveTheme(value)}
          className={`rounded-[8px] px-2 py-1 text-[12.5px] font-semibold text-rg-muted hover:text-rg-ink aria-pressed:bg-rg-accent-soft aria-pressed:font-bold aria-pressed:text-rg-accent ${FOCUS}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

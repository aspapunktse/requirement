"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";
import { ModeSwitch } from "@/components/ModeSwitch";
import { useExclusivePopover } from "@/components/useExclusivePopover";
import { getEffectiveDarkServerSnapshot, getEffectiveDarkSnapshot, subscribeEffectiveDark } from "@/lib/mode";
import {
  PALETTES,
  getPalette,
  getPaletteServerSnapshot,
  getPaletteSnapshot,
  previewPalette,
  savePalette,
  subscribePalette,
  type Palette,
  type PaletteId,
} from "@/lib/palette";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rg-accent";

/** The saved theme (the server renders Register; the stored one is read after hydration). */
export function useSavedPalette(): PaletteId {
  return useSyncExternalStore(subscribePalette, getPaletteSnapshot, getPaletteServerSnapshot);
}

function useEffectiveDark(): boolean {
  return useSyncExternalStore(subscribeEffectiveDark, getEffectiveDarkSnapshot, getEffectiveDarkServerSnapshot);
}

/** A theme's paper, surface, accent and ink in the mode the page is in. */
function Swatch({ palette, small = false }: { palette: Palette; small?: boolean }) {
  const dark = useEffectiveDark();
  const colours = dark ? palette.swatch.dark : palette.swatch.light;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 overflow-hidden border border-rg-line ${small ? "rounded-[5px]" : "row-span-2 rounded-[8px]"}`}
    >
      {colours.map((colour, index) => (
        <i key={index} className={small ? "h-3.5 w-2" : "h-10 w-3.5"} style={{ background: colour }} />
      ))}
    </span>
  );
}

function ThemePanel({ onClose, className, anchorRef }: { onClose: () => void; className: string; anchorRef: RefObject<HTMLElement | null> }) {
  const saved = useSavedPalette();
  const [hovered, setHovered] = useState<PaletteId | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  // From 640px up the panel is placed under the button, right-aligned to it but kept 16px inside the viewport;
  // below that it spans the screen (the classes) and the button is hidden.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const anchor = anchorRef.current;
    if (!panel || !anchor) return;
    function place() {
      if (!panel || !anchor) return;
      const wide = window.innerWidth >= 640 && getComputedStyle(anchor).display !== "none";
      if (!wide) {
        panel.style.left = panel.style.top = "";
        return;
      }
      const box = anchor.getBoundingClientRect();
      const width = panel.offsetWidth;
      panel.style.left = `${Math.max(16, Math.min(box.right - width, window.innerWidth - width - 16))}px`;
      panel.style.top = `${box.bottom + 8}px`;
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchorRef]);

  // Hover or focus previews a theme on the whole page without saving it; closing the panel (which unmounts
  // this) puts the saved one back.
  useEffect(() => {
    previewPalette(hovered ?? focused);
    return () => previewPalette(null);
  }, [hovered, focused]);

  // Open on the chosen theme, as a radio group does.
  useEffect(() => {
    cardRefs.current[PALETTES.findIndex((palette) => palette.id === saved)]?.focus();
    // Only when the panel opens: choosing a theme must not pull focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onCardKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = PALETTES.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    if (next === null) return;
    event.preventDefault();
    cardRefs.current[next]?.focus();
  }

  function choose(palette: Palette) {
    savePalette(palette.id);
    setAnnouncement(`${palette.name} theme applied`);
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={headingId}
      className={className}
      onFocus={(event) => setFocused((event.target as HTMLElement).closest<HTMLElement>("[data-palette-id]")?.dataset.paletteId ?? null)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <h2 id={headingId} className="px-2 pt-1.5 pb-1.5 text-[11px] leading-4 font-bold tracking-wider text-rg-muted uppercase">
        Theme
      </h2>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid max-h-[min(60vh,460px)] gap-1.5 overflow-auto p-0.5"
        onMouseLeave={() => setHovered(null)}
      >
        {PALETTES.map((palette, index) => {
          const checked = palette.id === saved;
          return (
            <button
              key={palette.id}
              ref={(el) => {
                cardRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              data-palette-id={palette.id}
              onClick={() => choose(palette)}
              onMouseEnter={() => setHovered(palette.id)}
              onKeyDown={(event) => onCardKeyDown(event, index)}
              className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-[12px] border border-rg-line bg-rg-paper px-3 py-2.5 text-left hover:border-rg-accent aria-checked:border-rg-accent aria-checked:bg-rg-accent-soft aria-checked:shadow-[0_0_0_1px_var(--rg-accent)] ${FOCUS}`}
            >
              <Swatch palette={palette} />
              <b className="text-[14.5px] text-rg-ink">{palette.name}</b>
              <span aria-hidden className={`font-extrabold text-rg-accent ${checked ? "" : "opacity-0"}`}>
                ✓
              </span>
              <small className="col-span-2 text-[12.5px] leading-snug text-rg-muted">{palette.character}</small>
              <span className="col-span-3 mt-0.5 grid gap-0.5 border-t border-dashed border-rg-line pt-1 text-rg-ink" style={{ fontFamily: palette.sample }}>
                <span className="text-base font-semibold">Aa Bb 0123</span>
                <span className="text-[12.5px] text-rg-muted">
                  {palette.sans} · {palette.mono}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2.5 border-t border-rg-line px-2 pt-2.5 pb-1">
        <span aria-hidden className="text-[11px] font-bold tracking-wider text-rg-muted uppercase">
          Mode
        </span>
        <ModeSwitch />
      </div>
      <p className="px-2 pt-1.5 pb-0.5 text-xs text-rg-muted">Colours and fonts only; layout never changes.</p>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  );
}

/**
 * The Theme menu of the app header (#286): a button beside Mode that opens a popover of theme cards (swatch in the
 * current mode, name, one line about its character, a sample of its font). Hovering or focusing a card previews the
 * theme on the whole page, clicking keeps it, Escape (or closing without choosing) puts the saved one back, the
 * arrow keys move between cards, and the Mode switch sits at the bottom. The header owns `open` so the narrow
 * screen's Go to menu can open it too; below 640px the button is hidden and the panel spans the screen.
 */
export function ThemeMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const saved = getPalette(useSavedPalette());
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useExclusivePopover("theme-menu", open, () => onOpenChange(false));

  function close(restoreFocus: boolean) {
    onOpenChange(false);
    if (!restoreFocus) return;
    // The bar button is hidden on narrow screens, where the panel was opened from the Go to menu.
    const button = buttonRef.current;
    const target = button && getComputedStyle(button).display !== "none" ? button : document.querySelector<HTMLElement>('[data-menu-id="go-to-menu"]');
    target?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onBlur={(event) => {
        if (open && event.relatedTarget instanceof Node && !rootRef.current?.contains(event.relatedTarget)) onOpenChange(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Theme"
        title={`Theme: ${saved.name}`}
        onClick={() => onOpenChange(!open)}
        className={`hidden items-center gap-2 rounded-[10px] border border-rg-control bg-rg-surface px-2 py-1.5 text-[13.5px] font-semibold text-rg-ink hover:border-rg-accent sm:inline-flex min-[1241px]:gap-1.5 ${FOCUS}`}
      >
        <Swatch palette={saved} small />
        {/* Where the full navigation is shown the button is just the swatch and a caret, to leave the header on one row. */}
        <span className="min-[1241px]:hidden">Theme</span>
        <span aria-hidden className="text-[10px] text-rg-muted">
          ▾
        </span>
      </button>
      {open && (
        <div id={panelId}>
          <ThemePanel
            onClose={() => close(true)}
            anchorRef={buttonRef}
            className="fixed inset-x-4 top-[60px] z-40 max-h-[calc(100vh-76px)] overflow-auto rounded-[16px] border border-rg-line bg-rg-surface p-2 text-rg-ink shadow-[var(--rg-shadow-popover)] sm:inset-x-auto sm:w-[380px] sm:max-h-[calc(100vh-80px)]"
          />
        </div>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { Icon, kindOf } from "./HomeGraphics";
import type { HomeIconKey, HomeTask, HomeTile } from "./home-types";

/**
 * The Ctrl+K "jump to" palette, shared by the Home page and the Systems list (#232): the page builds its
 * items, the palette filters, lists and opens them. Its styles (`hc-pal*`) are in `home.css`.
 */
export type PaletteItem = { group: string; icon: HomeIconKey; label: string; meta: string; href: string };

/** The items narrowed by the typed text (a case-insensitive substring of label and meta). */
export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase();
  return q ? items.filter((item) => `${item.label} ${item.meta}`.toLowerCase().includes(q)) : items;
}

/** The Home page's items: its tasks, then its shortcuts, narrowed by the typed text. */
export function paletteItems(tasks: HomeTask[], tiles: HomeTile[], query: string): PaletteItem[] {
  return filterPaletteItems(
    [
      ...tasks.map((task): PaletteItem => ({ group: "Tasks", icon: kindOf(task.kind).icon, label: task.title, meta: task.status, href: task.href })),
      ...tiles.map((tile): PaletteItem => ({ group: "Pages", icon: tile.icon, label: tile.title, meta: tile.foot ?? "", href: tile.href })),
    ],
    query,
  );
}

/**
 * The keyboard shortcuts of a Register page: Ctrl/Cmd+K toggles the palette (when `paletteEnabled`) and "/"
 * focuses the search field unless the user is typing somewhere. Both are ignored while the palette is open,
 * except Ctrl+K, which closes it.
 */
export function useRegisterHotkeys({
  paletteEnabled,
  paletteOpen,
  openPalette,
  closePalette,
  searchRef,
}: {
  paletteEnabled: boolean;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (paletteEnabled && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
        return;
      }
      if (paletteOpen) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });
}

/** Opens and closes the palette, giving focus back to what had it before. */
export function usePaletteToggle() {
  const [open, setOpen] = useState(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  return {
    open,
    openPalette() {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    },
    closePalette() {
      setOpen(false);
      returnFocusRef.current?.focus();
    },
  };
}

/**
 * A modal dialog with a search field and a listbox over `items`. Arrow keys move, Enter opens, Escape
 * closes; Tab stays in the field. Mounted only while open, so it starts fresh each time. Role switching
 * stays in the app header.
 */
export function JumpPalette({
  items: allItems,
  onClose,
  placeholder = "Jump to a task or a page…",
}: {
  items: PaletteItem[];
  onClose: () => void;
  placeholder?: string;
}) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const items = filterPaletteItems(allItems, query);
  const active = Math.min(selected, Math.max(0, items.length - 1));

  function open(item: PaletteItem | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(Math.min(active + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(Math.max(active - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(items[active]);
    } else if (event.key === "Tab") {
      event.preventDefault();
    }
  }

  return (
    <>
      <div className="hc-pal-scrim" onClick={onClose} aria-hidden="true" />
      <div className="hc-pal" role="dialog" aria-modal="true" aria-label="Jump to" onKeyDown={onKeyDown}>
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items.length > 0 ? `${listId}-${active}` : undefined}
          aria-label={placeholder.replace(/…$/, "")}
          placeholder={placeholder}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
        />
        <ul id={listId} role="listbox" aria-label="Results">
          {items.map((item, index) => (
            <Fragment key={`${item.group}-${index}`}>
              {item.group !== items[index - 1]?.group && (
                <li role="presentation" className="grp">
                  {item.group}
                </li>
              )}
              <li
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                ref={(el) => {
                  if (el && index === active) el.scrollIntoView?.({ block: "nearest" });
                }}
                onClick={() => open(item)}
                onMouseMove={() => setSelected(index)}
              >
                <Icon name={item.icon} size={16} />
                <span>{item.label}</span>
                <small>{item.meta}</small>
              </li>
            </Fragment>
          ))}
          {items.length === 0 && (
            <li role="presentation" className="none">
              Nothing matches
            </li>
          )}
        </ul>
      </div>
    </>
  );
}

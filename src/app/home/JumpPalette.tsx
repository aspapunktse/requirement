"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import "@/components/jump-palette.css";
import { Icon, kindOf } from "./HomeGraphics";
import type { HomeIconKey, HomeTask, HomeTile } from "./home-types";

/**
 * The Ctrl+K "jump to" palette (#226, #232): a page registers its items with `usePagePalette`
 * (`PaletteProvider`), and the app header opens the one palette with them, then the "Go to" pages (#256).
 * Its styles (`hc-pal*`) are in `jump-palette.css`, loaded with this module on every page.
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
 * The "/" shortcut of a Register page: it focuses the page's search field unless the user is typing somewhere
 * (the palette's own field counts). Ctrl/Cmd+K belongs to the app header, which owns the one palette (#256).
 */
export function useSearchHotkey(searchRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      if (event.key === "/" && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [searchRef]);
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
  onSelect,
  placeholder = "Jump to a task or a page…",
}: {
  items: PaletteItem[];
  onClose: () => void;
  /** Opens an item in place of navigating to its `href` (the System page switches tab with it). */
  onSelect?: (item: PaletteItem) => void;
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
    if (onSelect) onSelect(item);
    else router.push(item.href);
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

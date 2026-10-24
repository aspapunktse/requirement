"use client";

import { useRouter } from "next/navigation";
import { Fragment, useId, useState, type KeyboardEvent } from "react";
import { Icon, kindOf } from "./HomeGraphics";
import type { HomeIconKey, HomeTask, HomeTile } from "./home-types";

type Item = { group: "Tasks" | "Pages"; icon: HomeIconKey; label: string; meta: string; href: string };

/** The items the palette offers, narrowed by the typed text (a case-insensitive substring of label and meta). */
export function paletteItems(tasks: HomeTask[], tiles: HomeTile[], query: string): Item[] {
  const q = query.trim().toLowerCase();
  const all: Item[] = [
    ...tasks.map((task): Item => ({ group: "Tasks", icon: kindOf(task.kind).icon, label: task.title, meta: task.status, href: task.href })),
    ...tiles.map((tile): Item => ({ group: "Pages", icon: tile.icon, label: tile.title, meta: tile.foot ?? "", href: tile.href })),
  ];
  return q ? all.filter((item) => `${item.label} ${item.meta}`.toLowerCase().includes(q)) : all;
}

/**
 * The Ctrl+K "jump to" palette: a modal dialog with a search field and a listbox over the role's tasks
 * and shortcuts. Arrow keys move, Enter opens, Escape closes; Tab stays in the field. Mounted only while
 * open, so it starts fresh each time. Role switching stays in the app header.
 */
export function JumpPalette({ tasks, tiles, onClose }: { tasks: HomeTask[]; tiles: HomeTile[]; onClose: () => void }) {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const items = paletteItems(tasks, tiles, query);
  const active = Math.min(selected, Math.max(0, items.length - 1));

  function open(item: Item | undefined) {
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
          aria-label="Jump to a task or a page"
          placeholder="Jump to a task or a page…"
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

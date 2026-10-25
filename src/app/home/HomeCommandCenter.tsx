"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { HOME_LANES, type HomeLane, type HomeStat, type HomeTask, type HomeView } from "./home-types";
import { SHOW_ACTIVITY, SHOW_JUMP_PALETTE, SHOW_STAT_TRENDS } from "./home-config";
import { Icon, kindOf, Ring, Spark } from "./HomeGraphics";
import { ago, initialsOf } from "./home-format";
import { HomePictureView } from "./HomePictures";
import { JumpPalette, paletteItems, usePaletteToggle, useRegisterHotkeys } from "./JumpPalette";
import "./home.css";

const LANE_COLOR: Record<HomeLane, string> = { you: "var(--rg-accent)", waiting: "var(--rg-muted)", soon: "var(--rg-gold)" };
const TONE_RANK: Record<string, number> = { danger: 0, warn: 1, accent: 2, success: 3, neutral: 4 };
const ACTIVITY_COLOR = { ok: "var(--rg-success)", warn: "var(--rg-gold)", danger: "var(--rg-danger)", accent: "var(--rg-accent)" };
const STAT_COLOR: Record<string, string> = { warn: "var(--rg-gold)", danger: "var(--rg-danger)", ok: "var(--rg-success)" };

export { ago };

export type TaskSort = "lane" | "new" | "old";

export const greetingFor = (hour: number) => (hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");

const noopSubscribe = () => () => {};

/** The tasks that match the filters, in the chosen order. Exported for the tests. */
export function visibleTasks(tasks: HomeTask[], filters: { kind: string; q: string; sort: TaskSort }): HomeTask[] {
  const q = filters.q.trim().toLowerCase();
  let list = tasks.filter((task) => !filters.kind || task.kind === filters.kind);
  if (q) list = list.filter((task) => `${task.kind} ${task.title} ${task.subtitle ?? ""} ${task.status}`.toLowerCase().includes(q));
  // A task with no date sorts last in every order.
  const byDays = (direction: 1 | -1) => (a: HomeTask, b: HomeTask) =>
    a.days === null || b.days === null ? Number(a.days === null) - Number(b.days === null) : direction * (a.days - b.days);
  if (filters.sort === "new") return [...list].sort(byDays(1));
  if (filters.sort === "old") return [...list].sort(byDays(-1));
  return [...list].sort((a, b) => (TONE_RANK[a.tone] ?? 9) - (TONE_RANK[b.tone] ?? 9) || byDays(-1)(a, b));
}

export function HomeCommandCenter({ view }: { view: HomeView }) {
  const [kind, setKind] = useState("");
  const [statIndex, setStatIndex] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<TaskSort>("lane");
  const searchRef = useRef<HTMLInputElement>(null);

  // The server has no idea of the visitor's time zone: render "Welcome" there and the real greeting once hydrated.
  const greeting = useSyncExternalStore(noopSubscribe, () => greetingFor(new Date().getHours()), () => "Welcome");
  const firstName = view.name.split(/\s+/)[0] ?? view.name;

  const { tasks, tiles } = view;
  const count = (lane: HomeLane) => tasks.filter((task) => task.lane === lane).length;
  const you = count("you");
  const kinds = [...new Set(tasks.map((task) => task.kind))];
  const tabKinds = kind && !kinds.includes(kind) ? [...kinds, kind] : kinds;
  const list = useMemo(() => visibleTasks(tasks, { kind, q, sort }), [tasks, kind, q, sort]);
  const primaryTile = tiles.find((tile) => tile.primary) ?? tiles[0];

  const { open: paletteOpen, openPalette, closePalette } = usePaletteToggle();
  useRegisterHotkeys({ paletteEnabled: SHOW_JUMP_PALETTE, paletteOpen, openPalette, closePalette, searchRef });

  function toggleStat(index: number, stat: HomeStat) {
    const next = statIndex === index ? null : index;
    setStatIndex(next);
    setKind(next === null ? "" : (stat.filter ?? ""));
  }

  function chooseTab(next: string) {
    setKind(next);
    setStatIndex(null);
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, keys: string[]) {
    const current = keys.indexOf(kind);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? keys.length - 1 : step ? (current + step + keys.length) % keys.length : -1;
    if (target < 0) return;
    event.preventDefault();
    chooseTab(keys[target]);
    document.getElementById(`hc-tab-${keys[target] || "all"}`)?.focus();
  }

  function clearFilters() {
    setQ("");
    setKind("");
    setStatIndex(null);
  }

  const tabKeys = ["", ...tabKinds];
  const tabLabel = (key: string) => (key === "" ? "All" : key === "Query" ? "Queries" : `${key}s`);
  const tabCount = (key: string) => (key === "" ? tasks.length : tasks.filter((task) => task.kind === key).length);

  function renderTask(task: HomeTask, index: number) {
    const k = kindOf(task.kind);
    return (
      <li key={task.id} className={`hc-task ${task.lane}`} style={{ "--d": `${Math.min(index, 12) * 35}ms` } as CSSProperties}>
        <span className="hc-kind" style={{ "--hue": k.hue } as CSSProperties} aria-hidden="true">
          <Icon name={k.icon} size={17} />
        </span>
        <span className="t">
          <b>{task.title}</b>
          <small>
            <span className="hc-kind-t" style={{ "--hue": k.hue } as CSSProperties}>
              {task.kind}
            </span>
            {task.subtitle ? ` · ${task.subtitle}` : ""}
          </small>
        </span>
        <StatusChip tone={task.tone}>{task.status}</StatusChip>
        <span className="when">{ago(task.days)}</span>
        <Link href={task.href} className={`hc-btn go${task.lane === "you" ? " primary" : ""}`} aria-label={`${task.action}: ${task.title}`}>
          {task.action} <Icon name="arrow" size={14} />
        </Link>
      </li>
    );
  }

  function renderTasks() {
    if (tasks.length === 0) {
      return (
        <div className="hc-done">
          <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
            <circle cx="28" cy="28" r="24" stroke="var(--rg-success)" strokeWidth="3" />
            <path d="M18 29l7 7 13-15" stroke="var(--rg-success)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h3>Nothing needs you</h3>
          <p>Nothing is waiting on you. Anything addressed to you, such as a Check-up or a System you own, appears here.</p>
          {primaryTile && (
            <Link href={primaryTile.href} className="hc-btn primary">
              {primaryTile.title} <Icon name="arrow" size={14} />
            </Link>
          )}
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <div className="hc-done">
          <h3>No tasks match</h3>
          <button type="button" className="hc-btn" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      );
    }
    if (sort !== "lane") return <ul className="hc-tasks">{list.map(renderTask)}</ul>;
    return (
      <>
        {HOME_LANES.map((lane) => {
          const items = list.filter((task) => task.lane === lane.key);
          if (items.length === 0) return null;
          // The stagger of the entrance animation continues from the lanes above.
          const before = list.filter((task) => HOME_LANES.findIndex((l) => l.key === task.lane) < HOME_LANES.findIndex((l) => l.key === lane.key)).length;
          return (
            <section key={lane.key} aria-label={lane.label}>
              <h3 className="hc-lane-h">
                <i style={{ background: LANE_COLOR[lane.key] }} aria-hidden="true" />
                {lane.label} · {items.length}
                <small>{lane.hint}</small>
              </h3>
              <ul className="hc-tasks">{items.map((task, i) => renderTask(task, before + i))}</ul>
            </section>
          );
        })}
      </>
    );
  }

  return (
    <div className="hc" data-page-id={`HOME . ${view.roleLabel.toUpperCase()}`}>
      <section className="hc-hero" aria-label="Today">
        <div>
          <div className="hc-who">
            <span className="hc-av" aria-hidden="true">
              {initialsOf(view.name)}
            </span>
            <span className="hc-eyebrow">Home · {view.roleLabel}</span>
          </div>
          <h1>
            {greeting}, {firstName}.
          </h1>
          <p className="hc-lede">{view.lede}</p>
          <div className="hc-chips">
            {view.scope && <StatusChip tone="accent">Scope: {view.scope}</StatusChip>}
            {you > 0 ? <StatusChip tone="warn">{`${you} ${you === 1 ? "needs" : "need"} you`}</StatusChip> : <StatusChip tone="success">You&rsquo;re all caught up</StatusChip>}
          </div>
        </div>
        {tasks.length > 0 && (
          <div className="hc-move">
            <Ring
              segments={[
                [count("you") / tasks.length, "var(--rg-accent)"],
                [count("waiting") / tasks.length, "var(--rg-muted)"],
                [count("soon") / tasks.length, "var(--rg-gold)"],
              ]}
              size={92}
              stroke={10}
              center={String(you)}
              sub="your move"
              label={`${you} of ${tasks.length} tasks are your move`}
            />
            <ul aria-label="Tasks by lane">
              {HOME_LANES.map((lane) => (
                <li key={lane.key}>
                  <i style={{ background: LANE_COLOR[lane.key] }} aria-hidden="true" />
                  <b>{count(lane.key)}</b>
                  {lane.label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="hc-stats" aria-label="Headline numbers">
        {view.stats.map((stat, index) => {
          const Tag = stat.filter ? "button" : "div";
          const trend = SHOW_STAT_TRENDS && stat.trend ? <Spark values={stat.trend} color={STAT_COLOR[stat.tone ?? ""] ?? "var(--rg-accent)"} /> : null;
          return (
            <Tag
              key={stat.label}
              className={`hc-card hc-stat ${stat.tone ?? ""}`}
              {...(stat.filter ? { type: "button" as const, "aria-pressed": statIndex === index, onClick: () => toggleStat(index, stat) } : {})}
            >
              <span className="k">
                {stat.label}
                {stat.filter && <em aria-hidden="true">Filter →</em>}
              </span>
              <span className="v">{stat.value}</span>
              {trend}
            </Tag>
          );
        })}
      </section>

      <div className="hc-main">
        <section className="hc-card" aria-labelledby="hc-tasks-h">
          <div className="hc-card-h">
            <h2 id="hc-tasks-h">My tasks</h2>
            {SHOW_JUMP_PALETTE && (
              <p>
                <button type="button" className="hc-kbd" onClick={openPalette} aria-keyshortcuts="Control+K">
                  Ctrl K
                </button>{" "}
                to jump anywhere
              </p>
            )}
          </div>
          <div className="hc-tabs" role="tablist" aria-label="Task kinds">
            {tabKeys.map((key) => (
              <button
                key={key || "all"}
                id={`hc-tab-${key || "all"}`}
                type="button"
                role="tab"
                aria-selected={kind === key}
                aria-controls="hc-task-panel"
                tabIndex={kind === key ? 0 : -1}
                onClick={() => chooseTab(key)}
                onKeyDown={(event) => onTabKeyDown(event, tabKeys)}
              >
                {tabLabel(key)}
                <span className="n">{tabCount(key)}</span>
              </button>
            ))}
          </div>
          <div className="hc-tbar">
            <label className="hc-search">
              <Icon name="search" size={15} />
              <input
                ref={searchRef}
                type="search"
                placeholder="Filter tasks"
                aria-label="Filter tasks"
                autoComplete="off"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
              <kbd className="hc-kbd" aria-hidden="true">
                /
              </kbd>
            </label>
            <select className="hc-sel" aria-label="Order" value={sort} onChange={(event) => setSort(event.target.value as TaskSort)}>
              <option value="lane">By urgency</option>
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
            </select>
          </div>
          <div id="hc-task-panel" role="tabpanel" aria-labelledby={`hc-tab-${kind || "all"}`}>
            {renderTasks()}
          </div>
          <p className="sr-only" role="status">
            {tasks.length === 0 ? "No tasks" : `${list.length} of ${tasks.length} tasks shown`}
          </p>
        </section>

        <aside className="hc-side" aria-label="Overview">
          <section className="hc-card" aria-labelledby="hc-pic-h">
            <div className="hc-card-h">
              <h2 id="hc-pic-h">{view.picture.title}</h2>
              <p>{view.picture.note}</p>
            </div>
            <div className="hc-card-b hc-pic">
              <HomePictureView picture={view.picture} />
            </div>
          </section>

          <section className="hc-card" aria-labelledby="hc-tiles-h">
            <div className="hc-card-h">
              <h2 id="hc-tiles-h">Where to start</h2>
              <p>{tiles.length} shortcuts</p>
            </div>
            <div className="hc-tiles">
              {tiles.map((tile) => (
                <Link key={tile.href} href={tile.href} className={`hc-tile${tile.primary ? " primary" : ""}`}>
                  <span className="ib">
                    <Icon name={tile.icon} />
                  </span>
                  <span>
                    <b>{tile.title}</b>
                    <small>{tile.description}</small>
                  </span>
                  <span className="foot">{tile.foot ?? ""}</span>
                </Link>
              ))}
            </div>
          </section>

          {SHOW_ACTIVITY && (
            <section className="hc-card" aria-labelledby="hc-feed-h">
              <div className="hc-card-h">
                <h2 id="hc-feed-h">Recent activity</h2>
                <p>last 2 weeks</p>
              </div>
              {view.activity.length === 0 ? (
                <p className="hc-card-b hc-empty">Nothing changed in the last two weeks.</p>
              ) : (
                <ul className="hc-feed">
                  {view.activity.map((item) => (
                    <li key={item.id} style={{ "--c": ACTIVITY_COLOR[item.tone] } as CSSProperties}>
                      <i aria-hidden="true" />
                      <span>
                        <b>{item.who}</b> {item.what}
                        {item.target && (
                          <>
                            {" · "}
                            {item.href ? <Link href={item.href}>{item.target}</Link> : item.target}
                          </>
                        )}
                      </span>
                      <span>{ago(item.days)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>

      {SHOW_JUMP_PALETTE && paletteOpen && <JumpPalette items={paletteItems(tasks, tiles, "")} onClose={closePalette} />}
    </div>
  );
}

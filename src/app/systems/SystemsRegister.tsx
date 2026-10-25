"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { onboardingStatusTone } from "@/lib/status-tones";
import { ago, initialsOf } from "@/app/home/home-format";
import { Icon, Ring, Spark } from "@/app/home/HomeGraphics";
import { JumpPalette, usePaletteToggle, useRegisterHotkeys, type PaletteItem } from "@/app/home/JumpPalette";
import "@/app/home/home.css";
import "./systems.css";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { canChangeOwner } from "@/lib/system-permissions";
import { BULK_ACTIONS, canChangeAnyOwner } from "./bulk-actions";
import { PAGE_SIZES, SHOW_COMPACT_TOGGLE, SHOW_JUMP_PALETTE, SHOW_STAT_TRENDS } from "./systems-config";
import { downloadCsv } from "./systems-download";
import {
  filterOptions,
  filterValues,
  fulfilment,
  groupRows,
  hasActiveFilters,
  matchRows,
  pageOf,
  sortRows,
  systemsCsv,
  systemsCsvFilename,
  viewCounts,
  type FilterKey,
} from "./systems-logic";
import { parseRegisterState, serializeRegisterState } from "./systems-state";
import {
  IMPACT_LABEL,
  STATUS_LABEL,
  STATUS_ORDER,
  VIEW_KEYS,
  type GroupKey,
  type RegisterState,
  type SortKey,
  type SystemRow,
  type SystemsView,
  type ViewKey,
} from "./systems-types";

const DAY_MS = 86_400_000;
const STATUS_COLOR: Record<string, string> = {
  DRAFT: "var(--rg-muted)",
  IN_REVIEW: "var(--rg-gold)",
  APPROVED: "var(--rg-success)",
  ONBOARDED: "var(--rg-accent)",
  REJECTED: "var(--rg-danger)",
};
const STAT_COLOR: Record<string, string> = { warn: "var(--rg-gold)", danger: "var(--rg-danger)" };
const LEVEL_RANK = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 } as const;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "owners", label: "Owner" },
  { key: "units", label: "Business Unit" },
  { key: "facets", label: "Deployment Facet" },
  { key: "impact", label: "Highest Impact Level" },
];

const COLUMNS: { key: SortKey | "go" | "facets"; label: string; sortable: boolean; className: string }[] = [
  { key: "name", label: "System", sortable: true, className: "c-name" },
  { key: "status", label: "Status", sortable: true, className: "c-status" },
  { key: "owner", label: "Owner", sortable: true, className: "c-owner" },
  { key: "facets", label: "Deployment", sortable: false, className: "c-facets" },
  { key: "cia", label: "C · I · A", sortable: true, className: "c-cia" },
  { key: "unit", label: "Business Unit", sortable: true, className: "c-unit" },
  { key: "prog", label: "Requirements met", sortable: true, className: "c-prog" },
  { key: "upd", label: "Updated", sortable: true, className: "c-upd" },
];
const COLUMN_COUNT = COLUMNS.length + 2;

/** The page numbers to offer: all of them for a few pages, otherwise the first, the last and the neighbours of the current one. */
export function pageNumbers(page: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const wanted = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1]);
  const out: (number | "gap")[] = [];
  for (let n = 1; n <= pages; n++) {
    if (wanted.has(n)) out.push(n);
    else if (out[out.length - 1] !== "gap") out.push("gap");
  }
  return out;
}

const levelText = (level: keyof typeof LEVEL_RANK | null) => (level === null ? "not classified" : IMPACT_LABEL[level].toLowerCase());

export function SystemsRegister({ view, initialQuery }: { view: SystemsView; initialQuery: string }) {
  const router = useRouter();
  const { rows, userId } = view;
  const actor = { id: userId, role: view.role };
  const [state, setState] = useState<RegisterState>(() => parseRegisterState(new URLSearchParams(initialQuery), { id: userId, role: view.role }));
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [compact, setCompact] = useState(false);
  const [changingOwner, setChangingOwner] = useState(false);
  const [openFilter, setOpenFilter] = useState<FilterKey | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const regRef = useRef<HTMLElement>(null);
  const { open: paletteOpen, openPalette, closePalette } = usePaletteToggle();
  useRegisterHotkeys({ paletteEnabled: SHOW_JUMP_PALETTE, paletteOpen, openPalette, closePalette, searchRef });

  const now = Date.parse(view.now);

  // The state lives in the URL: a change pushes a history entry (typing in the search replaces it), and
  // Back or Forward reads the state from the address again.
  useEffect(() => {
    const onPopState = () => setState(parseRegisterState(new URLSearchParams(window.location.search), { id: userId, role: view.role }));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [userId, view.role]);

  useEffect(() => {
    if (openFilter === null) return;
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-filter]")) setOpenFilter(null);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpenFilter(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openFilter]);

  function update(patch: Partial<RegisterState>, options: { replace?: boolean; keepPage?: boolean } = {}) {
    const next: RegisterState = { ...state, ...patch, ...(options.keepPage || "page" in patch ? {} : { page: 1 }) };
    setState(next);
    const query = serializeRegisterState(next);
    const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
    if (options.replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  }

  const counts = useMemo(() => viewCounts(rows), [rows]);
  const base = useMemo(() => matchRows(rows, state), [rows, state]);
  const listed = useMemo(() => base.filter((row) => !state.status || row.status === state.status), [base, state.status]);
  const sorted = useMemo(() => sortRows(listed, state.sort, state.dir), [listed, state.sort, state.dir]);
  const paged = pageOf(sorted, state.page, state.per);
  const statusCount = (status: string) => rows.filter((row) => row.status === status).length;
  const onboardedPct = rows.length === 0 ? 0 : Math.round((100 * statusCount("ONBOARDED")) / rows.length);

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const pageIds = paged.items.map((row) => row.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = !allOnPage && pageIds.some((id) => selected.has(id));

  const paletteItems: PaletteItem[] = useMemo(
    () => [
      ...(view.canCreate ? [{ group: "Actions", icon: "plus" as const, label: "New System", meta: "start onboarding", href: "/systems/new" }] : []),
      ...[...rows]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((row) => ({ group: "Systems", icon: "system" as const, label: row.name, meta: `${STATUS_LABEL[row.status]} · ${row.ownerName}`, href: `/systems/${row.id}` })),
    ],
    [rows, view.canCreate],
  );

  const own = view.roleView;
  const statTone: Record<ViewKey, "warn" | "danger" | undefined> = {
    all: undefined,
    mine: own.warn ? "warn" : undefined,
    attention: "danger",
    unclassified: "warn",
    providers: undefined,
  };
  const statLabel: Record<ViewKey, string> = { all: "All Systems", mine: own.label, attention: "Needs attention", unclassified: "Not classified", providers: "Providers" };

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function toggleAllOnPage() {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (allOnPage) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }
  function toggleFilterValue(key: FilterKey, value: string) {
    const current = state[key] as string[];
    update({ [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] } as Partial<RegisterState>);
  }
  function clearFilters() {
    update({ view: "all", status: "", q: "", owners: [], units: [], facets: [], impact: [] });
    setOpenFilter(null);
  }
  function sortBy(key: SortKey) {
    update(state.sort === key ? { dir: state.dir === 1 ? -1 : 1 } : { sort: key, dir: 1 });
  }
  function goToPage(page: number) {
    update({ page });
    regRef.current?.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function exportRegister() {
    downloadCsv(systemsCsv(sorted), systemsCsvFilename("register", new Date()));
  }

  const statusTabs: (typeof state.status)[] = ["", ...STATUS_ORDER];
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const current = statusTabs.indexOf(state.status);
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    const target = event.key === "Home" ? 0 : event.key === "End" ? statusTabs.length - 1 : step ? (current + step + statusTabs.length) % statusTabs.length : -1;
    if (target < 0) return;
    event.preventDefault();
    update({ status: statusTabs[target] });
    document.getElementById(`sy-tab-${statusTabs[target] || "all"}`)?.focus();
  }

  function openSystem(event: MouseEvent<HTMLTableRowElement>, id: string) {
    // The row is one click target, except for its own links and controls.
    if (event.target instanceof Element && event.target.closest("a, input, button, label")) return;
    router.push(`/systems/${id}`);
  }

  function renderRow(row: SystemRow, index: number) {
    const share = fulfilment(row);
    const pct = share === null ? 0 : Math.round(share * 100);
    const mine = row.ownerId === userId;
    const days = Math.max(0, Math.floor((now - Date.parse(row.updatedAt)) / DAY_MS));
    const units = row.businessUnits.map((unit) => unit.name);
    const isSelected = selected.has(row.id);
    return (
      <tr key={row.id} className={`sy-row${isSelected ? " sel" : ""}`} data-id={row.id} style={{ "--d": `${Math.min(index, 20) * 14}ms` } as CSSProperties} onClick={(event) => openSystem(event, row.id)}>
        <td className="chk">
          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(row.id)} aria-label={`Select ${row.name}`} />
        </td>
        <td className="c-name">
          <div className="name">
            <Link href={`/systems/${row.id}`}>{row.name}</Link>
            <small>
              {row.vendor ?? "Built in-house"}
              {row.isProvider && (
                <>
                  {" · "}
                  <span className="prov">Provider</span>
                </>
              )}
            </small>
          </div>
        </td>
        <td className="c-status">
          <StatusChip tone={onboardingStatusTone(row.status)}>{STATUS_LABEL[row.status]}</StatusChip>
          {row.openQuestions > 0 && (
            <span className="qbadge" title="Open questions you can act on" aria-label={`${row.openQuestions} open ${row.openQuestions === 1 ? "question" : "questions"}`}>
              ? {row.openQuestions}
            </span>
          )}
        </td>
        <td className="c-owner">
          <span className={`owner${mine ? " me" : ""}`}>
            <span className="av" aria-hidden="true">
              {initialsOf(row.ownerName)}
            </span>
            {row.ownerName}
            {mine && <span className="muted"> (you)</span>}
          </span>
        </td>
        <td className="c-facets">
          {row.facets.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            <span className="facets">
              {row.facets.map((facet) => (
                <span key={facet.id} className="facet">
                  {facet.name}
                </span>
              ))}
            </span>
          )}
        </td>
        <td className="c-cia">
          <span
            className="cia"
            role="img"
            aria-label={`Confidentiality ${levelText(row.confidentiality)}, Integrity ${levelText(row.integrity)}, Availability ${levelText(row.availability)}`}
            title={`C ${levelText(row.confidentiality)} · I ${levelText(row.integrity)} · A ${levelText(row.availability)}`}
          >
            <i data-l={row.confidentiality ? LEVEL_RANK[row.confidentiality] : 0} />
            <i data-l={row.integrity ? LEVEL_RANK[row.integrity] : 0} />
            <i data-l={row.availability ? LEVEL_RANK[row.availability] : 0} />
          </span>
        </td>
        <td className="c-unit muted" title={units.join(", ")}>
          {units.length === 0 ? (
            "—"
          ) : (
            <>
              {units[0]}
              {units.length > 1 && <span className="more"> +{units.length - 1}</span>}
            </>
          )}
        </td>
        <td className="c-prog">
          {share === null ? (
            <span className="muted" title="Nothing applicable to measure against the base Framework">
              —
            </span>
          ) : (
            <div className="prog" title={`${row.met} of ${row.applicable} Requirements of ${view.baseFramework ?? "the base Framework"} met`}>
              <div className="track">
                <div className="fill" style={{ width: `${pct}%` }} />
              </div>
              <span>
                {row.met}/{row.applicable}
              </span>
            </div>
          )}
        </td>
        <td className="c-upd muted" title={new Date(row.updatedAt).toISOString().slice(0, 10)}>
          {ago(days)}
        </td>
        <td className="go" aria-hidden="true">
          <Icon name="arrow" size={16} />
        </td>
      </tr>
    );
  }

  function renderBody() {
    if (rows.length === 0) {
      return (
        <tr>
          <td colSpan={COLUMN_COUNT}>
            <div className="hc-done">
              <h3>No Systems to show yet</h3>
              <p>Systems you can see appear here once there are some.</p>
              {view.canCreate && (
                <Link href="/systems/new" className="hc-btn primary">
                  New System <Icon name="arrow" size={14} />
                </Link>
              )}
            </div>
          </td>
        </tr>
      );
    }
    if (paged.items.length === 0) {
      return (
        <tr>
          <td colSpan={COLUMN_COUNT}>
            <div className="hc-done">
              <h3>No Systems match</h3>
              <p>Nothing in this view fits the search and filters. Loosen one, or start over.</p>
              <button type="button" className="hc-btn" onClick={clearFilters}>
                Clear filters
              </button>
            </div>
          </td>
        </tr>
      );
    }
    if (!state.group) return paged.items.map(renderRow);
    let index = 0;
    return groupRows(paged.items, state.group).map((group) => (
      <GroupRows key={group.name} name={group.name} count={group.rows.length}>
        {group.rows.map((row) => renderRow(row, index++))}
      </GroupRows>
    ));
  }

  return (
    <div className={`hc sy${compact ? " compact" : ""}`} data-page-id={`SYSTEMS . ${view.roleLabel.toUpperCase()}`}>
      <section className="hc-hero" aria-labelledby="sy-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Systems · {view.roleLabel}</span>
          </div>
          <h1 id="sy-title">Systems</h1>
          <p className="hc-lede">
            {rows.length === 0 ? (
              "No Systems to show yet."
            ) : (
              <>
                <span className="num">{rows.length}</span> {rows.length === 1 ? "System" : "Systems"} in the register, {counts.attention}{" "}
                {counts.attention === 1 ? "of them needs" : "of them need"} attention. Filter, sort and group to find one, or press Ctrl K to jump straight to it.
              </>
            )}
          </p>
          <div className="hc-chips">
            <StatusChip tone={own.warn ? "warn" : "accent"}>
              {own.label}: {counts.mine}
            </StatusChip>
            {view.role !== "REVIEWER" && statusCount("IN_REVIEW") > 0 && <StatusChip tone="warn">{statusCount("IN_REVIEW")} in review</StatusChip>}
            {statusCount("REJECTED") > 0 && <StatusChip tone="danger">{statusCount("REJECTED")} rejected</StatusChip>}
          </div>
          <div className="actions">
            {view.canCreate && (
              <Link href="/systems/new" className="hc-btn primary">
                + New System
              </Link>
            )}
            <button type="button" className="hc-btn" onClick={exportRegister} disabled={sorted.length === 0}>
              Export CSV
            </button>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="hc-move">
            <Ring
              segments={STATUS_ORDER.map((status): [number, string] => [statusCount(status) / rows.length, STATUS_COLOR[status]])}
              size={96}
              stroke={10}
              center={`${onboardedPct}%`}
              sub="onboarded"
              label={`${onboardedPct}% of ${rows.length} Systems are onboarded`}
            />
            <ul aria-label="Systems by Onboarding Status">
              {STATUS_ORDER.map((status) => (
                <li key={status}>
                  <button type="button" aria-pressed={state.status === status} onClick={() => update({ status: state.status === status ? "" : status })}>
                    <i style={{ background: STATUS_COLOR[status] }} aria-hidden="true" />
                    <b>{statusCount(status)}</b>
                    {STATUS_LABEL[status]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="hc-stats" aria-label="Saved views">
        {VIEW_KEYS.map((key) => {
          const tone = statTone[key];
          const trend = SHOW_STAT_TRENDS ? view.trends[key] : undefined;
          const pressed = state.view === key;
          return (
            <button
              key={key}
              type="button"
              className={`hc-card hc-stat ${tone ?? ""}`}
              aria-pressed={pressed}
              onClick={() => update({ view: pressed ? "all" : key })}
            >
              <span className="k">
                {statLabel[key]}
                <em aria-hidden="true">{pressed && key !== "all" ? "On ✕" : "Filter →"}</em>
              </span>
              <span className="v">{counts[key]}</span>
              {trend && <Spark values={trend} color={STAT_COLOR[tone ?? ""] ?? "var(--rg-accent)"} />}
            </button>
          );
        })}
      </section>

      <section className="hc-card sy-reg" aria-labelledby="sy-reg-h" ref={regRef}>
        <div className="hc-card-h">
          <h2 id="sy-reg-h">Register</h2>
          <p>
            <kbd className="hc-kbd">/</kbd> to search
            {SHOW_JUMP_PALETTE && (
              <>
                {" · "}
                <button type="button" className="hc-kbd" onClick={openPalette} aria-keyshortcuts="Control+K">
                  Ctrl K
                </button>{" "}
                to jump to a System
              </>
            )}
          </p>
        </div>
        <div className="hc-tabs" role="tablist" aria-label="Onboarding Status">
          {statusTabs.map((status) => (
            <button
              key={status || "all"}
              id={`sy-tab-${status || "all"}`}
              type="button"
              role="tab"
              aria-selected={state.status === status}
              aria-controls="sy-panel"
              tabIndex={state.status === status ? 0 : -1}
              onClick={() => update({ status })}
              onKeyDown={onTabKeyDown}
            >
              {status ? STATUS_LABEL[status] : "All"}
              <span className="n">{base.filter((row) => !status || row.status === status).length}</span>
            </button>
          ))}
        </div>
        <div className="hc-tbar sy-toolbar">
          <label className="hc-search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search name, vendor or owner"
              aria-label="Search Systems"
              autoComplete="off"
              value={state.q}
              onChange={(event) => update({ q: event.target.value }, { replace: true })}
            />
            <kbd className="hc-kbd" aria-hidden="true">
              /
            </kbd>
          </label>
          {FILTERS.map((filter) => {
            const options = filterOptions(rows, filter.key);
            const chosen = state[filter.key] as string[];
            const nameOf = (value: string) => options.find((option) => option.value === value)?.label ?? value;
            const text = chosen.length === 0 ? `+ ${filter.label}` : chosen.length === 1 ? `${filter.label}: ${nameOf(chosen[0])}` : `${filter.label}: ${chosen.length}`;
            const menuId = `sy-menu-${filter.key}`;
            return (
              <div key={filter.key} className={`sy-filter${openFilter === filter.key ? " open" : ""}`} data-filter={filter.key}>
                <button
                  type="button"
                  className={chosen.length > 0 ? "on" : ""}
                  aria-haspopup="true"
                  aria-expanded={openFilter === filter.key}
                  aria-controls={menuId}
                  onClick={() => setOpenFilter(openFilter === filter.key ? null : filter.key)}
                >
                  {text} ▾
                </button>
                {openFilter === filter.key && (
                  <div className="menu" id={menuId} role="group" aria-label={filter.label}>
                    {options.length === 0 && <p className="none">Nothing to choose from</p>}
                    {options.map((option) => (
                      <label key={option.value}>
                        <input type="checkbox" checked={chosen.includes(option.value)} onChange={() => toggleFilterValue(filter.key, option.value)} />
                        <span>{option.label}</span>
                        <span>{base.filter((row) => filterValues(row, filter.key).includes(option.value)).length}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {hasActiveFilters(state) && (
            <button type="button" className="clear" onClick={clearFilters}>
              Clear filters
            </button>
          )}
          <span className="spacer" />
          <label className="grpby">
            Group by
            <select className="hc-sel" value={state.group} onChange={(event) => update({ group: event.target.value as GroupKey }, { keepPage: true })}>
              <option value="">None</option>
              <option value="owner">Owner</option>
              <option value="unit">Business Unit</option>
              <option value="facet">Deployment</option>
            </select>
          </label>
          {SHOW_COMPACT_TOGGLE && (
            <button type="button" className="hc-btn ghost" aria-pressed={compact} title="Toggle compact rows" onClick={() => setCompact(!compact)}>
              Compact
            </button>
          )}
        </div>
        <div id="sy-panel" role="tabpanel" aria-labelledby={`sy-tab-${state.status || "all"}`} className="sy-tablewrap">
          <table aria-label="Systems">
            <thead>
              <tr>
                <th className="chk">
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={allOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = someOnPage;
                    }}
                    onChange={toggleAllOnPage}
                    disabled={pageIds.length === 0}
                  />
                </th>
                {COLUMNS.map((column) => {
                  const on = column.sortable && state.sort === column.key;
                  return (
                    <th key={column.key} aria-sort={on ? (state.dir === 1 ? "ascending" : "descending") : undefined}>
                      {column.sortable ? (
                        <button type="button" onClick={() => sortBy(column.key as SortKey)}>
                          {column.label}
                          <span className="arr" aria-hidden="true">
                            {on && state.dir === -1 ? "▼" : "▲"}
                          </span>
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  );
                })}
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>{renderBody()}</tbody>
          </table>
        </div>
        <div className="sy-foot">
          <div className="legend" aria-label="CIA impact legend">
            <span>CIA impact:</span>
            {(["not classified", "low", "moderate", "high", "critical"] as const).map((text, level) => (
              <span key={text}>
                <span className="cia" aria-hidden="true">
                  <i data-l={level} />
                </span>{" "}
                {text}
              </span>
            ))}
          </div>
          <div className="pagination">
            <span className="num" role="status">
              {sorted.length === 0 ? "0 of 0" : `${paged.from + 1}–${Math.min(paged.from + state.per, sorted.length)} of ${sorted.length}`}
            </span>
            <label>
              Rows{" "}
              <select className="hc-sel" value={state.per} onChange={(event) => update({ per: Number(event.target.value) })}>
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <nav className="pager" aria-label="Pages">
              <button type="button" disabled={paged.page === 1} aria-label="Previous page" onClick={() => goToPage(paged.page - 1)}>
                ‹
              </button>
              {pageNumbers(paged.page, paged.pages).map((n, i) =>
                n === "gap" ? (
                  <span key={`gap-${i}`} aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button key={n} type="button" aria-current={n === paged.page ? "page" : undefined} onClick={() => goToPage(n)}>
                    {n}
                  </button>
                ),
              )}
              <button type="button" disabled={paged.page === paged.pages} aria-label="Next page" onClick={() => goToPage(paged.page + 1)}>
                ›
              </button>
            </nav>
          </div>
        </div>
      </section>

      {selectedRows.length > 0 && (
        <div className="sy-bulk" role="region" aria-label="Bulk actions">
          <span>
            <b>{selectedRows.length}</b> selected
          </span>
          {BULK_ACTIONS.map((action) => (
            <button key={action.key} type="button" onClick={() => action.run(selectedRows)}>
              {action.label}
            </button>
          ))}
          {canChangeAnyOwner(selectedRows, actor) && (
            <button type="button" onClick={() => setChangingOwner(true)}>
              Change owner
            </button>
          )}
          <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            ✕
          </button>
        </div>
      )}

      {changingOwner && (
        <ChangeOwnerDialog
          systems={selectedRows.map((row) => ({
            id: row.id,
            name: row.name,
            ownerId: row.ownerId,
            ownerName: row.ownerName,
            canChange: canChangeOwner(actor, row),
          }))}
          onClose={() => setChangingOwner(false)}
          onDone={() => {
            setChangingOwner(false);
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}

      <p className="sr-only" role="status">
        {`${sorted.length} of ${rows.length} Systems shown`}
      </p>

      {SHOW_JUMP_PALETTE && paletteOpen && <JumpPalette items={paletteItems} onClose={closePalette} placeholder="Jump to a System…" />}
    </div>
  );
}

function GroupRows({ name, count, children }: { name: string; count: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="sy-grp">
        <td colSpan={COLUMN_COUNT}>
          <i aria-hidden="true" />
          {name}
          <small>{count}</small>
        </td>
      </tr>
      {children}
    </>
  );
}

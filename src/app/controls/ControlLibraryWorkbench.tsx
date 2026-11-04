"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, Ring } from "@/app/home/HomeGraphics";
import { useSearchHotkey, type PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { STATUS_LABEL, STATUS_ORDER } from "@/app/organization/controls/controls-logic";
import { CONTROL_BULK_OWNER_MAX, controlBulkLimitMessage } from "@/lib/control-bulk-rules";
import { downloadCsv } from "@/lib/download-csv";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./library.css";
import { AssignOwnerDialog, type OwnedControl } from "./AssignOwnerDialog";
import { LibraryDrawer } from "./LibraryDrawer";
import { currentCode, serverCode, subscribeToHash, writeHash } from "./library-hash";
import {
  CARDS,
  DEFAULT_SORT,
  FACETS,
  FACET_SHOWN,
  GROUP_OPTIONS,
  NO_FILTERS,
  clearFacet,
  facetOptions,
  filterChips,
  filterRows,
  groupRows,
  hasFilters,
  hashForCode,
  libraryCsv,
  libraryCsvFilename,
  nextSort,
  orgImplementedCount,
  orgStatusCounts,
  percentFulfilled,
  plural,
  sortRows,
  statusLabelOf,
  toggleFacetValue,
  viewTest,
  visibleIds,
  type FacetKey,
  type Filters,
  type GroupBy,
  type Sort,
  type SortKey,
  type ViewKey,
} from "./library-logic";
import { ApplicabilityChip, Highlight, OwnerCell, STATUS_COLOR, StatusDot } from "./library-parts";
import type { LibraryRow, LibraryView } from "./library-types";

/** How many rows render at first and each time the end of the table scrolls into view. */
const PAGE = 80;
const COLUMNS = 7;

/**
 * The Control Library, design proposal A "Workbench" in the Home look (issue #313): a hero with the Organization
 * status ring, five cards that filter, a facet rail with live counts, a toolbar (search, Group by), one table of
 * grouped rows that renders in batches, a slide-over drawer per Control (`#<code>` in the URL) and a bulk bar
 * with Export CSV and, for a Compliance Manager or an Admin, Assign owner. `loadControlLibraryView` decides what
 * each row holds, including which Frameworks the viewer sees; this component filters and orders what it was
 * given and updates a row's Control Owner from the route's response after an Assign owner.
 */
export function ControlLibraryWorkbench({ view }: { view: LibraryView }) {
  const router = useRouter();
  const [rows, setRows] = useState(view.rows);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [groupBy, setGroupBy] = useState<GroupBy>("category");
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [expandedFacets, setExpandedFacets] = useState<ReadonlySet<FacetKey>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [limit, setLimit] = useState(PAGE);
  const [railOpen, setRailOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchHotkey(searchRef);

  const { userId, canEdit } = view;
  const openCode = useSyncExternalStore(subscribeToHash, currentCode, serverCode);

  const listed = useMemo(() => sortRows(filterRows(rows, filters, userId), sort), [rows, filters, sort, userId]);
  const groups = useMemo(() => groupRows(listed, groupBy), [listed, groupBy]);
  const order = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const openRow = openCode ? rows.find((row) => row.code === openCode) : undefined;
  const openIndex = openRow ? order.findIndex((row) => row.id === openRow.id) : -1;
  // The open Control's row is always rendered, so it can be scrolled to and stepped from.
  const effectiveLimit = Math.max(limit, openIndex >= 0 ? openIndex + 1 + PAGE : 0);
  const shownIds = useMemo(() => visibleIds(groups, collapsed, effectiveLimit), [groups, collapsed, effectiveLimit]);
  const expandedTotal = useMemo(() => groups.reduce((sum, group) => sum + (collapsed.has(group.key) ? 0 : group.rows.length), 0), [groups, collapsed]);
  const facetData = useMemo(() => FACETS.map((def) => ({ def, options: facetOptions(rows, def.key, filters, userId) })), [rows, filters, userId]);
  const chips = useMemo(() => filterChips(rows, filters), [rows, filters]);

  const totals = useMemo(() => orgStatusCounts(rows), [rows]);
  const implemented = orgImplementedCount(rows);
  const percent = percentFulfilled(rows);
  const noOwner = rows.filter((row) => row.ownerId === null).length;
  const unmapped = rows.filter((row) => row.mappings.length === 0).length;
  const supplementary = rows.filter((row) => row.source.kind === "supplementary").length;
  const selectedRows = listed.filter((row) => selected.has(row.id));
  const allShownSelected = listed.length > 0 && listed.every((row) => selected.has(row.id));
  const active = hasFilters(filters);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!railOpen) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setRailOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [railOpen]);
  // Keep the open Control's row in view as the drawer steps through them.
  const openId = openRow?.id;
  useEffect(() => {
    if (openId) document.getElementById(`cl-row-${openId}`)?.scrollIntoView?.({ block: "nearest" });
  }, [openId]);
  // Render the next batch when the end of the table scrolls into view (the "Show more" button is the fallback).
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = shownIds.size < expandedTotal;
  useEffect(() => {
    const target = sentinelRef.current;
    if (!hasMore || !target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit((current) => current + PAGE);
      },
      { rootMargin: "400px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, shownIds.size]);

  const paletteItems: PaletteItem[] = useMemo(
    () => [
      ...rows.map((row) => ({
        group: "Controls",
        icon: "control" as const,
        label: `${row.code} ${row.title}`,
        meta: row.ownerName ?? "Unassigned",
        href: hashForCode(row.code),
      })),
      ...(canEdit ? [{ group: "Actions", icon: "plus" as const, label: "New Control", meta: "Control Library editor", href: "/admin/controls" }] : []),
    ],
    [rows, canEdit],
  );
  usePagePalette({
    items: paletteItems,
    placeholder: "Jump to a Control…",
    onSelect: (item) => {
      if (item.href.startsWith("#")) writeHash(item.href);
      else router.push(item.href);
    },
  });

  function changeFilters(next: Filters) {
    setFilters(next);
    setLimit(PAGE);
  }
  function chooseView(key: ViewKey) {
    changeFilters({ ...filters, view: filters.view === key ? "all" : key });
  }
  function chooseStatus(status: string) {
    changeFilters({ ...filters, facets: toggleFacetValue(filters.facets, "status", status) });
  }
  function clearFilters() {
    changeFilters(NO_FILTERS);
  }
  function removeChip(chip: { facet: FacetKey | "view"; id: string }) {
    if (chip.facet === "view") changeFilters({ ...filters, view: "all" });
    else changeFilters({ ...filters, facets: toggleFacetValue(filters.facets, chip.facet, chip.id.slice(chip.facet.length + 1)) });
  }
  function toggleGroup(key: string) {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    setCollapsed(next);
  }
  function toggleSelected(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }
  function toggleAllShown(on: boolean) {
    const next = new Set(selected);
    for (const row of listed) {
      if (on) next.add(row.id);
      else next.delete(row.id);
    }
    setSelected(next);
  }

  function openControl(row: LibraryRow) {
    setRailOpen(false);
    writeHash(hashForCode(row.code));
  }
  function closeDrawer() {
    writeHash("");
  }
  function step(delta: -1 | 1) {
    if (order.length === 0) return;
    const at = openIndex < 0 ? (delta === 1 ? -1 : order.length) : openIndex;
    const next = order[Math.max(0, Math.min(order.length - 1, at + delta))];
    if (next && next.id !== openRow?.id) writeHash(hashForCode(next.code), { replace: true });
  }

  function exportView() {
    downloadCsv(libraryCsv(order), libraryCsvFilename(new Date()));
  }
  function exportSelection() {
    downloadCsv(libraryCsv(order.filter((row) => selected.has(row.id))), libraryCsvFilename(new Date(), true));
  }

  function ownerAssigned(saved: OwnedControl[], ownerName: string | null) {
    const byId = new Map(saved.map((control) => [control.id, control.owner]));
    setRows((current) =>
      current.map((row) => (byId.has(row.id) ? { ...row, ownerId: byId.get(row.id)?.id ?? null, ownerName: byId.get(row.id)?.name ?? null } : row)),
    );
    setAssignOpen(false);
    setSelected(new Set());
    setNotice(ownerName ? `${ownerName} is now the Control Owner of ${plural(saved.length, "Control")}` : `Control Owner cleared on ${plural(saved.length, "Control")}`);
  }

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, row: LibraryRow) {
    // The row is one click target, except for its own checkbox.
    if (event.target instanceof Element && event.target.closest("button, input, label, a")) return;
    openControl(row);
  }
  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: LibraryRow) {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openControl(row);
    }
  }

  function renderRow(row: LibraryRow) {
    const isOpen = openRow?.id === row.id;
    return (
      <tr
        key={row.id}
        id={`cl-row-${row.id}`}
        className={`cl-row${isOpen ? " active" : ""}${selected.has(row.id) ? " sel" : ""}`}
        tabIndex={0}
        aria-label={`${row.code} ${row.title}`}
        aria-current={isOpen ? "true" : undefined}
        onClick={(event) => onRowClick(event, row)}
        onKeyDown={(event) => onRowKeyDown(event, row)}
      >
        <td className="chk">
          <input type="checkbox" aria-label={`Select ${row.code}`} checked={selected.has(row.id)} onChange={(event) => toggleSelected(row.id, event.target.checked)} />
        </td>
        <td className="c-code">
          <span className="cl-code">
            <Highlight text={row.code} query={filters.query} />
          </span>
        </td>
        <td className="c-ttl">
          <div className="ttl">
            <b>
              <Highlight text={row.title} query={filters.query} />
            </b>
            <small>
              <Highlight text={row.description} query={filters.query} />
            </small>
          </div>
        </td>
        <td className="c-app">
          <ApplicabilityChip applicability={row.applicability} />
        </td>
        <td className="c-own">
          <OwnerCell name={row.ownerName} query={filters.query} />
        </td>
        <td className={`c-maps num${row.mappings.length === 0 ? " zero" : ""}`} title="Requirements satisfied">
          <span className="sr-only">Requirements satisfied: </span>
          {row.mappings.length}
        </td>
        <td className="c-status">
          {row.orgStatus ? (
            <span className="cl-st">
              <StatusDot status={row.orgStatus} />
              {statusLabelOf(row)}
            </span>
          ) : (
            <span className="cl-faint">{statusLabelOf(row)}</span>
          )}
        </td>
      </tr>
    );
  }

  function renderBody() {
    if (listed.length === 0) {
      return (
        <tr>
          <td colSpan={COLUMNS}>
            <div className="hc-done">
              <h3>{rows.length === 0 ? "The Control Library is empty" : "No Controls match"}</h3>
              <p>{rows.length === 0 ? "No Controls have been added yet." : "Clear the search or the filters to see more Controls."}</p>
              {active && (
                <button type="button" className="hc-btn" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          </td>
        </tr>
      );
    }
    return groups.map((group) => {
      const isCollapsed = collapsed.has(group.key);
      // A group whose rows are all beyond the batch waits for the next one.
      if (!isCollapsed && !shownIds.has(group.rows[0].id)) return null;
      return (
        <Fragment key={group.key || "all"}>
          {groupBy !== "none" && (
            <tr className="sy-grp cl-grp">
              <td colSpan={COLUMNS}>
                <button type="button" className="cl-grp-in" aria-expanded={!isCollapsed} onClick={() => toggleGroup(group.key)}>
                  <span className="tw" aria-hidden="true">
                    ▾
                  </span>
                  <span className="gname">{group.name}</span>
                  <small>{plural(group.rows.length, "Control")}</small>
                  <span className="cl-gbar" role="img" aria-label={`${group.owned} of ${group.rows.length} owned`} title={`${group.owned} of ${group.rows.length} owned`}>
                    <i style={{ width: `${(group.owned / group.rows.length) * 100}%` }} />
                  </span>
                </button>
              </td>
            </tr>
          )}
          {!isCollapsed && group.rows.filter((row) => shownIds.has(row.id)).map(renderRow)}
        </Fragment>
      );
    });
  }

  const sortHeader = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort(nextSort(sort, key))}>
        {label}
        <span className="arr" aria-hidden="true">
          {sort.key === key ? (sort.dir === 1 ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );

  const lede =
    rows.length === 0 ? (
      "The Control Library has no Controls yet."
    ) : (
      <>
        <b>{rows.length}</b> {rows.length === 1 ? "Control" : "Controls"}, {rows.length - supplementary} base and {supplementary} Supplementary. <b>{noOwner}</b>{" "}
        {noOwner === 1 ? "needs" : "need"} an owner and <b>{unmapped}</b> {unmapped === 1 ? "is" : "are"} not mapped to any Requirement.
      </>
    );

  return (
    <div className="hc sy cl" data-page-id={`CONTROL LIBRARY . ${view.roleLabel.toUpperCase()}`}>
      <section className="hc-hero" aria-labelledby="cl-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Catalog</span>
          </div>
          <h1 id="cl-title">Control Library</h1>
          <p className="hc-lede">{lede}</p>
          <div className="actions">
            {canEdit && (
              <Link className="hc-btn primary" href="/admin/controls">
                + New Control
              </Link>
            )}
            {canEdit && (
              <button type="button" className="hc-btn" disabled title="Coming later: importing a Framework in the app is not built yet">
                Import
              </button>
            )}
            <button type="button" className="hc-btn" onClick={exportView} disabled={listed.length === 0}>
              Download CSV
            </button>
            {canEdit && <span className="cl-later">Import: coming later</span>}
          </div>
        </div>
        {implemented > 0 && (
          <div className="hc-move">
            <Ring
              segments={STATUS_ORDER.filter((status) => status !== "NOT_STARTED").map((status): [number, string] => [totals[status] / implemented, STATUS_COLOR[status]])}
              size={104}
              stroke={12}
              center={`${percent}%`}
              sub="Fulfilled"
              label={`${percent}% of ${plural(implemented, "Organizational and Both Control")} are Fulfilled`}
            />
            <ul aria-label="Organizational and Both Controls by Organization status">
              {STATUS_ORDER.map((status) => (
                <li key={status}>
                  <button type="button" aria-pressed={(filters.facets.status ?? []).includes(status)} onClick={() => chooseStatus(status)}>
                    <i className={`cl-s-${status}`} aria-hidden="true" />
                    <b>{totals[status]}</b>
                    {STATUS_LABEL[status]}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="hc-stats" aria-label="Views">
        {CARDS.map((card) => {
          const pressed = filters.view === card.key;
          return (
            <button key={card.key} type="button" className={`hc-card hc-stat ${card.tone}`} aria-pressed={pressed} onClick={() => chooseView(card.key)}>
              <span className="k">
                {card.label}
                <em aria-hidden="true">{pressed ? "Showing" : "Show"}</em>
              </span>
              <span className="v">{rows.filter(viewTest(card.key, userId)).length}</span>
            </button>
          );
        })}
      </section>

      <div className="cl-body">
        {railOpen && <div className="cl-scrim" data-testid="library-rail-scrim" aria-hidden="true" onClick={() => setRailOpen(false)} />}
        <aside className={`cl-rail${railOpen ? " open" : ""}`} aria-label="Filters" id="cl-rail">
          <div className="cl-rail-h">
            <b>Filters</b>
            <button type="button" className="hc-btn ghost cl-rail-x" aria-label="Close filters" onClick={() => setRailOpen(false)}>
              ✕
            </button>
          </div>
          {facetData.map(({ def, options }) => {
            const picked = filters.facets[def.key] ?? [];
            const open = expandedFacets.has(def.key);
            const shown = def.long && !open ? options.filter((option, index) => index < FACET_SHOWN || picked.includes(option.value)) : options;
            return (
              <fieldset key={def.key} className="cl-facet">
                <legend>
                  {def.label}
                  {picked.length > 0 && (
                    <button type="button" onClick={() => changeFilters({ ...filters, facets: clearFacet(filters.facets, def.key) })} aria-label={`Clear ${def.label}`}>
                      Clear
                    </button>
                  )}
                </legend>
                {shown.map((option) => (
                  <label key={option.value} className={`cl-opt${option.count === 0 ? " zero" : ""}`}>
                    <input
                      type="checkbox"
                      checked={picked.includes(option.value)}
                      onChange={() => changeFilters({ ...filters, facets: toggleFacetValue(filters.facets, def.key, option.value) })}
                    />
                    <span title={option.label}>{option.label}</span>
                    <span className="c">{option.count}</span>
                  </label>
                ))}
                {def.long && options.length > FACET_SHOWN && (
                  <button
                    type="button"
                    className="cl-more"
                    onClick={() => {
                      const next = new Set(expandedFacets);
                      if (!next.delete(def.key)) next.add(def.key);
                      setExpandedFacets(next);
                    }}
                  >
                    {open ? "Show fewer" : `Show all ${options.length}`}
                  </button>
                )}
              </fieldset>
            );
          })}
        </aside>

        <section className="hc-card sy-reg cl-main" aria-label="Controls">
          <div className="hc-tbar sy-toolbar">
            <button type="button" className="hc-btn cl-filters-btn" aria-controls="cl-rail" aria-expanded={railOpen} onClick={() => setRailOpen(true)}>
              Filters{chips.length > 0 ? ` (${chips.length})` : ""}
            </button>
            <label className="hc-search">
              <Icon name="search" size={15} />
              <input
                ref={searchRef}
                type="search"
                placeholder="Search code, title, description, category or owner"
                aria-label="Search Controls"
                autoComplete="off"
                value={filters.query}
                onChange={(event) => changeFilters({ ...filters, query: event.target.value })}
              />
              <kbd className="hc-kbd" aria-hidden="true">
                /
              </kbd>
            </label>
            <span className="spacer" />
            <span className="cl-lbl" aria-hidden="true">
              Group by
            </span>
            <span className="cl-seg" role="group" aria-label="Group by">
              {GROUP_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={groupBy === option.key}
                  onClick={() => {
                    setGroupBy(option.key);
                    setCollapsed(new Set());
                  }}
                >
                  {option.label}
                </button>
              ))}
            </span>
          </div>
          {chips.length > 0 && (
            <div className="cl-chips" aria-label="Active filters">
              {chips.map((chip) => (
                <span key={chip.id} className="cl-fchip">
                  {chip.label}: <b>{chip.value}</b>
                  <button type="button" aria-label={`Remove ${chip.label} ${chip.value}`} onClick={() => removeChip(chip)}>
                    ×
                  </button>
                </span>
              ))}
              <button type="button" className="clear" onClick={clearFilters}>
                Clear all
              </button>
            </div>
          )}
          <div className="sy-tablewrap">
            <table aria-label="Controls">
              <thead>
                <tr>
                  <th className="chk">
                    <input type="checkbox" aria-label="Select all shown" checked={allShownSelected} disabled={listed.length === 0} onChange={(event) => toggleAllShown(event.target.checked)} />
                  </th>
                  {sortHeader("code", "ID")}
                  {sortHeader("title", "Control")}
                  <th>Applicability</th>
                  {sortHeader("owner", "Owner")}
                  {sortHeader("maps", "Maps")}
                  {sortHeader("status", "Status")}
                </tr>
              </thead>
              <tbody>{renderBody()}</tbody>
            </table>
            {hasMore && (
              <div className="cl-sentinel" ref={sentinelRef}>
                <span>
                  Showing {shownIds.size} of {expandedTotal}
                </span>
                <button type="button" className="hc-btn" onClick={() => setLimit(effectiveLimit + PAGE)}>
                  Show {PAGE} more
                </button>
              </div>
            )}
          </div>
          <div className="sy-foot">
            <span role="status" aria-live="polite">
              {listed.length} of {plural(rows.length, "Control")}
            </span>
            <span className="legend">
              {STATUS_ORDER.map((status) => (
                <span key={status}>
                  <span className={`cl-dot cl-s-${status}`} aria-hidden="true" />
                  {STATUS_LABEL[status]}
                </span>
              ))}
            </span>
          </div>
        </section>
      </div>

      {selectedRows.length > 0 && (
        <div className="sy-bulk" role="region" aria-label="Bulk actions">
          <span>
            <b>{selectedRows.length}</b> selected
          </span>
          {canEdit && selectedRows.length > CONTROL_BULK_OWNER_MAX && <span role="alert">{controlBulkLimitMessage(selectedRows.length)}</span>}
          <button type="button" onClick={exportSelection}>
            Export CSV
          </button>
          {canEdit && (
            <button type="button" onClick={() => setAssignOpen(true)}>
              Assign owner…
            </button>
          )}
          <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            ✕
          </button>
        </div>
      )}

      {assignOpen && canEdit && selectedRows.length > 0 && (
        <AssignOwnerDialog rows={selectedRows} owners={view.owners} onClose={() => setAssignOpen(false)} onDone={ownerAssigned} />
      )}

      {openRow && (
        <LibraryDrawer
          key={openRow.id}
          row={openRow}
          canEdit={canEdit}
          position={openIndex >= 0 ? `${openIndex + 1} of ${order.length}` : ""}
          onClose={closeDrawer}
          onStep={step}
        />
      )}

      {notice && (
        <p className="cl-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

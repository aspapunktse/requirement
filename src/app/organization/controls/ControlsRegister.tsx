"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import Link from "next/link";
import type { ControlAssessmentStatus } from "@prisma/client";
import { Icon, Ring } from "@/app/home/HomeGraphics";
import { useSearchHotkey, type PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { ORGANIZATION_BULK_MAX_CONTROLS, bulkLimitMessage } from "@/lib/organization-implementation-rules";
import { downloadCsv } from "@/lib/download-csv";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./controls.css";
import { BulkStatusDialog, type SavedControl } from "./BulkStatusDialog";
import { ImplementationEditor } from "./ImplementationEditor";
import { OwnerCell, StatusBar, StatusChip, StatusCountList, STATUS_COLOR, describeStatuses } from "./controls-parts";
import {
  ALL_TAB,
  CARDS,
  STATUS_LABEL,
  STATUS_ORDER,
  applySaved,
  baseRows,
  filterRows,
  formatDate,
  groupRows,
  hasBeenEdited,
  nextEditableId,
  percentFulfilled,
  reachTag,
  reachText,
  statusCounts,
  tabsFor,
  themeOf,
  viewCsv,
  viewCsvFilename,
  viewOfStatus,
  viewTest,
  type AppliesFilter,
  type GroupBy,
  type ViewKey,
} from "./controls-logic";
import type { OrgControlRow, OrgView } from "./controls-types";

const COLUMNS = 8;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Organization Control Implementations register, design proposal A "Implementation register" in the Home
 * look (issue #284): a hero with the status ring, five cards that filter, tabs per theme with counts, a
 * toolbar (search, Applies to, Group by), one table whose row opens its status editor in place, and a bulk
 * "Set status…". `loadOrganizationControlsView` decides what each row holds, including whether the acting
 * user may edit it; this component filters and orders what it was given and updates a row from the route's
 * response after a save, so the hero, cards, tabs and rows follow at once.
 */
export function ControlsRegister({ view, initialMine = false }: { view: OrgView; initialMine?: boolean }) {
  const [rows, setRows] = useState(view.rows);
  const [viewKey, setViewKey] = useState<ViewKey>(initialMine ? "mine" : "all");
  const [tab, setTab] = useState(ALL_TAB);
  const [query, setQuery] = useState("");
  const [applies, setApplies] = useState<AppliesFilter>("all");
  const [groupBy, setGroupBy] = useState<GroupBy>("status");
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusEditorId, setFocusEditorId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<{ id: string; n: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchHotkey(searchRef);

  const userId = view.userId;
  const tabs = useMemo(() => tabsFor(rows), [rows]);
  const base = useMemo(() => baseRows(rows, { view: viewKey, applies, query }, userId), [rows, viewKey, applies, query, userId]);
  const listed = useMemo(() => filterRows(rows, { view: viewKey, applies, query, tab }, userId), [rows, viewKey, applies, query, tab, userId]);
  const groups = useMemo(() => groupRows(listed, groupBy), [listed, groupBy]);
  const order = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const totals = useMemo(() => statusCounts(rows), [rows]);
  const percent = percentFulfilled(rows);
  const both = rows.filter((row) => row.applicability === "BOTH");
  const bothFulfilled = both.filter((row) => row.status === "FULFILLED").length;
  const editableShown = listed.filter((row) => row.canEdit);
  const selectedRows = listed.filter((row) => row.canEdit && selected.has(row.id));
  const allShownSelected = editableShown.length > 0 && editableShown.every((row) => selected.has(row.id));
  const hasFilters = viewKey !== "all" || tab !== ALL_TAB || query.trim() !== "" || applies !== "all";

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => setFlashId(null), 1500);
    return () => clearTimeout(timer);
  }, [flashId]);
  useEffect(() => {
    if (scrollTo) document.getElementById(`oc-row-${scrollTo.id}`)?.scrollIntoView?.({ block: "center" });
  }, [scrollTo]);

  const paletteItems: PaletteItem[] = useMemo(
    () =>
      rows.map((row) => ({
        group: "Organization Controls",
        icon: "control" as const,
        label: `${row.code} ${row.title}`,
        meta: STATUS_LABEL[row.status],
        href: `#control-${row.id}`,
      })),
    [rows],
  );
  usePagePalette({
    items: paletteItems,
    placeholder: "Jump to an Organization Control…",
    onSelect: (item) => jumpTo(item.href.replace("#control-", "")),
  });

  /** The palette: clear what would hide the Control, then open its row. */
  function jumpTo(id: string) {
    setViewKey("all");
    setTab(ALL_TAB);
    setQuery("");
    setApplies("all");
    setOpenId(id);
    setScrollTo((current) => ({ id, n: (current?.n ?? 0) + 1 }));
  }

  function chooseView(key: ViewKey) {
    setViewKey(viewKey === key ? "all" : key);
  }
  function clearFilters() {
    setViewKey("all");
    setTab(ALL_TAB);
    setQuery("");
    setApplies("all");
  }
  function toggleOpen(id: string) {
    setOpenId((current) => (current === id ? null : id));
    setFocusEditorId(null);
  }
  function toggleSelected(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }
  function toggleAllShown(on: boolean) {
    const next = new Set(selected);
    for (const row of editableShown) {
      if (on) next.add(row.id);
      else next.delete(row.id);
    }
    setSelected(next);
  }

  function applyToRows(saved: SavedControl[]) {
    const byId = new Map(saved.map((control) => [control.id, control]));
    setRows((current) => current.map((row) => (byId.has(row.id) ? applySaved(row, byId.get(row.id)!) : row)));
  }

  /** One write. On success the row is updated from the response and the editor closes or moves on. Resolves to an error message or null. */
  async function saveRow(row: OrgControlRow, input: { status: ControlAssessmentStatus; description: string }, andNext: boolean): Promise<string | null> {
    let saved: SavedControl;
    try {
      const response = await fetch(`/api/organization/controls/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: input.status, description: input.description }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return typeof body?.error === "string" ? body.error : "The implementation could not be saved";
      saved = body.control;
    } catch {
      return "The implementation could not be saved";
    }
    const next = andNext ? nextEditableId(order, row.id) : null;
    applyToRows([saved]);
    setFlashId(row.id);
    setOpenId(next);
    setFocusEditorId(next);
    setNotice(`${row.code} saved${saved.implementation.status !== row.status ? ` as ${STATUS_LABEL[saved.implementation.status]}` : ""}`);
    return null;
  }

  function exportView() {
    downloadCsv(viewCsv(order), viewCsvFilename(new Date()));
  }

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, id: string) {
    // The row is one click target, except for its own checkbox.
    if (event.target instanceof Element && event.target.closest("button, input, label, a")) return;
    toggleOpen(id);
  }
  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, id: string) {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      toggleOpen(id);
    }
  }

  function renderRow(row: OrgControlRow) {
    const open = openId === row.id;
    const tag = reachTag(row);
    return (
      <Fragment key={row.id}>
        <tr
          id={`oc-row-${row.id}`}
          className={`oc-row${flashId === row.id ? " flash" : ""}`}
          tabIndex={0}
          aria-expanded={open}
          aria-label={`${row.code} ${row.title}`}
          onClick={(event) => onRowClick(event, row.id)}
          onKeyDown={(event) => onRowKeyDown(event, row.id)}
        >
          <td className="chk">
            {row.canEdit && (
              <input type="checkbox" aria-label={`Select ${row.code}`} checked={selected.has(row.id)} onChange={(event) => toggleSelected(row.id, event.target.checked)} />
            )}
          </td>
          <td className="c-code">
            <span className="oc-code">{row.code}</span>
          </td>
          <td className="c-ttl">
            <div className="ttl">
              <b>{row.title}</b>
              <span className="tags">
                <span className={`oc-tag${row.applicability === "BOTH" ? " both" : ""}`} title={row.applicability === "BOTH" ? "Also assessed per System; while Fulfilled here, it is inherited" : undefined}>
                  {row.applicability === "BOTH" ? "Both" : "Organizational"}
                </span>
                {tag && <span className="oc-inh">{tag}</span>}
              </span>
            </div>
          </td>
          <td className="c-own">
            <OwnerCell name={row.ownerName} />
          </td>
          <td className="c-status">
            <StatusChip status={row.status} />
          </td>
          <td className="c-desc">{row.description ? <p className="oc-desc">{row.description}</p> : <span className="oc-nodesc">No description</span>}</td>
          <td className="upd">
            {hasBeenEdited(row) ? (
              <>
                {formatDate(row.updatedAt)}
                {row.updatedByName && <small>by {row.updatedByName}</small>}
              </>
            ) : (
              "—"
            )}
          </td>
          <td className="chev" aria-hidden="true">
            <span>›</span>
          </td>
        </tr>
        {open && (
          <tr className="oc-exp">
            <td colSpan={COLUMNS}>
              <div className="oc-expin">
                <div>
                  <ImplementationEditor
                    key={`${row.id}:${row.updatedAt}`}
                    row={row}
                    roleLabel={view.roleLabel}
                    userName={view.userName}
                    hasNext={nextEditableId(order, row.id) !== null}
                    autoFocus={focusEditorId === row.id}
                    onSave={(input, andNext) => saveRow(row, input, andNext)}
                    onCancel={() => setOpenId(null)}
                  />
                </div>
                <div className="oc-facts">
                  <div>
                    <h3>What it does for Systems</h3>
                    <p>{reachText(row)}</p>
                  </div>
                  <div>
                    <h3>The Control</h3>
                    <p>{row.summary}</p>
                  </div>
                  <div>
                    <h3>History</h3>
                    {row.history.length > 0 ? (
                      <ul className="oc-hist">
                        {row.history.map((entry, index) => (
                          <li key={`${entry.at}-${index}`}>
                            {formatDate(entry.at)} · {entry.by} set <b>{STATUS_LABEL[entry.to]}</b> (was {STATUS_LABEL[entry.from]})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No status change recorded yet.</p>
                    )}
                    {hasBeenEdited(row) && (
                      <p className="oc-last">
                        Last updated {formatDate(row.updatedAt)}
                        {row.updatedByName ? ` by ${row.updatedByName}` : ""}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  }

  function renderBody() {
    if (listed.length === 0) {
      return (
        <tr>
          <td colSpan={COLUMNS}>
            <div className="hc-done">
              <h3>{viewKey === "mine" && rows.every((row) => row.ownerId !== userId) ? "You own no Controls" : "No Controls match"}</h3>
              <p>{rows.length === 0 ? "The Organization has no Organizational or Both Controls yet." : "Clear the search or pick another view."}</p>
              {hasFilters && (
                <button type="button" className="hc-btn" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          </td>
        </tr>
      );
    }
    return groups.map((group) => (
      <Fragment key={group.key || "all"}>
        {groupBy !== "none" && (
          <tr className="sy-grp">
            <td colSpan={COLUMNS}>
              <div className="oc-grp-in">
                <span>{group.name}</span>
                <small>{plural(group.rows.length, "Control")}</small>
                {groupBy === "owner" && (
                  <>
                    <StatusBar counts={group.counts} label={describeStatuses(group.counts)} />
                    <StatusCountList counts={group.counts} />
                  </>
                )}
              </div>
            </td>
          </tr>
        )}
        {group.rows.map(renderRow)}
      </Fragment>
    ));
  }

  const lede =
    rows.length === 0 ? (
      "The Organization has no Organizational or Both Controls yet."
    ) : (
      <>
        How the Organization implements its <b>{rows.length}</b> Organizational and Both Controls. <b>{percent}%</b> are Fulfilled.{" "}
        {both.length > 0 && (
          <>
            <b>{bothFulfilled}</b> of {both.length} Both {both.length === 1 ? "Control is" : "Controls are"} Fulfilled and inherited by the Systems {both.length === 1 ? "it applies" : "they apply"} to;{" "}
          </>
        )}
        <b>{totals.NOT_STARTED}</b> {totals.NOT_STARTED === 1 ? "Control has" : "Controls have"} not been started.
      </>
    );

  return (
    <div className="hc sy oc" data-page-id={`ORGANIZATION CONTROLS . ${view.roleLabel.toUpperCase()}`}>
      <section className="hc-hero" aria-labelledby="oc-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Organization</span>
          </div>
          <h1 id="oc-title">Organization Control Implementations</h1>
          <p className="hc-lede">{lede}</p>
          <div className="actions">
            <button type="button" className="hc-btn" onClick={exportView} disabled={listed.length === 0}>
              Download CSV
            </button>
            <Link className="hc-btn" href="/statement-of-applicability">
              Statement of Applicability →
            </Link>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="hc-move">
            <Ring
              segments={STATUS_ORDER.filter((status) => status !== "NOT_STARTED").map((status): [number, string] => [totals[status] / rows.length, STATUS_COLOR[status]])}
              size={104}
              stroke={12}
              center={`${percent}%`}
              sub="Fulfilled"
              label={`${percent}% of ${plural(rows.length, "Control")} are Fulfilled`}
            />
            <ul aria-label="Controls by status">
              {STATUS_ORDER.map((status) => {
                const target = viewOfStatus(status);
                return (
                  <li key={status}>
                    <button type="button" aria-pressed={viewKey === target} onClick={() => chooseView(target)}>
                      <i className={`oc-s-${status}`} aria-hidden="true" />
                      <b>{totals[status]}</b>
                      {STATUS_LABEL[status]}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>

      <section className="hc-stats" aria-label="Views">
        {CARDS.map((card) => {
          const count = rows.filter(viewTest(card.key, userId)).length;
          const pressed = viewKey === card.key;
          return (
            <button key={card.key} type="button" className={`hc-card hc-stat ${card.tone}`} aria-pressed={pressed} onClick={() => chooseView(card.key)}>
              <span className="k">
                {card.label}
                <em aria-hidden="true">{pressed ? "Showing" : "Show"}</em>
              </span>
              <span className="v">{count}</span>
            </button>
          );
        })}
      </section>

      <section className="hc-card sy-reg" aria-label="Organization Controls">
        <div className="hc-tabs oc-tabs" role="tablist" aria-label="Themes">
          {tabs.map((item) => {
            const count = item.key === ALL_TAB ? base.length : base.filter((row) => themeOf(row).key === item.key).length;
            return (
              <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}>
                {item.label}
                <span className="n">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="hc-tbar sy-toolbar">
          <label className="hc-search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search code, title, description or owner"
              aria-label="Search Controls"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd className="hc-kbd" aria-hidden="true">
              /
            </kbd>
          </label>
          <span className="oc-seg" role="group" aria-label="Applies to">
            {([["all", "All"], ["ORGANIZATIONAL", "Organizational"], ["BOTH", "Both"]] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={applies === key} onClick={() => setApplies(key)}>
                {label}
              </button>
            ))}
          </span>
          <span className="spacer" />
          <span className="oc-lbl" aria-hidden="true">
            Group by
          </span>
          <span className="oc-seg" role="group" aria-label="Group by">
            {([["status", "Status"], ["owner", "Owner"], ["none", "None"]] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={groupBy === key} onClick={() => setGroupBy(key)}>
                {label}
              </button>
            ))}
          </span>
        </div>
        <div className="sy-tablewrap">
          <table aria-label="Organization Controls">
            <thead>
              <tr>
                <th className="chk">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allShownSelected}
                    disabled={editableShown.length === 0}
                    onChange={(event) => toggleAllShown(event.target.checked)}
                  />
                </th>
                <th>Code</th>
                <th>Control</th>
                <th>Control Owner</th>
                <th>Status</th>
                <th>Description</th>
                <th>Last updated</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>{renderBody()}</tbody>
          </table>
        </div>
        <div className="sy-foot">
          <span role="status" aria-live="polite">
            {listed.length} of {plural(rows.length, "Control")}
          </span>
          <span className="legend">
            {STATUS_ORDER.map((status) => (
              <span key={status}>
                <span className={`oc-dot oc-s-${status}`} aria-hidden="true" />
                {STATUS_LABEL[status]}
              </span>
            ))}
          </span>
        </div>
      </section>

      {selectedRows.length > 0 && (
        <div className="sy-bulk" role="region" aria-label="Bulk actions">
          <span>
            <b>{selectedRows.length}</b> selected
          </span>
          {selectedRows.length > ORGANIZATION_BULK_MAX_CONTROLS && <span role="alert">{bulkLimitMessage(selectedRows.length)}</span>}
          <button type="button" onClick={() => setBulkOpen(true)}>
            Set status…
          </button>
          <button type="button" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            ✕
          </button>
        </div>
      )}

      {bulkOpen && selectedRows.length > 0 && (
        <BulkStatusDialog
          rows={selectedRows}
          onClose={() => setBulkOpen(false)}
          onDone={(saved, status) => {
            applyToRows(saved);
            setBulkOpen(false);
            setSelected(new Set());
            setNotice(`${plural(saved.length, "Control")} set to ${STATUS_LABEL[status]}`);
          }}
        />
      )}

      {notice && (
        <p className="oc-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

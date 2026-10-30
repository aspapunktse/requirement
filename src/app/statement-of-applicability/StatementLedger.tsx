"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Icon, Ring } from "@/app/home/HomeGraphics";
import { useSearchHotkey, type PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { downloadCsv } from "@/lib/download-csv";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./statement.css";
import { LedgerDrawer } from "./LedgerDrawer";
import { CountsBar, Highlight, RequirementChips, RollupBar, StatusText } from "./ledger-parts";
import {
  CARD_VIEW,
  ORG_ORDER,
  ROLLUP_ORDER,
  VIEWS,
  applicabilityText,
  appliesText,
  frameworkOptions,
  groupFigures,
  groupRows,
  isDoneStatus,
  matchesFilters,
  nextMissingId,
  percentText,
  totalsOf,
  viewCsv,
  viewCsvFilename,
  type AppliesFilter,
  type CardKey,
  type GroupBy,
  type ViewKey,
} from "./soa-logic";
import type { SoaLedgerRow, SoaView } from "./soa-types";

/** Controls drawn at first, and added each time the end of the table scrolls into view (or "Show more" is pressed). */
const BATCH = 90;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function errorOf(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : fallback;
}

/**
 * The Statement of Applicability, design proposal A "Statement Ledger" in the Home look (issue #272): a hero with
 * the included-of-all ring and the two downloads, four cards that filter, view tabs with counts, a toolbar
 * (search, Framework, Applies to, Group by, density), one table grouped by domain, source or implementation that
 * renders in batches, and the Control drawer. `loadSoaView` decides who sees which System; this component only
 * filters and orders what it was given. A written justification updates its row from the route's response, so
 * the cards, tabs and groups follow at once.
 */
export function StatementLedger({ view }: { view: SoaView }) {
  const { canEdit, systems } = view;
  const [rows, setRows] = useState(view.rows);
  const rowsRef = useRef(rows);
  const [viewKey, setViewKey] = useState<ViewKey>("all");
  const [card, setCard] = useState<CardKey | null>(null);
  const [query, setQuery] = useState("");
  const [framework, setFramework] = useState("");
  const [applies, setApplies] = useState<AppliesFilter>("");
  const [groupBy, setGroupBy] = useState<GroupBy>("domain");
  const [compact, setCompact] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [limit, setLimit] = useState(BATCH);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const moreRef = useRef<HTMLTableCellElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useSearchHotkey(searchRef);

  const totals = useMemo(() => totalsOf(rows), [rows]);
  const frameworks = useMemo(() => frameworkOptions(rows), [rows]);
  const listed = useMemo(() => rows.filter((row) => matchesFilters(row, { view: viewKey, query, framework, applies })), [rows, viewKey, query, framework, applies]);
  const groups = useMemo(() => groupRows(listed, groupBy), [listed, groupBy]);
  const order = useMemo(() => groups.flatMap((group) => group.rows.map((row) => row.controlId)), [groups]);
  const openRow = openId ? (rows.find((row) => row.controlId === openId) ?? null) : null;
  const hasFilters = viewKey !== "all" || query.trim() !== "" || framework !== "" || applies !== "";

  // Which rows are drawn: the open groups' rows, as many as the limit allows (a group's header is drawn when its turn comes).
  const drawn = useMemo(() => {
    let budget = limit;
    const parts: { key: string; name: string; rows: SoaLedgerRow[]; total: number; expanded: boolean }[] = [];
    let openCount = 0;
    for (const group of groups) {
      const expanded = !groupBy || !collapsed.has(group.key);
      if (expanded) openCount += group.rows.length;
      // Every header is drawn; the budget only limits the rows of expanded groups.
      const part = expanded ? group.rows.slice(0, Math.max(0, budget)) : [];
      budget -= part.length;
      parts.push({ key: group.key, name: group.name, rows: part, total: group.rows.length, expanded });
    }
    return { parts, shown: parts.reduce((sum, part) => sum + part.rows.length, 0), openCount };
  }, [groups, groupBy, collapsed, limit]);
  const more = drawn.shown < drawn.openCount;

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // The end of the table scrolling into view draws the next batch.
  useEffect(() => {
    const target = moreRef.current;
    if (!more || !target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setLimit((current) => current + BATCH);
      },
      { rootMargin: "400px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, drawn.shown]);

  const paletteItems: PaletteItem[] = useMemo(
    () =>
      rows.map((row) => ({
        group: "Statement of Applicability",
        icon: "doc" as const,
        label: `${row.code} ${row.title}`,
        meta: row.included ? "Included" : row.justificationMissing ? "Excluded · no justification" : "Excluded",
        href: `#control-${row.controlId}`,
      })),
    [rows],
  );
  usePagePalette({
    items: paletteItems,
    placeholder: "Jump to a Control in the Statement…",
    onSelect: (item) => openDrawer(item.href.replace("#control-", "")),
  });

  function openDrawer(id: string) {
    if (!openId) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpenId(id);
  }
  function closeDrawer() {
    setOpenId(null);
    // The row that opened it takes focus back (it may have gone: the page then keeps the browser's default).
    const target = returnFocus.current;
    if (target?.isConnected) setTimeout(() => target.focus(), 0);
  }
  function step(delta: -1 | 1) {
    if (order.length === 0) {
      closeDrawer();
      return;
    }
    const index = openId ? order.indexOf(openId) : -1;
    const next = index < 0 ? (delta > 0 ? 0 : order.length - 1) : index + delta;
    if (next < 0 || next >= order.length) return;
    setOpenId(order[next]);
  }

  function chooseView(key: ViewKey) {
    setViewKey(key);
    if (card === "sys") setApplies("");
    setCard(null);
    setLimit(BATCH);
  }
  function toggleCard(key: CardKey) {
    const off = card === key;
    const nextView = off ? "all" : CARD_VIEW[key];
    const nextApplies: AppliesFilter = key === "sys" ? (off ? "" : "sys") : card === "sys" ? "" : applies;
    setCard(off ? null : key);
    setViewKey(nextView);
    setApplies(nextApplies);
    setLimit(BATCH);
    if (key === "missing" && !off && canEdit) {
      const first = groupRows(rows.filter((row) => matchesFilters(row, { view: nextView, query, framework, applies: nextApplies })), groupBy)[0]?.rows[0];
      if (first) openDrawer(first.controlId);
    }
  }
  function changeGroupBy(next: GroupBy) {
    setGroupBy(next);
    setCollapsed(new Set());
    setLimit(BATCH);
  }
  function toggleGroup(key: string) {
    const next = new Set(collapsed);
    if (!next.delete(key)) next.add(key);
    setCollapsed(next);
  }
  function clearFilters() {
    setViewKey("all");
    setCard(null);
    setQuery("");
    setFramework("");
    setApplies("");
    setLimit(BATCH);
  }

  /** One write. On success the row is updated from the response; in the Missing justification view the drawer moves on. Resolves to an error message or null. */
  async function saveJustification(row: SoaLedgerRow, justification: string | null): Promise<string | null> {
    let saved: { controlId: string; exclusionJustification: string | null; justificationMissing: boolean };
    try {
      const response = await fetch(`/api/statement-of-applicability/${row.controlId}/exclusion-justification`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ justification }),
      });
      if (!response.ok) return await errorOf(response, "The justification could not be saved");
      saved = await response.json();
    } catch {
      return "The justification could not be saved";
    }
    // Applied to the latest rows, not the ones captured when the request started: another save may have landed meanwhile.
    const nextRows = rowsRef.current.map((candidate) =>
      candidate.controlId === saved.controlId
        ? { ...candidate, exclusionJustification: saved.exclusionJustification, justificationMissing: saved.justificationMissing }
        : candidate,
    );
    rowsRef.current = nextRows;
    setRows(nextRows);
    const left = nextRows.filter((candidate) => candidate.justificationMissing).length;
    setNotice(
      justification === null
        ? `Justification cleared · ${left} missing`
        : left > 0
          ? `Saved · ${left} still missing`
          : "Saved · every exclusion is justified",
    );
    if (justification !== null && viewKey === "missing") {
      const next = nextMissingId(order, nextRows, row.controlId);
      if (next) setOpenId(next);
    }
    return null;
  }

  function exportView() {
    downloadCsv(viewCsv(groups.flatMap((group) => group.rows)), viewCsvFilename(new Date()));
  }

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, id: string) {
    // The row is one click target, except for its own buttons.
    if (event.target instanceof Element && event.target.closest("button, input, label, a")) return;
    openDrawer(id);
  }

  function renderRow(row: SoaLedgerRow) {
    return (
      <tr key={row.controlId} className={`sl-row${row.included ? "" : " excluded"}${openId === row.controlId ? " on" : ""}`} data-id={row.controlId} onClick={(event) => onRowClick(event, row.controlId)}>
        <td className="c-code">
          <button type="button" className="sl-open" aria-label={`Open ${row.code}`} onClick={() => openDrawer(row.controlId)}>
            <Highlight text={row.code} query={query} />
          </button>
        </td>
        <td className="c-title">
          <b>
            <Highlight text={row.title} query={query} />
          </b>
          <small>{groupBy === "domain" ? applicabilityText(row) : row.category}</small>
        </td>
        <td className="c-app">{row.included ? appliesText(row) : <span className="sl-faint">Nothing</span>}</td>
        <td className="c-inc">
          <span className={`sl-inc ${row.included ? "yes" : "no"}`}>{row.included ? "Included" : "Excluded"}</span>
        </td>
        <td className="c-just">
          {row.included ? (
            <div className="sl-reqs">
              <RequirementChips groups={row.requirements} query={query} />
            </div>
          ) : row.justificationMissing ? (
            <>
              <span className="sl-missing">No justification</span>
              {canEdit && (
                <button type="button" className="sl-write" aria-label={`Write the justification for ${row.code}`} onClick={() => openDrawer(row.controlId)}>
                  Write
                </button>
              )}
            </>
          ) : (
            <span className="sl-ex">
              <Highlight text={row.exclusionJustification ?? ""} query={query} />
            </span>
          )}
        </td>
        <td className="c-impl">
          {!row.included ? (
            <span className="sl-faint">—</span>
          ) : (
            <div className="sl-impl">
              {row.organizationStatus && (
                <span className="line">
                  <span className="k">Org</span>
                  <StatusText status={row.organizationStatus} />
                </span>
              )}
              {row.systemRollup && row.systemRollup.total > 0 && (
                <span className="line">
                  <span className="k">Sys</span>
                  <RollupBar rollup={row.systemRollup} />
                  <span className="n">
                    {row.systemRollup.counts.FULFILLED}/{row.systemRollup.total}
                  </span>
                </span>
              )}
            </div>
          )}
        </td>
      </tr>
    );
  }

  function renderBody() {
    if (listed.length === 0) {
      return (
        <tr>
          <td colSpan={6}>
            <div className="hc-done">
              <h3>No Controls match</h3>
              <p>{rows.length === 0 ? "The Control Library has no Controls yet." : "Nothing in the Statement fits this view."}</p>
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
    return (
      <>
        {drawn.parts.map((part) => {
          const figures = groupFigures(groups.find((group) => group.key === part.key)?.rows ?? []);
          return (
            <Fragment key={part.key || "all"}>
              {groupBy && (
                <tr className="sy-grp sl-grp">
                  <td colSpan={6}>
                    <button type="button" className="sl-gbtn" aria-expanded={part.expanded} onClick={() => toggleGroup(part.key)}>
                      <span className="tw" aria-hidden="true">
                        ▼
                      </span>
                      <span className="gn">
                        {part.name}
                        <small>{part.total}</small>
                      </span>
                      <span className="gm">
                        <span>{figures.included} included</span>
                        {figures.excluded > 0 && <span>{figures.excluded} excluded</span>}
                        {figures.missing > 0 && <span className="bad">{figures.missing} missing</span>}
                      </span>
                      <span className="gp" title="Average implementation progress">
                        {figures.progress === null ? (
                          <span className="sl-faint">—</span>
                        ) : (
                          <>
                            <span className="track">
                              <i style={{ width: `${Math.round(figures.progress * 100)}%` }} />
                            </span>
                            {Math.round(figures.progress * 100)}%
                          </>
                        )}
                      </span>
                    </button>
                  </td>
                </tr>
              )}
              {part.rows.map(renderRow)}
            </Fragment>
          );
        })}
        {more && (
          <tr className="sl-more">
            <td ref={moreRef} colSpan={6}>
              Showing {drawn.shown} of {drawn.openCount}
              <button type="button" className="hc-btn" onClick={() => setLimit((current) => current + BATCH)}>
                Show more
              </button>
            </td>
          </tr>
        )}
      </>
    );
  }

  const orgDone = totals.org.FULFILLED;
  const sysDone = ROLLUP_ORDER.filter(isDoneStatus).reduce((sum, status) => sum + totals.sys[status], 0);
  const excludedRows = rows.filter((row) => !row.included);
  const position = openId && order.indexOf(openId) >= 0 ? `${order.indexOf(openId) + 1} of ${order.length}` : "";

  return (
    <div className={`hc sy sl${compact ? " compact" : ""}`} data-page-id={`STATEMENT OF APPLICABILITY . ${view.roleLabel.toUpperCase()}`}>
      <section className="hc-hero" aria-labelledby="sl-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">ISO/IEC 27001:2022 · Clause 6.1.3 d</span>
          </div>
          <h1 id="sl-title">Statement of Applicability</h1>
          <p className="hc-lede">
            Every Control in the Control Library: included when it applies to the Organization or to at least one System, excluded otherwise. Derived live from the Frameworks, Systems and
            implementation statuses; only the exclusion justification is written by hand.
          </p>
          <div className="actions">
            <button type="button" className="hc-btn" onClick={exportView} disabled={listed.length === 0}>
              Download view
            </button>
            <a className="hc-btn" href="/api/statement-of-applicability/export" download>
              Download full Statement
            </a>
          </div>
        </div>
        <div className="hc-move">
          <Ring
            segments={[[totals.all === 0 ? 0 : totals.included / totals.all, "var(--rg-accent)"]]}
            size={104}
            stroke={12}
            center={`${totals.included}`}
            sub={`of ${totals.all}`}
            label={`${totals.included} of ${plural(totals.all, "Control")} included`}
          />
          <ul aria-label="Controls by inclusion">
            <li>
              <span>
                <i style={{ background: "var(--rg-accent)" }} aria-hidden="true" />
                <b>{totals.included}</b> included
              </span>
            </li>
            <li>
              <span>
                <i style={{ background: "var(--rg-line)" }} aria-hidden="true" />
                <b>{totals.excluded}</b> excluded
              </span>
            </li>
          </ul>
        </div>
      </section>

      <section className="sl-cards" aria-label="Filters">
        <button type="button" className="hc-card sl-card" aria-pressed={card === "included"} onClick={() => toggleCard("included")}>
          <span className="label">Applicability</span>
          <span className="split">
            <Ring
              segments={[[totals.all === 0 ? 0 : totals.included / totals.all, "var(--rg-accent)"]]}
              size={68}
              stroke={9}
              label={`${totals.included} of ${totals.all} included`}
            />
            <span className="stack">
              <span className="big">
                {totals.included}
                <small> / {totals.all}</small>
              </span>
              <span className="hint">Controls included · {totals.excluded} excluded</span>
            </span>
          </span>
        </button>

        <button type="button" className={`hc-card sl-card${totals.missing > 0 ? " alert" : ""}`} aria-pressed={card === "missing"} onClick={() => toggleCard("missing")}>
          <span className="label">Exclusion justifications</span>
          <span className="big">
            {totals.missing}
            <small> missing of {totals.excluded}</small>
          </span>
          <span className="sl-pips" aria-hidden="true">
            {excludedRows.map((row) => (
              <i key={row.controlId} className={row.justificationMissing ? "miss" : "done"} title={row.code} />
            ))}
          </span>
          {totals.missing > 0 ? (
            <span className="cta">{canEdit ? "Write the missing ones →" : "Show the missing ones →"}</span>
          ) : (
            <span className="hint">{totals.excluded === 0 ? "No Control is excluded" : "Every exclusion is justified"}</span>
          )}
        </button>

        <button type="button" className="hc-card sl-card" aria-pressed={card === "org"} onClick={() => toggleCard("org")}>
          <span className="label">Organization implementation</span>
          <span className="big">
            {percentText(orgDone, totals.orgTotal)}
            <small> of {totals.orgTotal} fulfilled</small>
          </span>
          <CountsBar counts={totals.org} order={ORG_ORDER} label={`Organization: ${ORG_ORDER.map((status) => `${totals.org[status]} ${CONTROL_ASSESSMENT_STATUS_LABEL[status]}`).join(", ")}`} />
          <span className="sl-legend">
            {ORG_ORDER.map((status) => (
              <span key={status}>
                <i className={`sl-dot sl-s-${status}`} aria-hidden="true" />
                <b>{totals.org[status]}</b> {CONTROL_ASSESSMENT_STATUS_LABEL[status]}
              </span>
            ))}
          </span>
        </button>

        <button type="button" className="hc-card sl-card" aria-pressed={card === "sys"} onClick={() => toggleCard("sys")}>
          <span className="label">Systems · effective statuses</span>
          <span className="big">
            {percentText(sysDone, totals.sysTotal)}
            <small> of {totals.sysTotal.toLocaleString("en")} Assessments done</small>
          </span>
          <CountsBar counts={totals.sys} order={ROLLUP_ORDER} label={`Systems: ${ROLLUP_ORDER.map((status) => `${totals.sys[status]} ${CONTROL_ASSESSMENT_STATUS_LABEL[status]}`).join(", ")}`} />
          <span className="sl-legend">
            {ROLLUP_ORDER.map((status) => (
              <span key={status}>
                <i className={`sl-dot sl-s-${status}`} aria-hidden="true" />
                <b>{totals.sys[status].toLocaleString("en")}</b> {CONTROL_ASSESSMENT_STATUS_LABEL[status]}
              </span>
            ))}
          </span>
        </button>
      </section>

      <section className="hc-card sy-reg" aria-label="Controls">
        <div className="hc-tabs" role="tablist" aria-label="Views">
          {VIEWS.map((item) => {
            const count = rows.filter(item.test).length;
            return (
              <button key={item.key} type="button" role="tab" aria-selected={viewKey === item.key} onClick={() => chooseView(item.key)}>
                {item.label}
                <span className={`n${item.bad && count > 0 ? " bad" : ""}`}>{count}</span>
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
              placeholder="Search code, title, domain, justification or Requirement"
              aria-label="Search the Statement"
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(BATCH);
              }}
            />
            <kbd className="hc-kbd" aria-hidden="true">
              /
            </kbd>
          </label>
          <label>
            <span className="sr-only">Framework</span>
            <select
              className="hc-sel"
              value={framework}
              onChange={(event) => {
                setFramework(event.target.value);
                setLimit(BATCH);
              }}
            >
              <option value="">All Frameworks</option>
              {frameworks.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Applies to</span>
            <select
              className="hc-sel"
              value={applies}
              onChange={(event) => {
                setApplies(event.target.value as AppliesFilter);
                setLimit(BATCH);
              }}
            >
              <option value="">Applies to: anything</option>
              <option value="org">Organization</option>
              <option value="sys">Systems</option>
              <option value="both">Organization and Systems</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Group by</span>
            <select className="hc-sel" value={groupBy} onChange={(event) => changeGroupBy(event.target.value as GroupBy)}>
              <option value="domain">Group: Domain</option>
              <option value="source">Group: Source</option>
              <option value="impl">Group: Implementation</option>
              <option value="">No grouping</option>
            </select>
          </label>
          <span className="sl-seg" role="group" aria-label="Density">
            <button type="button" aria-pressed={!compact} onClick={() => setCompact(false)}>
              Comfortable
            </button>
            <button type="button" aria-pressed={compact} onClick={() => setCompact(true)}>
              Compact
            </button>
          </span>
        </div>
        <div className="sl-result">
          <span role="status" aria-live="polite">
            {listed.length} of {plural(rows.length, "Control")}
            {query.trim() ? ` matching “${query.trim()}”` : ""}
          </span>
          <span>
            <button type="button" className="sl-linkbtn" onClick={() => setCollapsed(new Set())}>
              Expand all
            </button>
            {" · "}
            <button type="button" className="sl-linkbtn" disabled={!groupBy} onClick={() => setCollapsed(new Set(groups.map((group) => group.key)))}>
              Collapse all
            </button>
          </span>
        </div>
        <div className="sy-tablewrap">
          <table aria-label="Statement of Applicability">
            <thead>
              <tr>
                <th colSpan={2}>Control</th>
                <th>Applies to</th>
                <th>Included</th>
                <th>Justification</th>
                <th>Implementation</th>
              </tr>
            </thead>
            <tbody>{renderBody()}</tbody>
          </table>
        </div>
        <div className="sy-foot">
          <span>Inclusion is derived; only the exclusion justification is written by hand.</span>
          <span>
            Click a row for details · <kbd className="hc-kbd">/</kbd> search · <kbd className="hc-kbd">j</kbd> <kbd className="hc-kbd">k</kbd> next and previous · <kbd className="hc-kbd">Ctrl K</kbd> jump to a Control
          </span>
        </div>
      </section>

      {notice && (
        <p className="sl-notice" role="status">
          {notice}
        </p>
      )}

      {openRow && (
        <LedgerDrawer key={openRow.controlId} row={openRow} systems={systems} canEdit={canEdit} position={position} onClose={closeDrawer} onStep={step} onSave={saveJustification} />
      )}
    </div>
  );
}

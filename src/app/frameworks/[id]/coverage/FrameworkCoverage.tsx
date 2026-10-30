"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties, type MouseEvent } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { Icon, Ring } from "@/app/home/HomeGraphics";
import { useSearchHotkey, type PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { COVERAGE_STATE_LABEL, type CoverageState } from "@/lib/coverage-state";
import { downloadCsv } from "@/lib/download-csv";
import { frameworkLabel } from "@/lib/framework-label";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "@/app/frameworks/frameworks.css";
import "./coverage.css";
import { CoverageBar, Legend } from "@/app/frameworks/CoverageBar";
import {
  FILTERS,
  countsOf,
  coverageCsv,
  coverageCsvFilename,
  displayGroups,
  matchesFilter,
  openGapIds,
  resolvedPercent,
  sectionTab,
  sectionsOf,
  selectRows,
} from "./coverage-logic";
import type { CoverageRow, CoverageView, FilterKey } from "./coverage-types";
import { ControlChip, RequirementDrawer, type DrawerFocus, type Mutate } from "./RequirementDrawer";

const STATE_TONE: Record<CoverageState, "success" | "danger" | "warn"> = { COVERED: "success", GAP: "danger", ACCEPTED_GAP: "warn" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function errorOf(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : fallback;
}

/**
 * The Framework coverage page, design proposal A "Gap ledger" in the Home look (issue #269): a hero with the
 * resolved-coverage ring, stat cards that filter, and one card with section tabs, search, the table grouped by
 * section and the Requirement drawer. `loadCoverageView` decides who sees what; this component only filters and
 * orders what it was given, and after each write asks the server for the page again (`router.refresh()`), so the
 * counts, tabs and ring always come from the stored data.
 */
export function FrameworkCoverage({ view }: { view: CoverageView }) {
  const router = useRouter();
  const { framework, requirements: rows, canCurate, controls } = view;
  const [filter, setFilter] = useState<FilterKey>("all");
  const [section, setSection] = useState(() => (view.initialSection && rows.some((row) => row.section === view.initialSection) ? view.initialSection : "all"));
  const [query, setQuery] = useState("");
  const [gapsFirst, setGapsFirst] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [open, setOpen] = useState<{ id: string; focus: DrawerFocus } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const bulkRef = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useSearchHotkey(searchRef);

  const label = frameworkLabel(framework);
  const counts = useMemo(() => countsOf(rows), [rows]);
  const sections = useMemo(() => sectionsOf(rows), [rows]);
  const activeSection = section === "all" || sections.some((group) => group.section === section) ? section : "all";
  const listed = useMemo(() => selectRows(rows, { filter, section: activeSection, query }), [rows, filter, activeSection, query]);
  const groups = useMemo(() => displayGroups(listed, gapsFirst), [listed, gapsFirst]);
  const order = useMemo(() => groups.flatMap((group) => group.rows.map((row) => row.id)), [groups]);
  const visibleGaps = useMemo(() => (canCurate ? openGapIds(listed) : []), [listed, canCurate]);
  // Only gaps that are still open and in view count: a refresh can end a gap, a filter can hide one.
  const picked = visibleGaps.filter((id) => selected.has(id));
  const allPicked = visibleGaps.length > 0 && picked.length === visibleGaps.length;
  const openRow = open ? (rows.find((row) => row.id === open.id) ?? null) : null;
  const resolved = resolvedPercent(counts);
  const resolvedText = resolved === null ? "—" : `${resolved}%`;
  const hasFilters = filter !== "all" || query.trim() !== "" || activeSection !== "all";

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const paletteItems: PaletteItem[] = useMemo(
    () =>
      sections.flatMap((group) =>
        group.rows.map((row) => ({
          group: label,
          icon: "doc" as const,
          label: `${row.code} ${row.title}`,
          meta: COVERAGE_STATE_LABEL[row.state],
          href: `#requirement-${row.id}`,
        })),
      ),
    [sections, label],
  );
  usePagePalette({
    items: paletteItems,
    placeholder: `Jump to a Requirement of ${label}…`,
    onSelect: (item) => openDrawer(item.href.replace("#requirement-", ""), null),
  });

  /** One write; on success the page is refreshed from the server and a notice shows. Resolves to an error message or null. */
  const mutate: Mutate = async ({ path, method, body }, message) => {
    try {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) return await errorOf(response, "The change could not be saved");
    } catch {
      return "The change could not be saved";
    }
    setNotice(message);
    startTransition(() => router.refresh());
    return null;
  };

  function openDrawer(id: string, focus: DrawerFocus) {
    if (!open) returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen({ id, focus });
  }
  function closeDrawer() {
    setOpen(null);
    // The row that opened it takes focus back (it may have gone: the page then keeps the browser's default).
    const target = returnFocus.current;
    if (target?.isConnected) setTimeout(() => target.focus(), 0);
  }
  function step(delta: -1 | 1) {
    if (order.length === 0) {
      closeDrawer();
      return;
    }
    const index = open ? order.indexOf(open.id) : -1;
    const next = index < 0 ? (delta > 0 ? 0 : order.length - 1) : (index + delta + order.length) % order.length;
    setOpen({ id: order[next], focus: null });
  }

  function toggleFilter(key: FilterKey) {
    setFilter((current) => (current === key ? "all" : key));
  }
  function clearFilters() {
    setFilter("all");
    setSection("all");
    setQuery("");
  }
  function togglePick(id: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  }
  function togglePickAll(on: boolean) {
    const next = new Set(selected);
    for (const id of visibleGaps) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  }

  async function acceptPicked() {
    const justification = bulkText.trim();
    if (!justification) {
      setBulkError("A justification is required");
      bulkRef.current?.focus();
      return;
    }
    setBulkError(null);
    setBulkBusy(true);
    const failure = await mutate(
      { path: `/api/frameworks/${framework.id}/gap-acceptances`, method: "PUT", body: { requirementIds: picked, justification } },
      `${plural(picked.length, "gap")} accepted`,
    );
    setBulkBusy(false);
    if (failure) {
      setBulkError(failure);
      return;
    }
    setSelected(new Set());
    setBulkText("");
  }

  function exportCsv() {
    downloadCsv(coverageCsv(groups), coverageCsvFilename(framework, new Date()));
  }

  function onRowClick(event: MouseEvent<HTMLTableRowElement>, id: string) {
    // The row is one click target, except for its own buttons and checkbox.
    if (event.target instanceof Element && event.target.closest("button, input, label, a")) return;
    openDrawer(id, null);
  }

  function renderRow(row: CoverageRow, index: number) {
    const gap = row.state === "GAP";
    const isPicked = picked.includes(row.id);
    return (
      <tr
        key={row.id}
        className={`cv-row${isPicked ? " on" : ""}`}
        data-id={row.id}
        style={{ "--d": `${Math.min(index, 20) * 20}ms` } as CSSProperties}
        onClick={(event) => onRowClick(event, row.id)}
      >
        <td className="ck">
          {canCurate && gap && (
            <input type="checkbox" aria-label={`Select ${row.code}`} checked={isPicked} onChange={(event) => togglePick(row.id, event.target.checked)} />
          )}
        </td>
        <td className="code">
          <button type="button" className="cv-open" aria-label={`Open ${row.code}`} onClick={() => openDrawer(row.id, null)}>
            {row.code}
          </button>
        </td>
        <td className="req">
          {row.title}
          {row.state === "ACCEPTED_GAP" && row.justification && <small>“{row.justification}”</small>}
        </td>
        <td className="maps">
          {row.mappings.length > 0 ? (
            <div className="cv-ctls">
              {row.mappings.map((mapping) => (
                <ControlChip key={mapping.id} mapping={mapping} />
              ))}
            </div>
          ) : (
            <span className="cv-nomap">No Control mapped</span>
          )}
        </td>
        <td className="st">
          <StatusChip tone={STATE_TONE[row.state]}>{COVERAGE_STATE_LABEL[row.state]}</StatusChip>
        </td>
        <td className="acts">
          {canCurate &&
            (gap ? (
              <>
                <button type="button" className="hc-btn sm" aria-label={`Create Supplementary Control for ${row.code}`} onClick={() => openDrawer(row.id, "create")}>
                  Create Supplementary
                </button>{" "}
                <button type="button" className="hc-btn sm" aria-label={`Accept gap ${row.code}`} onClick={() => openDrawer(row.id, "accept")}>
                  Accept gap
                </button>
              </>
            ) : row.state === "ACCEPTED_GAP" ? (
              <button type="button" className="hc-btn sm" aria-label={`Edit justification for ${row.code}`} onClick={() => openDrawer(row.id, "accept")}>
                Edit justification
              </button>
            ) : (
              <button type="button" className="hc-btn sm" aria-label={`Mappings of ${row.code}`} onClick={() => openDrawer(row.id, "map")}>
                Mappings
              </button>
            ))}
        </td>
      </tr>
    );
  }

  function renderBody() {
    if (groups.length === 0) {
      return (
        <tr>
          <td colSpan={6}>
            <div className="hc-done">
              <h3>Nothing to show</h3>
              <p>
                {rows.length === 0
                  ? "This Framework has no Requirements yet."
                  : filter === "GAP"
                    ? "Every Requirement here is covered or accepted."
                    : "No Requirement matches this view."}
              </p>
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
    let index = 0;
    return groups.map((group) => {
      const all = countsOf(rows.filter((row) => row.section === group.section));
      return (
        <GroupRows key={group.section} section={group.section} covered={all.covered} total={all.requirements} gaps={all.gaps} bar={all}>
          {group.rows.map((row) => renderRow(row, index++))}
        </GroupRows>
      );
    });
  }

  const ringSegments: [number, string][] = [
    [counts.requirements === 0 ? 0 : counts.covered / counts.requirements, "var(--rg-success)"],
    [counts.requirements === 0 ? 0 : counts.accepted / counts.requirements, "var(--rg-gold)"],
  ];
  const legend: { key: FilterKey; swatch: string; count: number; text: string }[] = [
    { key: "COVERED", swatch: "st-covered", count: counts.covered, text: "covered" },
    { key: "ACCEPTED_GAP", swatch: "st-accepted", count: counts.accepted, text: "accepted" },
    { key: "PARTIAL", swatch: "st-partial", count: counts.partialOnly, text: "Partial only" },
    { key: "NONE", swatch: "st-none", count: counts.noMapping, text: "no mapping" },
  ];
  const statCount = (key: FilterKey) => rows.filter((row) => matchesFilter(row, key)).length;

  return (
    <div className="hc sy fc cv" data-page-id={`FRAMEWORK COVERAGE . ${view.roleLabel.toUpperCase()}`}>
      <section className="hc-hero" aria-labelledby="cv-title">
        <div>
          <Link href="/frameworks" className="cv-back">
            ← Frameworks
          </Link>
          <div className="hc-who">
            <span className="hc-eyebrow">Framework coverage</span>
          </div>
          <h1 id="cv-title">
            {framework.name}
            <code className="cv-ver">{framework.version}</code>
          </h1>
          <div className="hc-chips">
            <StatusChip tone={framework.status === "PUBLISHED" ? "success" : "warn"}>{framework.status === "PUBLISHED" ? "Published" : "Draft"}</StatusChip>
            {framework.isBase && <span className="fc-tag base">Base Framework</span>}
            {framework.strict && (
              <span className="fc-tag strict" title="Only Fulfilled counts: Waived and Not Applicable get no credit">
                Strict
              </span>
            )}
            {(framework.isBase || framework.reviewGroup) && <span className="fc-tag">{framework.isBase ? "Base Review Step" : framework.reviewGroup}</span>}
          </div>
          <p className="hc-lede">
            Which Requirements the Control Library covers, and which it doesn&apos;t. A Requirement is covered when a mapped Control gives Full coverage; Partial mappings alone leave a Coverage Gap. An
            accepted gap counts as resolved.
          </p>
          <div className="actions">
            <label className="cv-switch">
              <span className="sr-only">Framework</span>
              <select className="hc-sel" value={framework.id} onChange={(event) => router.push(`/frameworks/${event.target.value}/coverage`)}>
                {view.frameworks.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {option.status === "DRAFT" ? " (Draft)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="hc-btn" onClick={exportCsv} disabled={listed.length === 0}>
              Download CSV
            </button>
            {!canCurate && <span className="cv-note">Read-only: a Compliance Manager curates mappings and gaps.</span>}
          </div>
        </div>
        <div className="hc-move">
          <Ring
            segments={ringSegments}
            size={104}
            stroke={12}
            center={resolvedText}
            sub="resolved"
            label={`${resolvedText} of ${plural(counts.requirements, "Requirement")} are covered or accepted`}
          />
          <ul aria-label="Requirements by coverage">
            {legend.map((item) => (
              <li key={item.key}>
                <button type="button" aria-pressed={filter === item.key} onClick={() => toggleFilter(item.key)}>
                  <i className={item.swatch} aria-hidden="true" />
                  <b>{item.count}</b> {item.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="hc-stats" aria-label="Filters">
        {FILTERS.map((item) => {
          const pressed = filter === item.key;
          return (
            <button key={item.key} type="button" className={`hc-card hc-stat ${item.tone ?? ""}`} aria-pressed={pressed} onClick={() => toggleFilter(item.key)}>
              <span className="k">
                {item.label}
                <em aria-hidden="true">{pressed ? "Showing" : "Show"}</em>
              </span>
              <span className="v">{statCount(item.key)}</span>
              {item.sub && <span className="cv-sub">{item.sub}</span>}
            </button>
          );
        })}
      </section>

      <section className="hc-card sy-reg" aria-label="Requirements">
        <div className="hc-tabs" role="tablist" aria-label="Sections">
          <button type="button" role="tab" aria-selected={activeSection === "all"} onClick={() => setSection("all")}>
            All<span className="n">{rows.filter((row) => matchesFilter(row, filter)).length}</span>
          </button>
          {sections.map((group) => (
            <button key={group.section} type="button" role="tab" title={group.section} aria-selected={activeSection === group.section} onClick={() => setSection(group.section)}>
              {sectionTab(group.section)}
              <span className="n">{group.rows.filter((row) => matchesFilter(row, filter)).length}</span>
            </button>
          ))}
        </div>
        <div className="hc-tbar sy-toolbar">
          <label className="hc-search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search code, Requirement or Control"
              aria-label="Search Requirements"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd className="hc-kbd" aria-hidden="true">
              /
            </kbd>
          </label>
          <label className="cv-check">
            <input type="checkbox" checked={gapsFirst} onChange={(event) => setGapsFirst(event.target.checked)} /> Gaps first in each section
          </label>
          <span className="spacer" />
          <span className="num cv-shown" role="status">
            {listed.length} of {plural(rows.length, "Requirement")}
          </span>
        </div>
        {canCurate && picked.length > 0 && (
          <div className="cv-bulk" role="group" aria-label="Accept the selected gaps">
            <b>{plural(picked.length, "gap")} selected</b>
            <textarea
              ref={bulkRef}
              aria-label="Justification for the selected gaps"
              placeholder="One justification for all of them"
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
            />
            <button type="button" className="hc-btn primary" disabled={bulkBusy || pending} onClick={() => void acceptPicked()}>
              Accept {picked.length}
            </button>
            <button type="button" className="hc-btn" disabled={bulkBusy} onClick={() => setSelected(new Set())}>
              Clear
            </button>
            {bulkError && (
              <p role="alert" className="cv-bulk-err">
                {bulkError}
              </p>
            )}
          </div>
        )}
        <div className="sy-tablewrap">
          <table aria-label={`Requirements of ${label}`}>
            <thead>
              <tr>
                <th className="ck">
                  {visibleGaps.length > 0 && (
                    <input type="checkbox" aria-label="Select all visible gaps" checked={allPicked} onChange={(event) => togglePickAll(event.target.checked)} />
                  )}
                </th>
                <th>Code</th>
                <th>Requirement</th>
                <th>Mapped Controls</th>
                <th>State</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>{renderBody()}</tbody>
          </table>
        </div>
        <div className="sy-foot">
          <Legend />
          <span>
            Click a row for details · <kbd className="hc-kbd">/</kbd> search · <kbd className="hc-kbd">Ctrl K</kbd> jump to a Requirement
          </span>
        </div>
      </section>

      {notice && (
        <p className="fc-notice" role="status">
          {notice}
        </p>
      )}

      {openRow && (
        <RequirementDrawer
          key={openRow.id}
          row={openRow}
          framework={framework}
          canCurate={canCurate}
          controls={controls}
          rows={rows}
          focusOn={open?.focus ?? null}
          pending={pending}
          onClose={closeDrawer}
          onStep={step}
          mutate={mutate}
        />
      )}
    </div>
  );
}

function GroupRows({
  section,
  covered,
  total,
  gaps,
  bar,
  children,
}: {
  section: string;
  covered: number;
  total: number;
  gaps: number;
  bar: { requirements: number; covered: number; accepted: number; gaps: number; partialOnly: number };
  children: React.ReactNode;
}) {
  return (
    <>
      <tr className="sy-grp">
        <td colSpan={6}>
          <i aria-hidden="true" />
          {section}
          <small>
            {covered}/{total} covered{gaps > 0 ? ` · ${plural(gaps, "gap")}` : ""}
          </small>
          <CoverageBar totals={bar} thin />
        </td>
      </tr>
      {children}
    </>
  );
}

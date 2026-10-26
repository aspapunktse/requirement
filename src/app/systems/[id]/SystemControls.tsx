"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import type { AssessmentEditAccess } from "@/lib/system-permissions";
import { ControlDrawer } from "./ControlDrawer";
import {
  CONTROL_FILTERS,
  FILTER_LABEL,
  groupByCategory,
  openQueryCount,
  rowMatches,
  rowSourceKey,
  rowSourceLabel,
  rowStatus,
  showsMandatoryFlag,
  toAssessmentRow,
  toStaleRow,
  withSavedAssessment,
  type AssessmentRow,
  type ControlFilter,
  type StaleAssessmentApi,
  type UserRole,
} from "./controls-model";
import { Stack } from "./Stack";
import { currentControlCode, serverControlCode, subscribeToHash, writeHash } from "./system-hash";
import { controlHash, controlIsDone } from "./system-page-logic";
import { CONTROL_STATUS_ORDER, SOURCE_COLOR, STATUS_COLOR, STATUS_TEXT } from "./system-page-types";

/** The heading of the section that holds the stale Assessments. */
export const STALE_GROUP = "No longer applicable";

const statusParts = (rows: AssessmentRow[]) =>
  CONTROL_STATUS_ORDER.map((status) => ({ value: rows.filter((row) => rowStatus(row) === status).length, color: STATUS_COLOR[status], label: STATUS_TEXT[status] }));

function ControlRowButton({ row, onOpen }: { row: AssessmentRow; onOpen: () => void }) {
  const status = rowStatus(row);
  const openQueries = openQueryCount(row);
  return (
    <li>
      <button type="button" className="sc-crow" data-control-code={row.control.code} onClick={onOpen}>
        <code>{row.control.code}</code>
        <span className="ttl">
          {row.control.title}
          {showsMandatoryFlag(row) && <span className="flag">Mandatory</span>}
          {openQueries > 0 && (
            <span className="sc-qbadge" title={`${openQueries} open ${openQueries === 1 ? "question" : "questions"}`}>
              <span aria-hidden="true">? {openQueries}</span>
              <span className="sc-sr">
                {openQueries} open {openQueries === 1 ? "question" : "questions"}
              </span>
            </span>
          )}
        </span>
        <span className="src" style={{ "--c": SOURCE_COLOR[rowSourceKey(row)] } as CSSProperties}>
          {rowSourceLabel(row)}
        </span>
        <span className="chip">
          <StatusChip tone={controlAssessmentStatusTone(status)}>{STATUS_TEXT[status]}</StatusChip>
        </span>
      </button>
    </li>
  );
}

/**
 * The Controls tab of the System page (design proposal A "Cockpit", issue #244): a toolbar (search over code
 * and title, a segmented filter, "n of m Controls"), the Controls grouped by category with a status bar per
 * group, and the Control drawer for the one named in the URL hash (`#controls/A.5.13`).
 *
 * It reads the rows from `GET /api/systems/[id]/assessments`, the same route the old list used, and the
 * drawer changes them through the same routes. The page remounts it (a `key`) when a Provider dependency
 * is declared or removed, which reloads what the System inherits.
 */
export function SystemControls({
  systemId,
  userRole,
  currentUserId,
  systemOwnerId,
  readOnly = false,
  assessmentEditAccess = "full",
}: {
  systemId: string;
  userRole: UserRole;
  currentUserId: string;
  systemOwnerId: string;
  /** Show Assessments and Assessment Queries without any way to change them — for a role that may read Systems but not write them (#71). */
  readOnly?: boolean;
  /** How far the user's right to edit Assessments / answer Self-Assessment Questions reaches (#78): "waive-only" offers just Waived / Not Applicable / N/A, "none" hides every edit control but keeps Assessment Queries. */
  assessmentEditAccess?: AssessmentEditAccess;
}) {
  const router = useRouter();
  const editAccess: AssessmentEditAccess = readOnly ? "none" : assessmentEditAccess;
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [staleRows, setStaleRows] = useState<AssessmentRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ControlFilter>("all");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openCode = useSyncExternalStore(subscribeToHash, currentControlCode, serverControlCode);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/systems/${systemId}/assessments`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load Controls");
        return response.json();
      })
      .then((body) => {
        if (cancelled) return;
        setRows((body.assessments ?? []).map(toAssessmentRow));
        setStaleRows((body.staleAssessments ?? []).map((assessment: StaleAssessmentApi) => toStaleRow(assessment)));
      })
      .catch(() => {
        if (!cancelled) setLoadError("Failed to load the Controls");
      });
    return () => {
      cancelled = true;
    };
  }, [systemId, attempt]);

  // "/" jumps to the search field from anywhere on the page (switching to this tab first), unless the user is typing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      writeHash("#controls");
      // The tab becomes visible in the update the hash change causes; focus once it has.
      setTimeout(() => searchRef.current?.focus(), 0);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Closing the drawer gives focus back to the row that opened it.
  const previousCode = useRef<string | null>(null);
  useEffect(() => {
    const closed = previousCode.current;
    previousCode.current = openCode;
    if (!closed || openCode) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-control-code]") ?? [])].find((element) => element.dataset.controlCode === closed);
    row?.focus();
  }, [openCode]);

  const openRow = useMemo(() => {
    if (!openCode) return null;
    const applicable = rows?.find((row) => row.control.code === openCode);
    if (applicable) return { row: applicable, stale: false };
    const stale = staleRows.find((row) => row.control.code === openCode);
    return stale ? { row: stale, stale: true } : null;
  }, [openCode, rows, staleRows]);

  const closeDrawer = () => writeHash("#controls");
  const openDrawer = (code: string) => writeHash(controlHash(code));

  /** After a change: the header and the Overview are read on the server, so read them again. */
  const changed = () => router.refresh();

  function updateRow(controlId: string, update: (row: AssessmentRow) => AssessmentRow, stale: boolean) {
    const apply = (list: AssessmentRow[]) => list.map((row) => (row.control.id === controlId ? update(row) : row));
    if (stale) setStaleRows(apply);
    else setRows((previous) => apply(previous ?? []));
  }

  if (loadError) {
    return (
      <div role="alert" className="sc-ctl-empty">
        <p>{loadError}</p>
        <button
          type="button"
          className="hc-btn"
          onClick={() => {
            setLoadError(null);
            setRows(null);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (rows === null) return <p role="status">Loading Controls…</p>;

  const matching = rows.filter((row) => rowMatches(row, filter, query));
  const groups = groupByCategory(rows);
  const filtering = filter !== "all" || query.trim() !== "";

  const drawer = openRow && (
    <ControlDrawer
      key={openRow.row.control.id}
      row={openRow.row}
      stale={openRow.stale}
      systemId={systemId}
      userRole={userRole}
      currentUserId={currentUserId}
      systemOwnerId={systemOwnerId}
      readOnly={readOnly}
      editAccess={editAccess}
      onClose={closeDrawer}
      onSaved={(assessment) => {
        updateRow(openRow.row.control.id, (row) => (openRow.stale ? { ...row, assessment } : withSavedAssessment(row, assessment)), openRow.stale);
        changed();
      }}
      onQueriesChanged={(queries) => {
        updateRow(openRow.row.control.id, (row) => ({ ...row, queries }), openRow.stale);
        changed();
      }}
      onReset={(reset) => {
        updateRow(openRow.row.control.id, () => toAssessmentRow(reset), false);
        changed();
      }}
      onRemoved={() => {
        setStaleRows((previous) => previous.filter((row) => row.control.id !== openRow.row.control.id));
        closeDrawer();
        changed();
      }}
    />
  );

  return (
    <div className="sc-ctl" ref={listRef}>
      <div className="sc-ctl-bar">
        <label className="hc-search">
          <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 4 4" />
          </svg>
          <input ref={searchRef} type="search" placeholder="Search code or title" aria-label="Search Controls" value={query} onChange={(event) => setQuery(event.target.value)} />
          <span className="hc-kbd" aria-hidden="true">
            /
          </span>
        </label>
        <div className="sc-seg" role="group" aria-label="Show">
          {CONTROL_FILTERS.map((key) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {FILTER_LABEL[key]}
            </button>
          ))}
        </div>
        <span className="sc-ctl-count" role="status">
          {matching.length} of {rows.length} Controls
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="sc-ctl-empty">No Controls apply to this System.</p>
      ) : matching.length === 0 ? (
        <div className="sc-ctl-empty">
          <p>No Controls match.</p>
          {filtering && (
            <button
              type="button"
              className="hc-btn"
              onClick={() => {
                setQuery("");
                setFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        groups.map((group) => {
          const shown = group.rows.filter((row) => rowMatches(row, filter, query));
          if (shown.length === 0) return null;
          const open = !collapsed.has(group.category);
          const done = group.rows.filter((row) => controlIsDone(rowStatus(row))).length;
          return (
            <section key={group.category} className="sc-theme" aria-label={group.category}>
              <button
                type="button"
                className="sc-theme-h"
                aria-expanded={open}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(group.category)) next.delete(group.category);
                    else next.add(group.category);
                    return next;
                  })
                }
              >
                <span className="chev" aria-hidden="true">
                  ▸
                </span>
                <b>{group.category}</b>
                <span className="stack">
                  <Stack parts={statusParts(group.rows)} height={6} label={`${group.category}: ${CONTROL_STATUS_ORDER.map((status) => `${group.rows.filter((row) => rowStatus(row) === status).length} ${STATUS_TEXT[status]}`).join(", ")}`} />
                </span>
                <span className="num" title="Done: Fulfilled, Waived or Not applicable">
                  {done}/{group.rows.length}
                </span>
              </button>
              {open && (
                <ul className="sc-crows">
                  {shown.map((row) => (
                    <ControlRowButton key={row.control.id} row={row} onOpen={() => openDrawer(row.control.code)} />
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}

      {staleRows.length > 0 && (
        <section className="sc-theme" aria-label={STALE_GROUP}>
          <h3 className="sc-theme-h static">
            <b>{STALE_GROUP}</b>
            <span className="num">{staleRows.length}</span>
          </h3>
          <ul className="sc-crows">
            {staleRows.map((row) => (
              <ControlRowButton key={row.control.id} row={row} onOpen={() => openDrawer(row.control.code)} />
            ))}
          </ul>
        </section>
      )}

      {openCode && !openRow && (
        <p role="status" className="sc-ctl-note">
          No Control {openCode} applies to this System.
        </p>
      )}

      {drawer}
    </div>
  );
}

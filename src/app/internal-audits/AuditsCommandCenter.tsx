"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import "@/app/home/home.css";
import "./audits-list.css";
import { Icon, Ring } from "@/app/home/HomeGraphics";
import { useSearchHotkey, type PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { StatusChip } from "@/components/ui/StatusChip";
import { CHECK_UP_STATE_LABEL, isReadyToClose, type CheckUpStateCounts } from "@/lib/check-up-states";
import type { InternalAuditList, InternalAuditListItem } from "@/lib/internal-audit-list";
import { INTERNAL_AUDIT_STATUS_LABEL } from "@/lib/internal-audit-rules";
import { internalAuditStatusTone } from "@/lib/status-tones";
import { BAR_STATES, plural, STATE_COLOR, STATE_LEGEND } from "./check-up-state-view";
import { dueLine, matchesFilter, matchesQuery, statCounts, type AuditFilter } from "./audits-list-logic";

const LANES = [
  { status: "LAUNCHED", title: "Launched", color: "var(--rg-success)", note: "soonest due first" },
  { status: "DRAFT", title: "Drafts", color: "var(--rg-muted)", note: "nothing sent yet" },
  { status: "CLOSED", title: "Closed", color: "var(--rg-waived)", note: "newest first, read-only" },
] as const;

function ProgressBar({ progress }: { progress: CheckUpStateCounts }) {
  const total = Math.max(1, progress.total);
  return (
    <div
      className="ia-bar"
      role="img"
      aria-label={`${progress.evaluated} evaluated, ${progress.withdrawn} withdrawn, ${progress.awaiting} awaiting evaluation, ${progress.overdue} overdue of ${progress.total} Check-ups`}
    >
      {BAR_STATES.map((state) => (
        <i key={state} style={{ width: `${(progress[state] / total) * 100}%`, background: STATE_COLOR[state] }} />
      ))}
    </div>
  );
}

function AuditCard({ audit }: { audit: InternalAuditListItem }) {
  const due = dueLine(audit.daysUntilDue);
  const progress = audit.progress;
  return (
    <Link className="hc-card ia-card" href={`/internal-audits/${audit.id}`}>
      <div className="ia-top">
        <h3>{audit.title}</h3>
        <StatusChip tone={internalAuditStatusTone(audit.status)}>{INTERNAL_AUDIT_STATUS_LABEL[audit.status]}</StatusChip>
      </div>
      <p className={`ia-scope${audit.scopeDescription.trim() ? "" : " none"}`}>{audit.scopeDescription.trim() || "No scope description"}</p>
      {progress && (
        <>
          <ProgressBar progress={progress} />
          <div className="ia-meta">
            <span>
              <b>{progress.evaluated}</b> of {progress.total} evaluated
            </span>
            <span>
              <b>{progress.awaiting}</b> awaiting evaluation
            </span>
            {progress.overdue > 0 && (
              <span className="bad">
                <b>{progress.overdue}</b> overdue
              </span>
            )}
          </div>
          <div className="ia-foot">
            <span className={`ia-due${due.urgency ? ` ${due.urgency}` : ""}`}>{due.text}</span>
            {isReadyToClose(progress) ? <span className="ia-ready">Ready to close</span> : <span className="ia-muted">{progress.open} open</span>}
          </div>
        </>
      )}
      {audit.status === "DRAFT" && audit.plan && (
        <>
          <div className="ia-meta">
            <span>
              <b>{audit.controlCount}</b> {audit.controlCount === 1 ? "Control" : "Controls"}
            </span>
            <span>
              <b>{audit.systemCount}</b> {audit.systemCount === 1 ? "System" : "Systems"}
              {audit.includeOrganization ? " + Organization" : ""}
            </span>
            <span>
              would send <b>{audit.plan.checkUpCount}</b> {audit.plan.checkUpCount === 1 ? "Check-up" : "Check-ups"}
            </span>
          </div>
          <div className="ia-foot">
            <span className="ia-muted">Due {audit.dueDate}</span>
            {audit.plan.firstBlocker ? <StatusChip tone="warn">{audit.plan.firstBlocker}</StatusChip> : <span className="ia-ready">Ready to launch</span>}
          </div>
        </>
      )}
      {audit.status === "CLOSED" && audit.findings && (
        <>
          <div className="ia-find">
            <StatusChip tone="success">{audit.findings.CONFORMING} Conforming</StatusChip>
            <StatusChip tone="warn">{audit.findings.OBSERVATION} Observation</StatusChip>
            <StatusChip tone="danger">{audit.findings.NONCONFORMITY} Nonconformity</StatusChip>
          </div>
          <div className="ia-foot">
            <span className="ia-muted">
              Closed {audit.closedAt}
              {audit.closedBy ? ` by ${audit.closedBy}` : ""}
            </span>
            <span className="ia-muted">{plural(audit.findings.risksOpened, "Risk")} opened</span>
          </div>
        </>
      )}
    </Link>
  );
}

/**
 * The Internal Audits list, design proposal A "Command center" in the Home look (#398): a hero with a ring of
 * every Check-up in the launched audits by state, stat cards that filter, a search, and a lane per status of audit
 * cards. The data is read on the server (`loadInternalAuditList`); this component only filters and lays it out.
 */
export function AuditsCommandCenter({ list, canWrite, canReadPacks = false }: { list: InternalAuditList; canWrite: boolean; canReadPacks?: boolean }) {
  const [filter, setFilter] = useState<AuditFilter | null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchHotkey(searchRef);

  const paletteItems: PaletteItem[] = useMemo(
    () => [
      ...(canWrite ? [{ group: "Actions", icon: "plus" as const, label: "New Internal Audit", meta: "plan a draft", href: "/internal-audits/new" }] : []),
      ...(canReadPacks ? [{ group: "Pages", icon: "layers" as const, label: "Control Packs", meta: "named sets of Controls for planning", href: "/internal-audits/control-packs" }] : []),
      ...list.audits.map((audit) => ({ group: "Internal Audits", icon: "audit" as const, label: audit.title, meta: INTERNAL_AUDIT_STATUS_LABEL[audit.status], href: `/internal-audits/${audit.id}` })),
    ],
    [list.audits, canWrite, canReadPacks],
  );
  usePagePalette({ items: paletteItems, placeholder: "Jump to an Internal Audit…" });

  const totals = list.totals;
  const counts = statCounts(list);
  const shown = list.audits.filter((audit) => matchesFilter(audit, filter) && matchesQuery(audit, query));
  const total = Math.max(1, totals.total);

  const toggle = (next: AuditFilter) => setFilter((current) => (current === next ? null : next));
  const stat = (key: AuditFilter, label: string, value: number, tone?: "ok" | "warn" | "danger") => (
    <button type="button" className={`hc-card hc-stat ${tone ?? ""}`} aria-pressed={filter === key} onClick={() => toggle(key)}>
      <span className="k">
        {label}
        <em aria-hidden="true">{filter === key ? "On ✕" : "Filter →"}</em>
      </span>
      <span className="v">{value}</span>
    </button>
  );
  return (
    <div className="hc ia" data-page-id="INTERNAL AUDITS">
      <section className="hc-hero" aria-labelledby="ia-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Assurance</span>
          </div>
          <h1 id="ia-title">Internal Audits</h1>
          <p className="hc-lede">
            Verify that Controls work: an Internal Auditor plans an audit as a draft, launches it to send the Check-ups, evaluates the answers and closes it.
          </p>
          <div className="hc-chips">
            {canWrite ? (
              <Link href="/internal-audits/new" className="hc-btn primary">
                + New Internal Audit
              </Link>
            ) : (
              <span className="ia-note">You can read Internal Audits; only an Internal Auditor plans and runs them.</span>
            )}
            {canReadPacks && (
              <Link href="/internal-audits/control-packs" className="hc-btn">
                Control Packs
              </Link>
            )}
          </div>
        </div>
        <div className="hc-move">
          <Ring
            segments={BAR_STATES.map((state): [number, string] => [totals[state] / total, STATE_COLOR[state]])}
            size={92}
            stroke={10}
            center={String(totals.open)}
            sub="open"
            label={`${totals.open} of ${totals.total} Check-ups in launched audits are open`}
          />
          <ul aria-label="Check-ups in launched audits by state">
            {STATE_LEGEND.map(({ state, label }) => (
              <li key={state}>
                <i style={{ background: STATE_COLOR[state] }} aria-hidden="true" />
                <b>{totals[state]}</b> {label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="hc-stats" aria-label="Filter the audits">
        {stat("LAUNCHED", "Launched", counts.launched, "ok")}
        {stat("awaiting", CHECK_UP_STATE_LABEL.awaiting, counts.awaiting, "warn")}
        {stat("overdue", "Overdue Check-ups", counts.overdue, "danger")}
        {stat("DRAFT", "Drafts", counts.drafts)}
        {stat("CLOSED", "Closed", counts.closed)}
      </section>

      <div className="ia-tools">
        <label className="hc-search">
          <Icon name="search" size={15} />
          <input
            ref={searchRef}
            type="search"
            placeholder="Search audits by title or scope"
            aria-label="Search audits"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd className="hc-kbd" aria-hidden="true">
            /
          </kbd>
        </label>
        {filter && (
          <button type="button" className="hc-btn" onClick={() => setFilter(null)}>
            Clear filter
          </button>
        )}
      </div>

      <div className="ia-lanes">
        {list.audits.length === 0 ? (
          <section className="hc-card ia-empty">
            <div className="hc-done">
              <h3>There are no Internal Audits yet</h3>
              <p>{canWrite ? "Plan the first one: pick the Controls to verify and where, and launch it when it is ready." : "An Internal Auditor plans the first one."}</p>
              {canWrite && (
                <Link href="/internal-audits/new" className="hc-btn primary">
                  + New Internal Audit
                </Link>
              )}
            </div>
          </section>
        ) : shown.length === 0 ? (
          <section className="hc-card ia-empty">
            <div className="hc-done">
              <h3>No audit matches</h3>
              <p>Nothing fits the filter and the search. Clear one, or start over.</p>
              <button
                type="button"
                className="hc-btn"
                onClick={() => {
                  setFilter(null);
                  setQuery("");
                }}
              >
                Clear filter and search
              </button>
            </div>
          </section>
        ) : (
          LANES.map((lane) => {
            const audits = shown.filter((audit) => audit.status === lane.status);
            if (audits.length === 0) return null;
            return (
              <section key={lane.status} className="ia-lane" aria-label={lane.title}>
                <h2>
                  <i style={{ background: lane.color }} aria-hidden="true" />
                  {lane.title} <span className="n">{audits.length}</span>
                  <small>{lane.note}</small>
                </h2>
                <div className="ia-grid">
                  {audits.map((audit) => (
                    <AuditCard key={audit.id} audit={audit} />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import "@/app/home/home.css";
import "../audits-list.css";
import "./audit-detail.css";
import { Ring } from "@/app/home/HomeGraphics";
import type { PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { StatusChip } from "@/components/ui/StatusChip";
import { CHECK_UP_STATE_LABEL, isReadyToClose, type CheckUpStateKey } from "@/lib/check-up-states";
import {
  AUDIT_GROUPINGS,
  answerSummary,
  groupCheckUps,
  matchesStateFilter,
  pickedCheckUp,
  type AuditGrouping,
} from "@/lib/internal-audit-detail-rules";
import type { AuditCheckUp, InternalAuditPage } from "@/lib/internal-audit-detail";
import { plural, BAR_STATES, STATE_COLOR, STATE_LEGEND } from "../check-up-state-view";
import { AuditHero } from "./AuditHero";
import { CloseAuditButton } from "./AuditActions";
import { CheckUpPanel } from "./CheckUpPanel";
import { checkUpStateChip } from "./check-up-state-chip";

/** What the user may do here, decided on the server from the role (the routes decide again). */
export type AuditRights = { canEvaluate: boolean; canWithdraw: boolean; canClose: boolean };

const STAT_CARDS: { state: CheckUpStateKey; label: string; tone?: "ok" | "warn" | "danger" }[] = [
  { state: "notAnswered", label: "Not answered" },
  { state: "awaiting", label: CHECK_UP_STATE_LABEL.awaiting, tone: "warn" },
  { state: "overdue", label: "Overdue", tone: "danger" },
  { state: "evaluated", label: "Evaluated", tone: "ok" },
  { state: "withdrawn", label: "Withdrawn" },
];

const day = (iso: string) => iso.slice(0, 10);

function rowText(checkUp: AuditCheckUp, by: AuditGrouping): string {
  const target = checkUp.target.kind === "system" ? checkUp.target.name : "Organization";
  switch (by) {
    case "control":
      return `${target} · ${checkUp.recipient ? checkUp.recipient.name : "no recipient"}`;
    case "system":
      return `${checkUp.control.code} ${checkUp.control.title}`;
    case "recipient":
      return `${checkUp.control.code} · ${target}`;
  }
}

function answeredLine(checkUp: AuditCheckUp): string | null {
  if (!checkUp.response) return null;
  const summary = answerSummary(checkUp.questions.flatMap((question) => (question.answer ? [question.answer.answer] : [])));
  return `Answered${summary ? ` ${summary}` : ""} · ${day(checkUp.response.respondedAt)}`;
}

/**
 * One launched or closed Internal Audit, design proposal A "Command center" in the Home look (#399): a hero with a
 * ring of the Check-ups by state, a banner that says whether the audit can be closed (or its findings, once closed),
 * stat cards that filter, the Check-ups grouped by Control, System or recipient, and a panel beside them with the
 * picked Check-up in full, where a role that may evaluates or withdraws it. All the data arrives from the server
 * (`loadInternalAuditPage`); a write refreshes the page, so the ring, stats and banner follow without a navigation.
 * The state of a Check-up is never decided here.
 */
export function AuditCommandCenter({ page, rights }: { page: InternalAuditPage; rights: AuditRights }) {
  const { audit, counts, checkUps, findings } = page;
  const [filter, setFilter] = useState<CheckUpStateKey | null>(null);
  const [by, setBy] = useState<AuditGrouping>("control");
  const [pickedId, setPickedId] = useState<string | null>(null);

  const shown = useMemo(() => checkUps.filter((checkUp) => matchesStateFilter(checkUp, filter)), [checkUps, filter]);
  const groupsByTab = useMemo(
    () => Object.fromEntries(AUDIT_GROUPINGS.map(({ key }) => [key, groupCheckUps(shown, key)])) as Record<AuditGrouping, ReturnType<typeof groupCheckUps<AuditCheckUp>>>,
    [shown],
  );
  const groups = groupsByTab[by];
  const inListOrder = useMemo(() => groups.flatMap((group) => group.checkUps), [groups]);
  const picked = pickedCheckUp(checkUps, inListOrder, pickedId);

  const paletteItems: PaletteItem[] = useMemo(
    () =>
      checkUps.map((checkUp) => ({
        group: "Check-ups",
        icon: "checkup" as const,
        label: `${checkUp.control.code} · ${checkUp.target.kind === "system" ? checkUp.target.name : "Organization"}`,
        meta: checkUpStateChip(checkUp).label,
        href: `#check-up-${checkUp.id}`,
      })),
    [checkUps],
  );
  const registration = useMemo(
    () => ({
      items: paletteItems,
      placeholder: "Jump to a Check-up…",
      onSelect: (item: PaletteItem) => setPickedId(item.href.replace("#check-up-", "")),
    }),
    [paletteItems],
  );
  usePagePalette(registration);

  const total = Math.max(1, counts.total);
  const launched = audit.status === "LAUNCHED";
  const canAct = launched && (rights.canEvaluate || rights.canWithdraw);
  const toggle = (state: CheckUpStateKey) => setFilter((current) => (current === state ? null : state));

  return (
    <div className="hc ad" data-page-id="INTERNAL AUDIT">
      <AuditHero
        audit={audit}
        daysUntilDue={page.daysUntilDue}
        aside={
          <div className="hc-move">
            <Ring
              segments={BAR_STATES.map((state): [number, string] => [counts[state] / total, STATE_COLOR[state]])}
              size={92}
              stroke={10}
              center={String(counts.open)}
              sub="open"
              label={`${counts.open} of ${counts.total} Check-ups are open`}
            />
            <ul aria-label="Check-ups by state">
              {STATE_LEGEND.map(({ state, label }) => (
                <li key={state}>
                  <i style={{ background: STATE_COLOR[state] }} aria-hidden="true" />
                  <b>{counts[state]}</b> {label}
                </li>
              ))}
            </ul>
          </div>
        }
      />

      {launched && (
        <section className={`ad-banner ${isReadyToClose(counts) ? "ok" : ""}`} aria-label="Close this Internal Audit">
          <div>
            {isReadyToClose(counts) ? (
              <>
                <b>Ready to close</b>
                <span> Every Check-up is evaluated or withdrawn.{rights.canClose ? " Close the audit to make it read-only." : " An Internal Auditor can close it."}</span>
              </>
            ) : (
              <>
                <b>{plural(counts.open, "Check-up")}</b>
                <span> {counts.open === 1 ? "is" : "are"} neither evaluated nor withdrawn, so the audit can&apos;t be closed yet.</span>
              </>
            )}
          </div>
          {rights.canClose && <CloseAuditButton internalAuditId={audit.id} title={audit.title} openCount={counts.open} />}
        </section>
      )}

      {audit.status === "CLOSED" && findings && (
        <section className="hc-card" aria-label="Findings">
          <div className="hc-card-h">
            <h2>Findings</h2>
            <p>kept as they were when the audit closed{audit.closedAt ? `, ${day(audit.closedAt)}` : ""}</p>
          </div>
          <div className="hc-card-b ad-findings">
            <div className="hc-stat hc-card ok">
              <span className="k">Conforming</span>
              <span className="v">{findings.CONFORMING}</span>
            </div>
            <div className="hc-stat hc-card warn">
              <span className="k">Observation</span>
              <span className="v">{findings.OBSERVATION}</span>
            </div>
            <div className="hc-stat hc-card danger">
              <span className="k">Nonconformity</span>
              <span className="v">{findings.NONCONFORMITY}</span>
            </div>
            <div className="hc-stat hc-card">
              <span className="k">Risks opened</span>
              <span className="v">{findings.risksOpened}</span>
            </div>
          </div>
        </section>
      )}

      <section className="hc-stats" aria-label="Filter the Check-ups">
        {STAT_CARDS.map(({ state, label, tone }) => (
          <button key={state} type="button" className={`hc-card hc-stat ${tone ?? ""}`} aria-pressed={filter === state} onClick={() => toggle(state)}>
            <span className="k">
              {label}
              <em aria-hidden="true">{filter === state ? "On ✕" : "Filter →"}</em>
            </span>
            <span className="v">{counts[state]}</span>
          </button>
        ))}
      </section>

      <div className="ad-grid">
        <section className="hc-card ad-list" aria-label="Check-ups">
          <div className="hc-card-h">
            <div>
              <h2>Check-ups</h2>
              <p className="ad-count">
                {shown.length} of {counts.total}
                {filter ? ` · ${STAT_CARDS.find((card) => card.state === filter)!.label}` : ""}
              </p>
            </div>
            {filter && (
              <button type="button" className="hc-btn" onClick={() => setFilter(null)}>
                Clear filter
              </button>
            )}
          </div>
          <div className="hc-tabs" role="tablist">
            {AUDIT_GROUPINGS.map(({ key, label }) => (
              <button key={key} type="button" role="tab" aria-selected={by === key} onClick={() => setBy(key)}>
                {label}
                <span className="n">{groupsByTab[key].length}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="hc-done">
              <h3>{checkUps.length === 0 ? "No Check-ups" : "No Check-up matches"}</h3>
              <p>{checkUps.length === 0 ? "This audit has no Check-ups." : "Clear the filter to see them all."}</p>
              {filter && (
                <button type="button" className="hc-btn" onClick={() => setFilter(null)}>
                  Clear filter
                </button>
              )}
            </div>
          ) : (
            groups.map((group) => (
              <div key={group.key} className="ad-group" role="group" aria-label={group.title}>
                <h3>
                  {group.control ? (
                    <>
                      <span className="ad-code">{group.control.code}</span> {group.control.title}
                    </>
                  ) : (
                    group.title
                  )}
                  <small>
                    {group.done} of {group.total} done
                  </small>
                </h3>
                {group.checkUps.map((checkUp) => {
                  const chip = checkUpStateChip(checkUp);
                  const answered = answeredLine(checkUp);
                  return (
                    <button
                      key={checkUp.id}
                      type="button"
                      className="ad-cu"
                      aria-current={picked?.id === checkUp.id}
                      onClick={() => setPickedId(checkUp.id)}
                    >
                      <i className="ad-dot" style={{ background: STATE_COLOR[checkUp.state] }} aria-hidden="true" />
                      <span>
                        {rowText(checkUp, by)}
                        {answered && <small>{answered}</small>}
                      </span>
                      <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </section>

        <aside className="hc-card ad-aside" aria-label="Check-up">
          <div className="hc-card-h">
            <h2>Check-up</h2>
            <p>{!launched ? "read-only" : canAct ? "evaluate or withdraw it here" : "read only for your role"}</p>
          </div>
          <div className="hc-card-b">
            {picked ? (
              <CheckUpPanel checkUp={picked} auditStatus={audit.status} canEvaluate={rights.canEvaluate} canWithdraw={rights.canWithdraw} />
            ) : (
              <p className="hc-empty">Pick a Check-up.</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

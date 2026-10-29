"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { ChangeOwnerDialog } from "@/components/ChangeOwnerDialog";
import { compliancePercentage, formatCompliancePercentage } from "@/lib/requirement-status-rules";
import { onboardingStatusTone } from "@/lib/status-tones";
import { ago, initialsOf } from "@/app/home/home-format";
import { Ring } from "@/app/home/HomeGraphics";
import type { PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import type { HomeIconKey } from "@/app/home/home-types";
import { roleLabel } from "@/app/home/role-label";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./system-cockpit.css";
import { CiaBars } from "@/app/systems/CiaBars";
import { IMPACT_LABEL, IMPACT_RANK, STATUS_LABEL } from "@/app/systems/systems-types";
import { DecisionDialog } from "./DecisionDialog";
import { RiskGrid } from "./RiskGrid";
import { Stack } from "./Stack";
import { currentTab, serverTab, subscribeToHash, writeHash } from "./system-hash";
import { controlHash, formatDay, lifecycleStages } from "./system-page-logic";
import {
  CONTROL_STATUS_ORDER,
  SOURCE_KEYS,
  SOURCE_COLOR,
  SOURCE_LABEL,
  STATUS_COLOR,
  STATUS_TEXT,
  TAB_KEYS,
  TAB_LABEL,
  type FrameworkSummary,
  type SystemPageView,
  type TabKey,
} from "./system-page-types";

const DAY_MS = 86_400_000;
/** The Needs attention tile shows this many items before "N more →". */
export const ATTENTION_SHOWN = 6;

const TAB_ICON: Record<TabKey, HomeIconKey> = {
  overview: "grid",
  controls: "control",
  requirements: "layers",
  risks: "risk",
  providers: "building",
  profile: "system",
  activity: "bolt",
};

const ACTIVITY_COLOR = { ok: "var(--rg-success)", warn: "var(--rg-gold)", danger: "var(--rg-danger)", accent: "var(--rg-accent)" };
const prefersReducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const frameworkParts = (framework: FrameworkSummary) => [
  { value: framework.met, color: "var(--rg-success)", label: "Met" },
  { value: framework.partial, color: "var(--rg-gold)", label: "Partially met" },
  { value: framework.notMet, color: "var(--rg-danger)", label: "Not met" },
];

export function SystemCockpit({ view, panels }: { view: SystemPageView; panels: Record<Exclude<TabKey, "overview">, ReactNode> }) {
  const router = useRouter();
  const { system, headline, controls, risks, classification, counts } = view;
  const tab = useSyncExternalStore(subscribeToHash, currentTab, serverTab);
  const [frameworkId, setFrameworkId] = useState<string | null>(null);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [deciding, setDeciding] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [changingOwner, setChangingOwner] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Bumped after a header action, so the mounted (but hidden) Approval panel is read again.
  const [approvalVersion, setApprovalVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const now = Date.parse(view.now);
  const mine = system.ownerId === view.userId;
  const framework = view.frameworks.find((candidate) => candidate.id === frameworkId) ?? view.frameworks[0] ?? null;
  const requirementsMet = compliancePercentage({ MET: headline.met, applicable: headline.applicable });

  /** Go to a hash: a tab (`#controls`) or a Control's drawer (`#controls/A.5.13`). */
  function goHash(hash: string, options: { scroll?: boolean } = {}) {
    writeHash(hash);
    if (options.scroll) tabsRef.current?.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }
  const goTab = (key: TabKey, options: { scroll?: boolean } = {}) => goHash(`#${key}`, options);

  // Coming back to the Overview shows what was changed on another tab: the tiles are read on the server.
  const previousTab = useRef(tab);
  useEffect(() => {
    if (tab === "overview" && previousTab.current !== "overview") router.refresh();
    previousTab.current = tab;
  }, [tab, router]);

  // The sliding indicator sits under the selected tab; it is moved directly, not through state.
  useLayoutEffect(() => {
    const place = () => {
      const selected = tabsRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      const indicator = indicatorRef.current;
      if (!selected || !indicator) return;
      indicator.style.width = `${selected.offsetWidth}px`;
      indicator.style.transform = `translateX(${selected.offsetLeft}px)`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [tab, counts.openRisks]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = TAB_KEYS.indexOf(tab);
    const last = TAB_KEYS.length - 1;
    const target = event.key === "ArrowRight" ? (index + 1) % TAB_KEYS.length : event.key === "ArrowLeft" ? (index + last) % TAB_KEYS.length : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    if (target < 0) return;
    event.preventDefault();
    goTab(TAB_KEYS[target]);
    document.getElementById(`sc-tab-${TAB_KEYS[target]}`)?.focus();
  }

  async function post(path: "submit" | "onboard", failure: string) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${system.id}/${path}`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? failure);
        return;
      }
      setApprovalVersion((version) => version + 1);
      router.refresh();
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const paletteItems: PaletteItem[] = useMemo(
    () => [
      ...TAB_KEYS.map((key): PaletteItem => ({
        group: "Tabs",
        icon: TAB_ICON[key],
        label: TAB_LABEL[key],
        meta: key === "controls" ? `${counts.controls}` : key === "requirements" ? `${counts.requirements}` : key === "risks" ? `${counts.openRisks} open` : key === "providers" ? `${counts.providers}` : "",
        href: `#${key}`,
      })),
      ...view.controlList.map((control): PaletteItem => ({ group: "Controls", icon: "control", label: control.title, meta: control.code, href: controlHash(control.code) })),
    ],
    [counts, view.controlList],
  );
  usePagePalette({ items: paletteItems, onSelect: (item) => goHash(item.href, { scroll: true }), placeholder: "Jump to a tab or a Control…" });

  const stages = lifecycleStages(system.status);
  const next = view.nextStep;
  const attention = showAllAttention ? view.attention : view.attention.slice(0, ATTENTION_SHOWN);
  const hiddenAttention = view.attention.length - ATTENTION_SHOWN;
  const tabCount: Partial<Record<TabKey, { n: number; hot?: boolean }>> = {
    controls: { n: counts.controls },
    requirements: { n: counts.requirements },
    risks: { n: counts.openRisks, hot: counts.openRisks > 0 },
    providers: { n: counts.providers },
  };

  return (
    <div className="hc sc" data-page-id={`SYSTEM . ${roleLabel(view.role).toUpperCase()}`}>
      <div className="sc-crumbrow">
        <nav aria-label="Breadcrumb" className="sc-crumbs">
          <Link href="/systems">Systems</Link>
          <span aria-hidden="true"> / </span>
          <span aria-current="page">{system.name}</span>
        </nav>
        <p className="sc-hint">
          <kbd className="hc-kbd">Ctrl K</kbd>{" "}
          to jump to a tab or a Control
        </p>
      </div>

      <section className="hc-hero sc-hero" aria-labelledby="sc-title">
        <div className="sc-head">
          <span className="sc-mark" aria-hidden="true">
            {initialsOf(system.name).toUpperCase()}
          </span>
          <div className="sc-who">
            <h1 id="sc-title">{system.name}</h1>
            <div className="sc-meta">
              <StatusChip tone={onboardingStatusTone(system.status)}>{STATUS_LABEL[system.status]}</StatusChip>
              {system.isProvider && <StatusChip tone="accent">Provider</StatusChip>}
              <span className={`owner${mine ? " me" : ""}`}>
                <span className="av" aria-hidden="true">
                  {initialsOf(system.ownerName)}
                </span>
                Owned by {system.ownerName}
                {mine && <span className="muted"> (you)</span>}
              </span>
              {system.facets.length > 0 && (
                <span className="facets" aria-label="Deployment Facets">
                  {system.facets.map((facet) => (
                    <span key={facet.id} className="facet">
                      {facet.name}
                    </span>
                  ))}
                </span>
              )}
              <CiaBars confidentiality={system.confidentiality} integrity={system.integrity} availability={system.availability} />
              {system.vendor && <span>Vendor {system.vendor}</span>}
            </div>
            {system.description && <p className="sc-desc">{system.description}</p>}
          </div>
          <div className="sc-actions">
            {next.kind === "submit" && (
              <>
                <button
                  type="button"
                  className="hc-btn primary"
                  disabled={busy || next.blockedBy > 0}
                  aria-describedby={next.blockedBy > 0 ? "sc-submit-hint" : undefined}
                  onClick={() => post("submit", "Failed to submit for review")}
                >
                  Submit for review
                </button>
                {next.blockedBy > 0 && (
                  <button type="button" id="sc-submit-hint" className="sc-link sc-hint-link" onClick={() => goTab("controls", { scroll: true })}>
                    {next.blockedBy} mandatory {next.blockedBy === 1 ? "Control" : "Controls"} not addressed
                  </button>
                )}
              </>
            )}
            {next.kind === "decide" && (
              <>
                <button type="button" className="hc-btn reject" disabled={busy} onClick={() => setDeciding("REJECTED")}>
                  Reject
                </button>
                <button type="button" className="hc-btn primary" disabled={busy} onClick={() => setDeciding("APPROVED")}>
                  Approve…
                </button>
              </>
            )}
            {next.kind === "onboard" && (
              <button type="button" className="hc-btn primary" disabled={busy} onClick={() => post("onboard", "Failed to mark Onboarded")}>
                Mark Onboarded
              </button>
            )}
            {view.canChangeOwner && (
              <div className="sc-menu" ref={menuRef}>
                <button type="button" className="hc-btn ghost" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
                  ⋯
                </button>
                {menuOpen && (
                  <div className="menu" role="menu" aria-label="More actions">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setChangingOwner(true);
                      }}
                    >
                      Change owner
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="sc-error">
            {error}
          </p>
        )}

        <div className="sc-foot">
          <div>
            <ol className="sc-stepper" aria-label="Lifecycle">
              {stages.map((stage) => (
                <li key={stage.key} className={`step ${stage.state}${stage.tone ? ` ${stage.tone}` : ""}`} aria-current={stage.state === "now" || (system.status === "ONBOARDED" && stage.key === "ONBOARDED") ? "step" : undefined}>
                  {stage.label}
                </li>
              ))}
            </ol>
            <p className="sc-note">{view.note}</p>
          </div>
          <dl className="sc-kpis" aria-label="Headline figures">
            <div className="sc-kpi">
              <dt>{headline.baseFramework ? `${headline.baseFramework} met` : "Requirements met"}</dt>
              <dd>
                <b>{formatCompliancePercentage(requirementsMet)}</b>
                {headline.applicable > 0 && (
                  <small>
                    {headline.met}/{headline.applicable}
                  </small>
                )}
              </dd>
            </div>
            <div className="sc-kpi">
              <dt>Controls done</dt>
              <dd>
                <b>
                  {headline.controlsDone}/{headline.controlsTotal}
                </b>
              </dd>
            </div>
            <div className="sc-kpi">
              <dt>Open Risks</dt>
              <dd>
                <b>{headline.openRisks}</b>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="sc-tabs" role="tablist" aria-label="System sections" ref={tabsRef}>
        <span className="ind" ref={indicatorRef} aria-hidden="true" />
        {TAB_KEYS.map((key) => {
          const count = tabCount[key];
          return (
            <button
              key={key}
              id={`sc-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={tab === key}
              aria-controls={`sc-panel-${key}`}
              tabIndex={tab === key ? 0 : -1}
              onClick={() => goTab(key)}
              onKeyDown={onTabKeyDown}
            >
              {TAB_LABEL[key]}
              {count && <span className={`n${count.hot ? " hot" : ""}`}>{count.n}</span>}
            </button>
          );
        })}
      </div>

      <section id="sc-panel-overview" role="tabpanel" aria-labelledby="sc-tab-overview" hidden={tab !== "overview"} className="sc-panel">
        <div className="sc-bento">
          <section className="hc-card t-comp" aria-labelledby="sc-comp-h">
            <div className="hc-card-h">
              <h2 id="sc-comp-h">Compliance</h2>
              <button type="button" className="sc-link" onClick={() => goTab("requirements", { scroll: true })}>
                All Requirements →
              </button>
            </div>
            <div className="hc-card-b">
              {framework ? (
                <div className="sc-comp">
                  <Ring
                    segments={[
                      [framework.applicable === 0 ? 0 : framework.met / framework.applicable, "var(--rg-success)"],
                      [framework.applicable === 0 ? 0 : framework.partial / framework.applicable, "var(--rg-gold)"],
                    ]}
                    size={132}
                    stroke={13}
                    center={formatCompliancePercentage(compliancePercentage({ MET: framework.met, applicable: framework.applicable }))}
                    sub={framework.applicable === 0 ? "nothing to measure" : `${framework.met} of ${framework.applicable} met`}
                    label={`${framework.label}: ${framework.met} of ${framework.applicable} Requirements met`}
                  />
                  <ul className="sc-fwlist" aria-label="Frameworks in scope">
                    {view.frameworks.map((candidate) => (
                      <li key={candidate.id}>
                        <button type="button" aria-pressed={candidate.id === framework.id} onClick={() => setFrameworkId(candidate.id)}>
                          <span className="row">
                            <span>{candidate.label}</span>
                            <b>{formatCompliancePercentage(compliancePercentage({ MET: candidate.met, applicable: candidate.applicable }))}</b>
                          </span>
                          <Stack
                            parts={frameworkParts(candidate)}
                            height={6}
                            label={`${candidate.label}: ${candidate.met} met, ${candidate.partial} partially met, ${candidate.notMet} not met`}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="hc-empty">No Framework is in scope for this System yet.</p>
              )}
            </div>
          </section>

          <section className="hc-card t-ctrl" aria-labelledby="sc-ctrl-h">
            <div className="hc-card-h">
              <h2 id="sc-ctrl-h">Controls</h2>
              <button type="button" className="sc-link" onClick={() => goTab("controls", { scroll: true })}>
                Open Controls →
              </button>
            </div>
            <div className="hc-card-b">
              <div className="sc-big">
                <b>{controls.done}</b>
                <span> / {controls.total}</span>
              </div>
              <p className="sc-mini">done: Fulfilled, Waived or Not applicable, own or inherited</p>
              <Stack
                height={12}
                parts={CONTROL_STATUS_ORDER.map((status) => ({ value: controls.byStatus[status], color: STATUS_COLOR[status], label: STATUS_TEXT[status] }))}
                label={`Controls by status: ${CONTROL_STATUS_ORDER.map((status) => `${controls.byStatus[status]} ${STATUS_TEXT[status]}`).join(", ")}`}
              />
              <div className="hc-legend">
                {CONTROL_STATUS_ORDER.map((status) => (
                  <span key={status}>
                    <i style={{ background: STATUS_COLOR[status] }} aria-hidden="true" />
                    {STATUS_TEXT[status]} <b>{controls.byStatus[status]}</b>
                  </span>
                ))}
              </div>
              <h3 className="sc-sub">Where the status comes from</h3>
              <ul className="hc-bars" aria-label="Where the status comes from">
                {SOURCE_KEYS.map((key) => (
                  <li key={key} className="hc-pb-row">
                    <span className="hc-pb-n">{SOURCE_LABEL[key]}</span>
                    <span className="hc-pb-track">
                      <span className="hc-pb-fill" style={{ "--w": `${controls.total === 0 ? 0 : (controls.bySource[key] / controls.total) * 100}%`, background: SOURCE_COLOR[key] } as CSSProperties} />
                    </span>
                    <b>{controls.bySource[key]}</b>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="hc-card t-attn" aria-labelledby="sc-attn-h">
            <div className="hc-card-h">
              <h2 id="sc-attn-h">
                Needs attention{" "}
                <StatusChip tone={view.attention.length > 0 ? "danger" : "success"}>{view.attention.length}</StatusChip>
              </h2>
            </div>
            <div className="hc-card-b">
              {view.attention.length === 0 ? (
                <p className="hc-empty">Nothing needs attention on this System.</p>
              ) : (
                <ul className="sc-attn">
                  {attention.map((item) => (
                    <li key={item.id}>
                      <span className={`dot ${item.tone}`} aria-hidden="true" />
                      <div>
                        <b>{item.title}</b>
                        <small>{item.note}</small>
                      </div>
                      <button type="button" className="hc-btn" aria-label={`Open: ${item.title}`} onClick={() => (item.controlCode ? goHash(controlHash(item.controlCode), { scroll: true }) : goTab(item.tab, { scroll: true }))}>
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {hiddenAttention > 0 && (
                <button type="button" className="sc-link sc-more" aria-expanded={showAllAttention} onClick={() => setShowAllAttention(!showAllAttention)}>
                  {showAllAttention ? "Show fewer" : `${hiddenAttention} more →`}
                </button>
              )}
            </div>
          </section>

          <section className="hc-card t-risk" aria-labelledby="sc-risk-h">
            <div className="hc-card-h">
              <h2 id="sc-risk-h">Risks</h2>
              <button type="button" className="sc-link" onClick={() => goTab("risks", { scroll: true })}>
                Risk register →
              </button>
            </div>
            <div className="hc-card-b sc-riskwrap">
              <RiskGrid grid={risks.grid} open={risks.open} />
              <div className="sc-tally">
                <div>
                  <b className="num">{risks.open}</b> <span className="muted">Open</span>
                </div>
                <div>
                  <b className="num">{risks.mitigated}</b> <span className="muted">Mitigated</span>
                </div>
                <div>
                  <b className="num">{risks.accepted}</b> <span className="muted">Accepted</span>
                </div>
                <small className="muted">Open Risks by severity (rows) and likelihood (columns)</small>
              </div>
            </div>
          </section>

          <section className="hc-card t-prof" aria-labelledby="sc-prof-h">
            <div className="hc-card-h">
              <h2 id="sc-prof-h">Classification</h2>
              <button type="button" className="sc-link" onClick={() => goTab("profile", { scroll: true })}>
                Change →
              </button>
            </div>
            <div className="hc-card-b sc-prof">
              <div className="sc-ciabars">
                <h3 className="sc-sub">Impact Level</h3>
                {(
                  [
                    ["C", "Confidentiality", system.confidentiality],
                    ["I", "Integrity", system.integrity],
                    ["A", "Availability", system.availability],
                  ] as const
                ).map(([letter, name, level]) => {
                  const rank = level ? IMPACT_RANK[level] : 0;
                  return (
                    <div key={letter} className="sc-ciabar" role="img" aria-label={`${name}: ${level ? IMPACT_LABEL[level] : "Not classified"}`}>
                      <b>{letter}</b>
                      <span className="lv">
                        {[1, 2, 3, 4].map((i) => (
                          <i key={i} className={i <= rank ? `on${rank >= 4 ? " cr" : rank >= 3 ? " hi" : ""}` : ""} />
                        ))}
                      </span>
                      <span className="muted">{level ? IMPACT_LABEL[level] : "Not classified"}</span>
                    </div>
                  );
                })}
              </div>
              <div className="sc-tagcol">
                {(
                  [
                    ["Deployment Facets", classification.facets],
                    ["Business Units", classification.businessUnits],
                    ["Framework Scope", classification.frameworkScope],
                  ] as const
                ).map(([title, items]) => (
                  <div key={title}>
                    <h3 className="sc-sub">{title}</h3>
                    {items.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      <ul className="sc-tags">
                        {items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="hc-card t-act" aria-labelledby="sc-act-h">
            <div className="hc-card-h">
              <h2 id="sc-act-h">Recent activity</h2>
              <button type="button" className="sc-link" onClick={() => goTab("activity", { scroll: true })}>
                All →
              </button>
            </div>
            {view.activity.length === 0 ? (
              <p className="hc-card-b hc-empty">Nothing has changed on this System yet.</p>
            ) : (
              <ul className="hc-feed">
                {view.activity.map((item) => (
                  <li key={item.id} style={{ "--c": ACTIVITY_COLOR[item.tone] } as CSSProperties}>
                    <i aria-hidden="true" />
                    <span>
                      <b>{item.who}</b> {item.what}
                      <small className="sc-detail">{item.detail}</small>
                    </span>
                    <span title={formatDay(item.at)}>{ago(Math.max(0, Math.floor((now - Date.parse(item.at)) / DAY_MS)))}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>

      {(Object.keys(panels) as Exclude<TabKey, "overview">[]).map((key) => (
        <section key={key} id={`sc-panel-${key}`} role="tabpanel" aria-labelledby={`sc-tab-${key}`} hidden={tab !== key} className="sc-panel">
          <div className="sc-section">{key === "activity" ? <Fragment key={approvalVersion}>{panels[key]}</Fragment> : panels[key]}</div>
        </section>
      ))}

      {deciding && next.kind === "decide" && (
        <DecisionDialog
          systemId={system.id}
          systemName={system.name}
          decision={deciding}
          steps={next.steps}
          onClose={() => setDeciding(null)}
          onDone={() => {
            setDeciding(null);
            setApprovalVersion((version) => version + 1);
            router.refresh();
          }}
        />
      )}

      {changingOwner && (
        <ChangeOwnerDialog
          actor={{ id: view.userId, role: view.role }}
          systems={[{ id: system.id, name: system.name, ownerId: system.ownerId, ownerName: system.ownerName, canChange: view.canChangeOwner }]}
          onClose={() => setChangingOwner(false)}
          onDone={(_result, handedAway) => {
            setChangingOwner(false);
            // A non-Admin who gave the System away may no longer see it: its page would read "not found".
            if (handedAway) router.push("/systems");
            else router.refresh();
          }}
        />
      )}

    </div>
  );
}

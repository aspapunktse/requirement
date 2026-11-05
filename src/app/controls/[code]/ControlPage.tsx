"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/app/home/HomeGraphics";
import { STATUS_LABEL } from "@/app/organization/controls/controls-logic";
import { SensitivityChip } from "@/components/SensitivityChip";
import { APPLICABILITY_LABEL } from "@/lib/statement-of-applicability-rules";
import { controlHash } from "@/app/systems/[id]/system-page-logic";
import "@/app/home/home.css";
import "../library.css";
import "./control-page.css";
import { impactLabel, mappingsByFramework, plural } from "../library-logic";
import { ApplicabilityChip, OwnerCell, StatusDot } from "../library-parts";
import type { LibraryRow } from "../library-types";
import {
  controlEditHref,
  filterSystems,
  presentStatuses,
  requirementTotals,
  tabFromParam,
  tabsFor,
  totalsLine,
  visibilityNote,
  type TabKey,
} from "./control-page-logic";
import type { ControlPageView, PageOrganization, PageSystem, PageSystems } from "./control-page-types";

/** A status as a coloured dot and its word: state is always a word first. */
function Status({ status }: { status: PageSystem["status"] }) {
  return (
    <span className="cl-st">
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Chips({ row }: { row: LibraryRow }) {
  return (
    <div className="cp-tags">
      <ApplicabilityChip applicability={row.applicability} />
      {row.source.kind === "supplementary" && (
        <span className="cl-chip sup">
          {row.source.label}
          {row.source.draft ? " (Draft Framework)" : ""}
        </span>
      )}
      {!row.mandatory && <span className="cl-chip">Not mandatory</span>}
      {row.minSensitivityLevel !== null && (
        <span className="cp-from">
          From <SensitivityChip level={row.minSensitivityLevel} label={row.minSensitivityLabel ?? undefined} size="sm" />
        </span>
      )}
    </div>
  );
}

function ControlBody({ row }: { row: LibraryRow }) {
  return (
    <>
      <p className="cp-desc">{row.description}</p>
      {row.question && (
        <div className="cp-block">
          <span className="cp-label">Self-Assessment Question</span>
          <p className="cp-question">{row.question}</p>
        </div>
      )}
      {row.intent && (
        <div className="cp-block">
          <span className="cp-label">Intent</span>
          <p>{row.intent}</p>
        </div>
      )}
      {row.examples.length > 0 && (
        <div className="cp-block">
          <span className="cp-label">Examples</span>
          <ul aria-label={`Examples for ${row.code}`} className="cp-examples">
            {row.examples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Category, and for a Control that reaches Systems its Deployment Facets, Sensitivity Level and Impact Level minimums. */
function ScopeBody({ row }: { row: LibraryRow }) {
  if (row.applicability === "ORGANIZATIONAL") {
    return (
      <>
        <dl className="cl-kv">
          <dt>Category</dt>
          <dd>{row.category}</dd>
        </dl>
        <p className="cp-muted cp-small">An Organizational Control is implemented once by the Organization, so it has no Deployment Facet, Sensitivity or Impact Level scoping.</p>
      </>
    );
  }
  return (
    <dl className="cl-kv">
      <dt>Category</dt>
      <dd>{row.category}</dd>
      <dt>Deployment Facets</dt>
      <dd>
        {row.deploymentFacets.length > 0 ? (
          row.deploymentFacets.map((facet) => (
            <span key={facet} className="cl-chip cp-facet">
              {facet}
            </span>
          ))
        ) : (
          <span className="cp-muted">Any</span>
        )}
      </dd>
      <dt>Sensitivity Level</dt>
      <dd>
        {row.minSensitivityLevel === null ? (
          <span className="cp-muted">None</span>
        ) : (
          <span className="cp-from">
            From <SensitivityChip level={row.minSensitivityLevel} label={row.minSensitivityLabel ?? undefined} size="sm" />
          </span>
        )}
      </dd>
      <dt>Minimum Integrity</dt>
      <dd>{row.minIntegrityImpactLevel ? impactLabel(row.minIntegrityImpactLevel) : <span className="cp-muted">None</span>}</dd>
      <dt>Minimum Availability</dt>
      <dd>{row.minAvailabilityImpactLevel ? impactLabel(row.minAvailabilityImpactLevel) : <span className="cp-muted">None</span>}</dd>
    </dl>
  );
}

function SatisfiesBody({ row }: { row: LibraryRow }) {
  const groups = mappingsByFramework(row);
  const totals = requirementTotals(row.mappings);
  if (groups.length === 0) {
    return (
      <>
        <p>
          <span className="cl-chip warn">Not mapped to any Requirement</span>
        </p>
        <p className="cp-muted cp-small">A Control that satisfies no Requirement counts towards no Framework.</p>
      </>
    );
  }
  return (
    <>
      <p className="cp-muted cp-small">
        {plural(totals.total, "Requirement")} in {plural(totals.frameworks, "Framework")}: {totals.full} Full, {totals.partial} Partial.
      </p>
      <div className="cp-fws">
        {groups.map((group) => {
          const full = group.mappings.filter((mapping) => mapping.coverage === "FULL").length;
          const partial = group.mappings.length - full;
          return (
            <section key={group.framework.id} className="cp-fw" aria-label={group.framework.label}>
              <h3>
                {group.framework.label}
                {group.draft && <span className="cl-chip draft">Draft Framework</span>}
                <span className="n">
                  {plural(group.mappings.length, "Requirement")}
                  {full > 0 ? ` · ${full} Full` : ""}
                  {partial > 0 ? ` · ${partial} Partial` : ""}
                </span>
              </h3>
              <div className="cp-covbar" aria-hidden="true">
                <i className="f" style={{ width: `${(full / group.mappings.length) * 100}%` }} />
                <i className="p" style={{ width: `${(partial / group.mappings.length) * 100}%` }} />
              </div>
              <ul className="cp-reqs" aria-label={`Requirements in ${group.framework.label}`}>
                {group.mappings.map((mapping) => (
                  <li key={mapping.id}>
                    <span className="cl-rcode">{mapping.requirementCode}</span>
                    <span className="cl-rtitle">{mapping.requirementTitle}</span>
                    <span className={`cl-cov ${mapping.coverage === "FULL" ? "full" : "partial"}`}>{mapping.coverage === "FULL" ? "Full" : "Partial"}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function OrganizationBody({ organization, row }: { organization: PageOrganization; row: LibraryRow }) {
  return (
    <>
      <dl className="cl-kv">
        <dt>Status</dt>
        <dd>
          <Status status={organization.status} />
        </dd>
        <dt>Description</dt>
        <dd>{organization.description ? organization.description : <span className="cp-muted">Nobody has described how the Organization implements this Control yet.</span>}</dd>
        <dt>Last updated</dt>
        <dd>{organization.updatedOn ? `${organization.updatedOn}${organization.updatedByName ? ` by ${organization.updatedByName}` : ""}` : <span className="cp-muted">Never</span>}</dd>
      </dl>
      <p>
        <Link className="cp-more" href="/organization/controls">
          Open in Organization Control Implementations →
        </Link>
      </p>
      {row.applicability === "BOTH" && <p className="cp-muted cp-small">A Both Control passes this status on to every System it applies to while it is Fulfilled.</p>}
    </>
  );
}

function SystemsBody({ systems, code }: { systems: PageSystems; code: string }) {
  const [query, setQuery] = useState("");
  const shown = filterSystems(systems.list, query);
  const present = presentStatuses(systems.counts);
  const note = visibilityNote(systems.total, systems.list.length);
  const summary = present.map((status) => `${systems.counts[status]} ${STATUS_LABEL[status]}`).join(", ");

  return (
    <>
      {systems.total > 0 && (
        <div>
          <div className="cp-stbar" role="img" aria-label={`All ${plural(systems.total, "System")} by effective status: ${summary}`}>
            {present.map((status) => (
              <i key={status} className={`cl-s-${status}`} style={{ width: `${(systems.counts[status] / systems.total) * 100}%` }} />
            ))}
          </div>
          <ul className="cp-legend" aria-label={`All ${plural(systems.total, "System")} by effective status`}>
            {present.map((status) => (
              <li key={status}>
                <StatusDot status={status} />
                <span>
                  <b>{systems.counts[status]}</b> {STATUS_LABEL[status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {note && (
        <p className="cp-note" role="note">
          {note}
        </p>
      )}
      {systems.list.length > 0 ? (
        <>
          <div className="cp-search-row">
            <label className="hc-search">
              <Icon name="search" size={15} />
              <span className="cp-sr">Search the listed Systems</span>
              <input type="search" placeholder="Search name, owner or Business Unit" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <span className="cp-muted cp-small" aria-live="polite">
              {shown.length} of {plural(systems.list.length, "listed System")}
            </span>
          </div>
          {shown.length > 0 ? (
            <ul className="cp-syslist" aria-label="Systems">
              {shown.map((system) => (
                <li key={system.id}>
                  <Link className="cp-sysrow" href={`/systems/${system.id}${controlHash(code)}`}>
                    <span className="cp-sn">
                      <b>{system.name}</b>
                      <small>{[system.ownerName, ...system.businessUnits].join(" · ")}</small>
                    </span>
                    <span className="cp-ss">
                      <Status status={system.status} />
                      <small>{system.sourceLabel}</small>
                    </span>
                    {(system.sourceDetails.length > 0 || system.note) && (
                      <span className="cp-syscond">{[...system.sourceDetails, ...(system.note ? [system.note] : [])].join(" · ")}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cp-muted">No listed System matches.</p>
          )}
        </>
      ) : systems.total === 0 ? (
        <p className="cp-muted">No System meets this Control&apos;s scoping, so it applies to none today.</p>
      ) : (
        <p className="cp-muted">None of the Systems this Control applies to is visible to you.</p>
      )}
    </>
  );
}

/**
 * One Control, as design proposal B "Side rail and tabs" in the Home look (issue #314): a header with the code,
 * title, chips, Control Owner and Edit; a main card with tabs (The Control, Satisfies, Organization implementation,
 * Systems) beside a sticky rail (Control Owner, Scope and three counts that open their tab); on a phone the rail
 * sits above the tabs. The open tab is kept in the URL (`?tab=`), so a link can point at one. The tabs follow the
 * WAI-ARIA pattern: arrow keys, Home and End move between them.
 */
export function ControlPage({ view, initialTab }: { view: ControlPageView; initialTab: string | null }) {
  const { control: row, organization, systems } = view;
  const tabs = tabsFor(view);
  const [tab, setTab] = useState<TabKey>(() => tabFromParam(initialTab, tabs));
  const paneId = useId();
  const paneRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  const totals = requirementTotals(row.mappings);

  function go(next: TabKey, focus: "tab" | "pane" | null) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", next);
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* the address bar is a convenience; the page works without it */
    }
    if (focus === "tab") tabRefs.current[next]?.focus();
    if (focus === "pane") paneRef.current?.focus();
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    go(tabs[(target + tabs.length) % tabs.length].key, "tab");
  }

  const listed = systems?.list.length ?? 0;

  return (
    <div className="hc cl cp">
      <section className="hc-card cp-head" aria-labelledby="cp-title">
        <nav className="cp-crumb" aria-label="Breadcrumb">
          <Link href="/controls">Control Library</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{row.code}</span>
        </nav>
        <div className="cp-head-top">
          <div>
            <span className="cp-code">{row.code}</span>
            <h1 className="cp-title" id="cp-title">
              {row.title}
            </h1>
          </div>
          {view.canEdit && (
            <Link href={controlEditHref(row.code, tab)} className="hc-btn" title={`Edit ${row.code}`}>
              Edit
            </Link>
          )}
        </div>
        <Chips row={row} />
      </section>

      <div className="cp-shell">
        <div className="hc-card cp-main">
          <div className="hc-tabs" role="tablist" aria-label={`Sections of ${row.code}`}>
            {tabs.map((definition, index) => (
              <button
                key={definition.key}
                ref={(element) => {
                  tabRefs.current[definition.key] = element;
                }}
                type="button"
                role="tab"
                id={`${paneId}-tab-${definition.key}`}
                aria-controls={paneId}
                aria-selected={tab === definition.key}
                tabIndex={tab === definition.key ? 0 : -1}
                onClick={() => go(definition.key, "tab")}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {definition.label}
                {definition.count !== null && <span className="n">{definition.count}</span>}
              </button>
            ))}
          </div>
          <div className="cp-pane" id={paneId} ref={paneRef} role="tabpanel" tabIndex={0} aria-labelledby={`${paneId}-tab-${tab}`}>
            {tab === "control" && (
              <>
                <h2>The Control</h2>
                <ControlBody row={row} />
              </>
            )}
            {tab === "satisfies" && (
              <>
                <h2>Satisfies</h2>
                <SatisfiesBody row={row} />
              </>
            )}
            {tab === "implementation" && organization && (
              <>
                <h2>Organization implementation</h2>
                <OrganizationBody organization={organization} row={row} />
              </>
            )}
            {tab === "systems" && systems && (
              <>
                <h2>Systems</h2>
                <SystemsBody systems={systems} code={row.code} />
              </>
            )}
          </div>
        </div>

        <aside className="cp-rail" aria-label={`Summary of ${row.code}`}>
          <section className="hc-card">
            <div className="hc-card-h">
              <h2>Scope</h2>
            </div>
            <div className="hc-card-b">
              <dl className="cl-kv">
                <dt>Control Owner</dt>
                <dd>
                  <OwnerCell name={row.ownerName} />
                </dd>
                <dt>Applicability</dt>
                <dd>{APPLICABILITY_LABEL[row.applicability]}</dd>
              </dl>
              <ScopeBody row={row} />
            </div>
          </section>
          <section className="hc-card" aria-label="Where it counts">
            <div className="hc-card-b">
              <ul className="cp-facts">
                <li>
                  <button type="button" aria-current={tab === "satisfies" ? "true" : undefined} onClick={() => go("satisfies", "pane")}>
                    <span>Requirements</span>
                    <b>{totals.total}</b>
                    <small>{totalsLine(totals)}</small>
                  </button>
                </li>
                {organization && (
                  <li>
                    <button type="button" aria-current={tab === "implementation" ? "true" : undefined} onClick={() => go("implementation", "pane")}>
                      <span>Organization</span>
                      <Status status={organization.status} />
                      <small>{organization.updatedOn ? `Updated ${organization.updatedOn}` : organization.description ? "Never updated" : "Not described yet"}</small>
                    </button>
                  </li>
                )}
                {systems && (
                  <li>
                    <button type="button" aria-current={tab === "systems" ? "true" : undefined} onClick={() => go("systems", "pane")}>
                      <span>Systems</span>
                      <b>{systems.total}</b>
                      <small>{listed === systems.total ? "All visible to you" : `You can see ${listed} of ${systems.total}`}</small>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

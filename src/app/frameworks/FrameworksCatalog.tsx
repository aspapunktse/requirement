"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { FrameworkLineage } from "@/components/FrameworkLineage";
import { Icon, Ring } from "@/app/home/HomeGraphics";
import { useSearchHotkey, type PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { downloadCsv } from "@/lib/download-csv";
import { frameworkLabel } from "@/lib/framework-label";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./frameworks.css";
import { PublishFrameworkDialog } from "./PublishFrameworkDialog";
import {
  displayOrder,
  formatDate,
  frameworksCsv,
  frameworksCsvFilename,
  groupRows,
  matchRows,
  resolvedPercent,
  sortRows,
  totalsOf,
  unmappedGaps,
  viewCounts,
  type Totals,
} from "./frameworks-logic";
import type { CatalogRow, CatalogView, GroupKey, SortKey, ViewKey } from "./frameworks-types";

type ColumnKey = Exclude<SortKey, "default"> | "status" | "accepted" | "group" | "go";
const COLUMNS: { key: ColumnKey; label: string; sortable: boolean; numeric?: boolean }[] = [
  { key: "name", label: "Framework", sortable: true },
  { key: "status", label: "Status", sortable: false },
  { key: "resolved", label: "Coverage", sortable: true },
  { key: "gaps", label: "Gaps", sortable: true, numeric: true },
  { key: "accepted", label: "Accepted", sortable: false, numeric: true },
  { key: "systems", label: "Systems", sortable: true, numeric: true },
  { key: "group", label: "Review Group", sortable: false },
  { key: "updated", label: "Updated", sortable: true },
  { key: "go", label: "Actions", sortable: false },
];

const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "family", label: "Family" },
  { key: "status", label: "Status" },
  { key: "none", label: "None" },
];

const STAT_LABEL: Record<ViewKey, string> = {
  all: "All Frameworks",
  drafts: "Drafts",
  gaps: "With open gaps",
  resolved: "Fully resolved",
  empty: "No Requirements",
};
const STAT_TONE: Record<ViewKey, "warn" | "danger" | "ok" | undefined> = { all: undefined, drafts: "warn", gaps: "danger", resolved: "ok", empty: "warn" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The stacked coverage bar: covered, accepted, gap with Partial mappings only, gap with no mapping. */
function CoverageBar({ totals, thin = false }: { totals: Totals; thin?: boolean }) {
  if (totals.requirements === 0) return <div className={`fc-bar empty${thin ? " thin" : ""}`} role="img" aria-label="No Requirements yet" />;
  const segments: [number, string][] = [
    [totals.covered, "covered"],
    [totals.accepted, "accepted"],
    [totals.partialOnly, "partial"],
    [totals.gaps - totals.partialOnly, "none"],
  ];
  return (
    <div
      className={`fc-bar${thin ? " thin" : ""}`}
      role="img"
      aria-label={`${totals.covered} covered, ${totals.accepted} accepted, ${totals.gaps} open gaps of ${totals.requirements} Requirements`}
    >
      {segments
        .filter(([n]) => n > 0)
        .map(([n, kind]) => (
          <i key={kind} className={`st-${kind}`} style={{ flexGrow: n }} />
        ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="fc-legend" aria-label="Coverage colours">
      <span>
        <i className="st-covered" aria-hidden="true" />
        Covered
      </span>
      <span>
        <i className="st-accepted" aria-hidden="true" />
        Accepted gap
      </span>
      <span>
        <i className="st-partial" aria-hidden="true" />
        Gap, Partial mappings only
      </span>
      <span>
        <i className="st-none" aria-hidden="true" />
        Gap, no mapping
      </span>
    </div>
  );
}

/**
 * The Framework list, design proposal A "Catalog table" in the Home look (issue #266): a hero with the
 * library-wide coverage ring, stat cards that filter, and one card with search, grouping and a sortable table.
 * `loadFrameworksView` decides who sees what; this component only filters, sorts and groups what it was given.
 */
export function FrameworksCatalog({ view }: { view: CatalogView }) {
  const router = useRouter();
  const { rows, canCurate } = view;
  const [stat, setStat] = useState<ViewKey>("all");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GroupKey>("family");
  const [sort, setSort] = useState<SortKey>("default");
  const [dir, setDir] = useState<1 | -1>(1);
  const [publishing, setPublishing] = useState<CatalogRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchHotkey(searchRef);

  const counts = useMemo(() => viewCounts(rows), [rows]);
  const listed = useMemo(() => sortRows(matchRows(rows, stat, query), sort, dir), [rows, stat, query, sort, dir]);
  const groups = useMemo(() => groupRows(listed, group), [listed, group]);
  const totals = useMemo(() => totalsOf(rows), [rows]);
  const resolvedShare = totals.requirements === 0 ? null : (totals.covered + totals.accepted) / totals.requirements;
  const resolvedText = resolvedShare === null ? "—" : `${Math.round(resolvedShare * 100)}%`;
  const statKeys = (Object.keys(STAT_LABEL) as ViewKey[]).filter((key) => key !== "drafts" || canCurate);

  const paletteItems: PaletteItem[] = useMemo(
    () => [
      ...(canCurate ? [{ group: "Actions", icon: "plus" as const, label: "New Framework", meta: "add to the catalog", href: "/frameworks/new" }] : []),
      ...sortRows(rows, "default", 1).map((row) => ({
        group: "Frameworks",
        icon: "layers" as const,
        label: frameworkLabel(row),
        meta: row.requirements === 0 ? "no Requirements" : plural(row.gaps, "open gap"),
        href: `/frameworks/${row.id}/coverage`,
      })),
    ],
    [rows, canCurate],
  );
  usePagePalette({ items: paletteItems, placeholder: "Jump to a Framework…" });

  function sortBy(key: Exclude<SortKey, "default">) {
    if (sort === key) setDir(dir === 1 ? -1 : 1);
    else {
      setSort(key);
      setDir(key === "name" ? 1 : -1);
    }
  }
  function clear() {
    setStat("all");
    setQuery("");
  }
  function exportCsv() {
    downloadCsv(frameworksCsv(displayOrder(listed, group)), frameworksCsvFilename(new Date()));
  }
  function openRow(event: MouseEvent<HTMLTableRowElement>, id: string) {
    // The row is one click target, except for its own links and buttons.
    if (event.target instanceof Element && event.target.closest("a, button")) return;
    router.push(`/frameworks/${id}/coverage`);
  }

  function renderRow(row: CatalogRow, index: number) {
    const pct = resolvedPercent(row);
    const label = frameworkLabel(row);
    return (
      <tr key={row.id} className="fc-row" data-id={row.id} style={{ "--d": `${Math.min(index, 20) * 25}ms` } as CSSProperties} onClick={(event) => openRow(event, row.id)}>
        <td className="c-name">
          <div className="fwcell">
            <div className="t">
              <Link href={`/frameworks/${row.id}/coverage`}>
                <span className="fwn">
                  <b>{row.name}</b>
                  <code>{row.version}</code>
                </span>
              </Link>
              {row.isBase && <span className="fc-tag base">Base Framework</span>}
              {row.strict && (
                <span className="fc-tag strict" title="Only Fulfilled counts: Waived and Not Applicable get no credit">
                  Strict
                </span>
              )}
            </div>
            {row.description && <small>{row.description}</small>}
            {row.lineage.length > 0 && <FrameworkLineage paths={row.lineage} />}
          </div>
        </td>
        <td className="c-status">
          <StatusChip tone={row.status === "PUBLISHED" ? "success" : "warn"}>{row.status === "PUBLISHED" ? "Published" : "Draft"}</StatusChip>
        </td>
        <td className="c-cov">
          <div className="covcell">
            <CoverageBar totals={row} />
            {row.requirements > 0 ? (
              <small>
                <span className="pct">{pct}%</span> resolved · {row.covered}/{row.requirements} covered
              </small>
            ) : (
              <span className="warnline">{row.status === "PUBLISHED" ? "Published with no Requirements" : "No Requirements yet"}</span>
            )}
          </div>
        </td>
        <td className="c-gaps n gaps">
          {row.requirements === 0 ? (
            <span className="zero">—</span>
          ) : row.gaps > 0 ? (
            <>
              <b>{row.gaps}</b>
              <small>
                {row.partialOnly} Partial · {unmappedGaps(row)} none
              </small>
            </>
          ) : (
            <span className="zero">0</span>
          )}
        </td>
        <td className="c-acc n">{row.accepted > 0 ? row.accepted : <span className="zero">0</span>}</td>
        <td className="c-sys n">
          {row.systems === null ? (
            <span className="zero" title="A Draft Framework is invisible to Systems">
              —
            </span>
          ) : (
            row.systems
          )}
        </td>
        <td className="c-rg">{row.isBase ? "Base Review Step" : (row.reviewGroup ?? "—")}</td>
        <td className="c-upd muted" title={row.updatedAt.slice(0, 10)}>
          {formatDate(row.updatedAt)}
        </td>
        <td className="acts">
          {canCurate && row.status === "DRAFT" && (
            <button type="button" className="hc-btn sm" aria-label={`Publish ${label}`} onClick={() => setPublishing(row)}>
              Publish
            </button>
          )}{" "}
          <Link className="hc-btn sm" href={`/frameworks/${row.id}/coverage`} aria-label={`Coverage of ${label}`}>
            Coverage →
          </Link>
        </td>
      </tr>
    );
  }

  function renderBody() {
    if (rows.length === 0) {
      return (
        <tr>
          <td colSpan={COLUMNS.length}>
            <div className="hc-done">
              <h3>No Frameworks yet</h3>
              <p>Frameworks you can see appear here once there are some.</p>
              {canCurate && (
                <Link href="/frameworks/new" className="hc-btn primary">
                  New Framework <Icon name="arrow" size={14} />
                </Link>
              )}
            </div>
          </td>
        </tr>
      );
    }
    if (listed.length === 0) {
      return (
        <tr>
          <td colSpan={COLUMNS.length}>
            <div className="hc-done">
              <h3>No Frameworks match</h3>
              <p>Clear the search or pick another view.</p>
              <button type="button" className="hc-btn" onClick={clear}>
                Clear filters
              </button>
            </div>
          </td>
        </tr>
      );
    }
    if (group === "none") return listed.map(renderRow);
    let index = 0;
    return groups.map((g) => (
      <GroupRows key={g.name} name={g.name} count={g.rows.length} totals={g.totals}>
        {g.rows.map((row) => renderRow(row, index++))}
      </GroupRows>
    ));
  }

  return (
    <div className="hc sy fc" data-page-id={`FRAMEWORKS . ${view.roleLabel.toUpperCase()}`}>
      <section className="hc-hero" aria-labelledby="fc-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Requirement database · {view.roleLabel}</span>
          </div>
          <h1 id="fc-title">Frameworks</h1>
          <p className="hc-lede">
            {rows.length === 0 ? (
              "No Frameworks to show yet."
            ) : (
              <>
                <span className="num">{plural(rows.length, "Framework")}</span> with <span className="num">{totals.requirements}</span>{" "}
                {totals.requirements === 1 ? "Requirement" : "Requirements"} mapped onto one Control Library. <span className="num">{totals.gaps}</span>{" "}
                {totals.gaps === 1 ? "Coverage Gap is" : "Coverage Gaps are"} open{canCurate ? ` across ${plural(counts.drafts, "Draft")}` : ""}.
              </>
            )}
          </p>
          <div className="actions">
            {canCurate && (
              <Link href="/frameworks/new" className="hc-btn primary">
                + New Framework
              </Link>
            )}
            <button type="button" className="hc-btn" onClick={exportCsv} disabled={listed.length === 0}>
              Download CSV
            </button>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="hc-move">
            <Ring
              segments={[
                [totals.requirements === 0 ? 0 : totals.covered / totals.requirements, "var(--rg-success)"],
                [totals.requirements === 0 ? 0 : totals.accepted / totals.requirements, "var(--rg-gold)"],
              ]}
              size={96}
              stroke={10}
              center={resolvedText}
              sub="resolved"
              label={`${resolvedText} of ${plural(totals.requirements, "Requirement")} are covered or accepted`}
            />
            <ul aria-label="Requirements by coverage">
              <li>
                <i className="st-covered" aria-hidden="true" />
                <b>{totals.covered}</b> covered
              </li>
              <li>
                <i className="st-accepted" aria-hidden="true" />
                <b>{totals.accepted}</b> accepted gaps
              </li>
              <li>
                <i className="st-partial" aria-hidden="true" />
                <b>{totals.partialOnly}</b> gaps, Partial only
              </li>
              <li>
                <i className="st-none" aria-hidden="true" />
                <b>{totals.gaps - totals.partialOnly}</b> gaps, no mapping
              </li>
            </ul>
          </div>
        )}
      </section>

      <section className="hc-stats" aria-label="Views">
        {statKeys.map((key) => {
          const pressed = stat === key;
          return (
            <button key={key} type="button" className={`hc-card hc-stat ${STAT_TONE[key] ?? ""}`} aria-pressed={pressed} onClick={() => setStat(pressed ? "all" : key)}>
              <span className="k">
                {STAT_LABEL[key]}
                <em aria-hidden="true">{pressed && key !== "all" ? "On ✕" : "Filter →"}</em>
              </span>
              <span className="v">{counts[key]}</span>
            </button>
          );
        })}
      </section>

      <section className="hc-card sy-reg" aria-labelledby="fc-reg-h">
        <div className="hc-card-h">
          <h2 id="fc-reg-h">Catalog</h2>
          <p>
            <kbd className="hc-kbd">/</kbd> to search · <kbd className="hc-kbd">Ctrl K</kbd> to jump to a Framework
          </p>
        </div>
        <div className="hc-tbar sy-toolbar">
          <label className="hc-search">
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              type="search"
              placeholder="Search Frameworks"
              aria-label="Search Frameworks"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd className="hc-kbd" aria-hidden="true">
              /
            </kbd>
          </label>
          <span className="spacer" />
          <span className="fc-grplabel" id="fc-grp-l">
            Group by
          </span>
          <div className="fc-seg" role="group" aria-labelledby="fc-grp-l">
            {GROUPS.map((g) => (
              <button key={g.key} type="button" aria-pressed={group === g.key} onClick={() => setGroup(g.key)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="sy-tablewrap">
          <table aria-label="Frameworks">
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const on = column.sortable && sort === column.key;
                  return (
                    <th key={column.key} className={column.numeric ? "n" : undefined} aria-sort={on ? (dir === 1 ? "ascending" : "descending") : undefined}>
                      {column.sortable ? (
                        <button type="button" onClick={() => sortBy(column.key as Exclude<SortKey, "default">)}>
                          {column.label}
                          <span className="arr" aria-hidden="true">
                            {on && dir === -1 ? "▼" : "▲"}
                          </span>
                        </button>
                      ) : column.key === "go" ? (
                        <span className="sr-only">{column.label}</span>
                      ) : (
                        column.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>{renderBody()}</tbody>
          </table>
        </div>
        <div className="sy-foot">
          <span className="num" role="status">
            {listed.length} of {plural(rows.length, "Framework")}
          </span>
          <Legend />
        </div>
      </section>

      {notice && (
        <p className="fc-notice" role="status">
          {notice}
        </p>
      )}

      {publishing && (
        <PublishFrameworkDialog
          row={publishing}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setNotice(`${frameworkLabel(publishing)} published`);
            setPublishing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function GroupRows({ name, count, totals, children }: { name: string; count: number; totals: Totals; children: React.ReactNode }) {
  return (
    <>
      <tr className="sy-grp">
        <td colSpan={COLUMNS.length}>
          <i aria-hidden="true" />
          {name}
          <small>
            {plural(count, "Framework")}
            {totals.requirements > 0 && ` · ${plural(totals.gaps, "gap")}`}
          </small>
          {totals.requirements > 0 && <CoverageBar totals={totals} thin />}
        </td>
      </tr>
      {children}
    </>
  );
}

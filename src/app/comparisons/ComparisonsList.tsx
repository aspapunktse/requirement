"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, Ring } from "@/app/home/HomeGraphics";
import { useSearchHotkey, type PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { useRemote } from "@/app/systems/[id]/use-remote";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./comparisons.css";
import { ComparisonFormDialog } from "./ComparisonDialogs";
import { filterList, listCounts, plural, type ListTab } from "./comparison-logic";
import type { ComparisonListRow } from "./comparison-types";

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

async function readList(): Promise<ComparisonListRow[]> {
  const response = await fetch("/api/comparisons");
  if (!response.ok) throw new Error("The Comparisons could not be loaded");
  const body = await response.json();
  return body.comparisons as ComparisonListRow[];
}

/**
 * The Comparisons list (#373), design proposal B "Shortlist and differences" with the Open and Closed lanes of proposal C: a hero
 * with the open and closed ring, tabs (All, Open, Closed) with counts, a search box, and one table per lane, each under its own
 * lane header with a coloured dot and a count. `GET /api/comparisons` decides what the acting user sees; "New Comparison" is for
 * the roles that may create one (`canCreate`, from the page; `POST /api/comparisons` enforces it).
 */
export function ComparisonsList({ canCreate, roleLabel }: { canCreate: boolean; roleLabel: string }) {
  const router = useRouter();
  const { data: rows, failed, reload } = useRemote(readList);
  const [tab, setTab] = useState<ListTab>("all");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchHotkey(searchRef);

  const all = useMemo(() => rows ?? [], [rows]);
  const counts = listCounts(all);
  const shown = useMemo(() => filterList(all, tab, query), [all, tab, query]);
  const lanes = [
    { key: "open", label: "Open", dot: "var(--rg-success)", rows: shown.filter((row) => !row.closed) },
    { key: "closed", label: "Closed", dot: "var(--rg-waived)", rows: shown.filter((row) => row.closed) },
  ].filter((lane) => tab === "all" || tab === lane.key);

  const paletteItems: PaletteItem[] = useMemo(
    () => all.map((row) => ({ group: "Comparisons", icon: "layers" as const, label: row.name, meta: `${row.closed ? "Closed" : "Open"} · ${row.owner.name}`, href: `/comparisons/${row.id}` })),
    [all],
  );
  usePagePalette({ items: paletteItems, placeholder: "Jump to a Comparison…" });

  const hero = (
    <section className="hc-hero" aria-labelledby="cmp-title">
      <div>
        <div className="hc-who">
          <span className="hc-eyebrow">Systems / Evaluation</span>
        </div>
        <h1 id="cmp-title">Comparisons</h1>
        <p className="hc-lede">Set two to five Candidate Systems side by side to choose one of them for the same need.</p>
        <div className="actions">
          {canCreate ? (
            <button type="button" className="hc-btn primary" onClick={() => setCreating(true)}>
              + New Comparison
            </button>
          ) : (
            <span className="cmp-hint">{roleLabel} can&apos;t create a Comparison. A System Owner, a Risk Owner or an Admin can.</span>
          )}
          <Link href="/systems" className="hc-btn">
            ← Systems
          </Link>
        </div>
      </div>
      {rows && rows.length > 0 && (
        <div className="hc-move">
          <Ring
            segments={[
              [counts.open / counts.all, "var(--rg-success)"],
              [counts.closed / counts.all, "var(--rg-waived)"],
            ]}
            size={84}
            stroke={10}
            center={`${counts.open}`}
            sub="open"
            label={`${counts.open} open and ${counts.closed} closed Comparisons`}
          />
          <ul aria-label="Comparisons by state">
            <li>
              <i style={{ background: "var(--rg-success)" }} aria-hidden="true" />
              <b>{counts.open}</b> open
            </li>
            <li>
              <i style={{ background: "var(--rg-waived)" }} aria-hidden="true" />
              <b>{counts.closed}</b> closed
            </li>
          </ul>
        </div>
      )}
    </section>
  );

  function body() {
    if (failed && rows === null) {
      return (
        <div className="hc-done" role="alert">
          <h3>The Comparisons could not be loaded</h3>
          <button type="button" className="hc-btn" onClick={reload}>
            Try again
          </button>
        </div>
      );
    }
    if (rows === null) {
      return (
        <div className="hc-done" role="status">
          <h3>Loading Comparisons…</h3>
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <div className="hc-done">
          <h3>No Comparison to show</h3>
          <p>You see a Comparison as its owner or participant, as the owner or Business System Owner of a Candidate, or with a role that sees every System.</p>
        </div>
      );
    }
    if (shown.length === 0) {
      return (
        <div className="hc-done">
          <h3>Nothing matches</h3>
          <button type="button" className="hc-btn" onClick={() => { setQuery(""); setTab("all"); }}>
            Clear search
          </button>
        </div>
      );
    }
    return lanes.map((lane) => (
      <section key={lane.key} aria-label={`${lane.label} Comparisons`}>
        <h3 className="hc-lane-h">
          <i style={{ background: lane.dot }} aria-hidden="true" />
          {lane.label}
          <small>{plural(lane.rows.length, "Comparison")}</small>
        </h3>
        {lane.rows.length === 0 ? (
          <p className="cmp-lane-empty">{lane.key === "open" ? "No open Comparison matches." : "No closed Comparison matches. A Comparison closes when its outcome is recorded."}</p>
        ) : (
          <div className="cmp-tablewrap">
            <table className="cmp-reg">
              <thead>
                <tr>
                  <th scope="col">Comparison</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Candidates</th>
                  <th scope="col">State</th>
                  <th scope="col">Since</th>
                </tr>
              </thead>
              <tbody>
                {lane.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="nm">
                      <Link href={`/comparisons/${row.id}`}>{row.name}</Link>
                      {row.need && <div className="need">{row.need}</div>}
                    </td>
                    <td>{row.owner.name}</td>
                    <td className="num">{plural(row.candidateCount, "Candidate")}</td>
                    <td>
                      <span className={`cmp-state ${row.closed ? "closed" : "open"}`}>{row.closed ? "Closed" : "Open"}</span>
                    </td>
                    <td className="num muted">{formatDate(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    ));
  }

  return (
    <div className="hc sy cmp" data-page-id="COMPARISONS">
      {hero}
      <section className="hc-card sy-reg" aria-labelledby="cmp-reg-h">
        <div className="hc-card-h">
          <h2 id="cmp-reg-h">All Comparisons you can see</h2>
          {rows && <p>{counts.all}</p>}
        </div>
        <div className="hc-tabs" role="tablist" aria-label="State">
          {([["all", "All", counts.all], ["open", "Open", counts.open], ["closed", "Closed", counts.closed]] as const).map(([key, label, n]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
              <span className="n">{n}</span>
            </button>
          ))}
        </div>
        <div className="hc-tbar sy-toolbar">
          <label className="hc-search">
            <Icon name="search" size={15} />
            <input ref={searchRef} type="search" placeholder="Search name, need or owner" aria-label="Search Comparisons" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
            <kbd className="hc-kbd" aria-hidden="true">
              /
            </kbd>
          </label>
        </div>
        {body()}
      </section>
      {creating && (
        <ComparisonFormDialog
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            router.push(`/comparisons/${id}`);
          }}
        />
      )}
    </div>
  );
}

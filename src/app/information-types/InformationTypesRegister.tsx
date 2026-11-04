"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePagePalette } from "@/components/PaletteProvider";
import { Icon } from "@/app/home/HomeGraphics";
import { SensitivityChip } from "@/components/SensitivityChip";
import type { InformationTypeRow, SuggestedFrameworkRef } from "@/lib/information-type";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./information-types.css";
import { InformationTypeDrawer } from "./InformationTypeDrawer";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Highest level first, then by name: the order the API returns. */
const byLevel = (a: InformationTypeRow, b: InformationTypeRow) => b.sensitivityLevel - a.sensitivityLevel || a.name.localeCompare(b.name);

type DrawerState = { id: string | null } | null;
type Pending = { id: string; error: string | null } | null;

/**
 * The Information Type catalogue as a register (#303, design proposal A "Register and drawer"): search, a Sensitivity
 * Level filter, a table with each type's level and the number of Systems declaring it, and a drawer. A curator (the
 * Compliance Manager or an Admin) adds, edits and deletes; everyone else can open a row to read it. The server
 * decides who may write (the routes); `canCurate` only shapes what is offered. After a save the row is replaced by the
 * route's response. A type no System declares is deleted after a confirmation; one a System declares is refused.
 */
export function InformationTypesRegister({
  initialTypes,
  levels,
  frameworkChoices = [],
  canCurate,
}: {
  initialTypes: InformationTypeRow[];
  levels: SensitivityLevelInfo[];
  /** The Frameworks a curator can pick a type's suggestions from (every one but the base Framework); none for anyone else. */
  frameworkChoices?: SuggestedFrameworkRef[];
  canCurate: boolean;
}) {
  const [types, setTypes] = useState(initialTypes);

  // Ctrl+K: the view that answers "where can I put this?", and each type's own page of it.
  const paletteItems = useMemo(
    () => [
      { group: "Pages", icon: "search" as const, label: "Where can I put this information?", meta: "which Systems may hold a type", href: "/information-types/where" },
      ...types.map((row) => ({ group: "Where can I put…", icon: "search" as const, label: row.name, meta: "which Systems may hold it", href: `/information-types/where?type=${encodeURIComponent(row.id)}` })),
    ],
    [types],
  );
  usePagePalette({ items: paletteItems, placeholder: "Where can I put… (an Information Type)" });
  const [query, setQuery] = useState("");
  const [shownLevels, setShownLevels] = useState<ReadonlySet<number>>(new Set());
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const labelOf = (level: number) => levels.find((item) => item.level === level)?.label;
  const needle = query.trim().toLowerCase();
  const listed = useMemo(
    () =>
      types
        .filter((row) => shownLevels.size === 0 || shownLevels.has(row.sensitivityLevel))
        .filter((row) => !needle || `${row.name} ${row.description ?? ""}`.toLowerCase().includes(needle))
        .sort(byLevel),
    [types, shownLevels, needle],
  );
  const pendingType = pending ? types.find((row) => row.id === pending.id) : undefined;

  function toggleLevel(level: number) {
    setShownLevels((current) => {
      const next = new Set(current);
      if (!next.delete(level)) next.add(level);
      return next;
    });
  }

  function saved(row: InformationTypeRow, created: boolean) {
    setTypes((current) => (created ? [...current, row] : current.map((item) => (item.id === row.id ? row : item))));
    setNotice(created ? `Added ${row.name}.` : `Saved ${row.name}.`);
    setDrawer(null);
  }

  async function confirmDelete() {
    if (!pending || !pendingType) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/information-types/${pending.id}`, { method: "DELETE" });
      if (response.ok || response.status === 404) {
        setTypes((current) => current.filter((row) => row.id !== pending.id));
        setNotice(`Deleted ${pendingType.name}.`);
        setPending(null);
      } else {
        const body = await response.json().catch(() => null);
        setPending({ id: pending.id, error: body?.error ?? "Could not delete the Information Type." });
      }
    } catch {
      setPending({ id: pending.id, error: "Could not delete the Information Type." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hc sy it" data-page-id="INFORMATION TYPES">
      <section className="hc-hero" aria-labelledby="it-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Information Types</span>
          </div>
          <h1 id="it-title">Information Types</h1>
          <p className="hc-lede">
            The kinds of information we handle, each with one Sensitivity Level. {plural(types.length, "type")} in the catalogue.{" "}
            {canCurate
              ? "You curate the catalogue: add, change and delete types here."
              : "Only the Compliance Manager or an Admin changes the catalogue. Open a type to see which Systems declare it."}
          </p>
          <div className="actions">
            <Link href="/information-types/where" className="hc-btn">
              Where can I put this information?
            </Link>
          </div>
        </div>
      </section>

      <section className="hc-card sy-reg" aria-labelledby="it-reg-h">
        <div className="hc-card-h">
          <h2 id="it-reg-h">Register</h2>
        </div>
        <div className="hc-tbar sy-toolbar">
          <label className="hc-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Search Information Types"
              aria-label="Search Information Types"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="it-levels" role="group" aria-label="Sensitivity Level">
            <span className="muted">Level</span>
            {levels.map((level) => (
              <button
                key={level.level}
                type="button"
                className="it-level"
                aria-pressed={shownLevels.has(level.level)}
                aria-label={`${level.label}: ${plural(types.filter((row) => row.sensitivityLevel === level.level).length, "type")}`}
                onClick={() => toggleLevel(level.level)}
              >
                <SensitivityChip level={level.level} label={level.label} size="sm" />
                <em className="num">{types.filter((row) => row.sensitivityLevel === level.level).length}</em>
              </button>
            ))}
          </div>
          <span className="it-grow" />
          {canCurate && (
            <button type="button" className="hc-btn primary" onClick={() => setDrawer({ id: null })}>
              Add Information Type
            </button>
          )}
        </div>

        <div aria-live="polite">
          {notice && (
            <p className="it-banner ok" role="status">
              {notice}{" "}
              <button type="button" className="it-link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </p>
          )}
          {canCurate && pending && pendingType && (
            <div className={`it-banner ${pendingType.systemCount > 0 || pending.error ? "warn" : "info"}`} role="alert">
              {pending.error ? (
                <b>{pending.error}</b>
              ) : pendingType.systemCount > 0 ? (
                <b>
                  {pendingType.name} is declared by {plural(pendingType.systemCount, "System")} and can&apos;t be deleted. Remove it from{" "}
                  {pendingType.systemCount === 1 ? "that System" : "those Systems"} first.
                </b>
              ) : (
                <b>Delete {pendingType.name}? No System declares it, so nothing else changes.</b>
              )}
              <span className="it-acts">
                {pendingType.systemCount === 0 && !pending.error && (
                  <button type="button" className="hc-btn it-danger" disabled={busy} onClick={confirmDelete}>
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                )}
                <button type="button" className="hc-btn ghost" onClick={() => setPending(null)}>
                  {pendingType.systemCount === 0 && !pending.error ? "Keep" : "Dismiss"}
                </button>
              </span>
            </div>
          )}
        </div>

        <div className="sy-tablewrap">
          <table className="it-t" aria-label="Information Types">
            <thead>
              <tr>
                <th>Information Type</th>
                <th>Sensitivity Level</th>
                <th>Declared by</th>
                <th>
                  <span className={canCurate ? undefined : "sr-only"}>{canCurate ? "Actions" : "Open"}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listed.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="name">
                      <button type="button" className="it-open" onClick={() => setDrawer({ id: row.id })}>
                        {row.name}
                      </button>
                      {row.description && <small>{row.description}</small>}
                    </div>
                  </td>
                  <td>
                    <SensitivityChip level={row.sensitivityLevel} label={labelOf(row.sensitivityLevel)} />
                  </td>
                  <td>
                    {row.systemCount > 0 ? (
                      <b className="num">{plural(row.systemCount, "System")}</b>
                    ) : (
                      <span className="muted">No System yet</span>
                    )}
                  </td>
                  <td className="it-actions">
                    {canCurate ? (
                      <>
                        <button type="button" className="hc-btn" aria-label={`Edit ${row.name}`} onClick={() => setDrawer({ id: row.id })}>
                          Edit
                        </button>{" "}
                        <button
                          type="button"
                          className="hc-btn it-danger"
                          aria-label={`Delete ${row.name}`}
                          onClick={() => setPending({ id: row.id, error: null })}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <button type="button" className="hc-btn" aria-label={`Open ${row.name}`} onClick={() => setDrawer({ id: row.id })}>
                        Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {listed.length === 0 && (
                <tr>
                  <td colSpan={4} className="hc-empty">
                    {types.length === 0 ? "No Information Types yet." : "No Information Type matches the search and filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="sy-foot">
          <span className="num" role="status">
            {listed.length} of {types.length} Information Types
          </span>
          <span className="muted">{canCurate ? "Open a type to edit it" : "Open a type to see which Systems declare it"}</span>
        </div>
      </section>

      {drawer && (drawer.id === null || types.some((row) => row.id === drawer.id)) && (
        <InformationTypeDrawer
          key={drawer.id ?? "new"}
          type={drawer.id ? (types.find((row) => row.id === drawer.id) ?? null) : null}
          levels={levels}
          frameworkChoices={frameworkChoices}
          canCurate={canCurate}
          onClose={() => setDrawer(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

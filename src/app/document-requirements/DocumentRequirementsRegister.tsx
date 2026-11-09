"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/app/home/HomeGraphics";
import {
  DOCUMENTATION_STAGES,
  STAGE_LABEL,
  TRACK_LABEL,
  type DocumentRequirementRow,
} from "@/lib/document-requirement";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./document-requirements.css";
import { DocumentRequirementDrawer } from "./DocumentRequirementDrawer";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** First documentation before second round, then by name: the order the API returns. */
const byStage = (a: DocumentRequirementRow, b: DocumentRequirementRow) =>
  DOCUMENTATION_STAGES.indexOf(a.stage) - DOCUMENTATION_STAGES.indexOf(b.stage) || a.name.localeCompare(b.name);

type DrawerState = { id: string | null } | null;
type Pending = { id: string; error: string | null } | null;

/**
 * The Document Requirement catalogue as a register (#323): search, a stage filter and a table with each requirement's
 * stage and Tracks. A curator (the Compliance Manager or an Admin) adds, edits and deletes; everyone else can open a row
 * to read it. The server decides who may write (the routes); `canCurate` only shapes what is offered. After a save the
 * row is replaced by the route's response. Nothing references a requirement yet, so a delete only asks for a confirmation.
 */
export function DocumentRequirementsRegister({ initialRequirements, canCurate }: { initialRequirements: DocumentRequirementRow[]; canCurate: boolean }) {
  const [rows, setRows] = useState(initialRequirements);
  const [query, setQuery] = useState("");
  const [shownStages, setShownStages] = useState<ReadonlySet<string>>(new Set());
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const listed = useMemo(
    () =>
      rows
        .filter((row) => shownStages.size === 0 || shownStages.has(row.stage))
        .filter((row) => !needle || `${row.name} ${row.description ?? ""}`.toLowerCase().includes(needle))
        .sort(byStage),
    [rows, shownStages, needle],
  );
  const pendingRow = pending ? rows.find((row) => row.id === pending.id) : undefined;

  function toggleStage(stage: string) {
    setShownStages((current) => {
      const next = new Set(current);
      if (!next.delete(stage)) next.add(stage);
      return next;
    });
  }

  function saved(row: DocumentRequirementRow, created: boolean) {
    setRows((current) => (created ? [...current, row] : current.map((item) => (item.id === row.id ? row : item))));
    setNotice(created ? `Added ${row.name}.` : `Saved ${row.name}.`);
    setDrawer(null);
  }

  async function confirmDelete() {
    if (!pending || !pendingRow) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/document-requirements/${pending.id}`, { method: "DELETE" });
      if (response.ok || response.status === 404) {
        setRows((current) => current.filter((row) => row.id !== pending.id));
        setNotice(`Deleted ${pendingRow.name}.`);
        setPending(null);
      } else {
        const body = await response.json().catch(() => null);
        setPending({ id: pending.id, error: body?.error ?? "Could not delete the Document Requirement." });
      }
    } catch {
      setPending({ id: pending.id, error: "Could not delete the Document Requirement." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hc sy dr" data-page-id="DOCUMENT REQUIREMENTS">
      <section className="hc-hero" aria-labelledby="dr-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Document Requirements</span>
          </div>
          <h1 id="dr-title">Document Requirements</h1>
          <p className="hc-lede">
            What a System must provide besides answering its Controls, each needed at a stage and on the Tracks it applies to.{" "}
            {plural(rows.length, "requirement")} in the catalogue.{" "}
            {canCurate ? "You curate the catalogue: add, change and delete requirements here." : "Only the Compliance Manager or an Admin changes the catalogue."}
          </p>
        </div>
      </section>

      <section className="hc-card sy-reg" aria-labelledby="dr-reg-h">
        <div className="hc-card-h">
          <h2 id="dr-reg-h">Register</h2>
        </div>
        <div className="hc-tbar sy-toolbar">
          <label className="hc-search">
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Search Document Requirements"
              aria-label="Search Document Requirements"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="dr-stages" role="group" aria-label="Stage">
            <span className="muted">Stage</span>
            {DOCUMENTATION_STAGES.map((stage) => {
              const count = rows.filter((row) => row.stage === stage).length;
              return (
                <button key={stage} type="button" className="dr-stage" aria-pressed={shownStages.has(stage)} aria-label={`${STAGE_LABEL[stage]}: ${plural(count, "requirement")}`} onClick={() => toggleStage(stage)}>
                  {STAGE_LABEL[stage]}
                  <em>{count}</em>
                </button>
              );
            })}
          </div>
          <span className="dr-grow" />
          {canCurate && (
            <button type="button" className="hc-btn primary" onClick={() => setDrawer({ id: null })}>
              Add Document Requirement
            </button>
          )}
        </div>

        <div aria-live="polite">
          {notice && (
            <p className="dr-banner ok" role="status">
              {notice}{" "}
              <button type="button" className="dr-link" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </p>
          )}
          {canCurate && pending && pendingRow && (
            <div className={`dr-banner ${pending.error ? "warn" : "info"}`} role="alert">
              {pending.error ? <b>{pending.error}</b> : <b>Delete {pendingRow.name}? It is removed from the catalogue.</b>}
              <span className="dr-acts">
                {!pending.error && (
                  <button type="button" className="hc-btn dr-danger" disabled={busy} onClick={confirmDelete}>
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                )}
                <button type="button" className="hc-btn ghost" onClick={() => setPending(null)}>
                  {pending.error ? "Dismiss" : "Keep"}
                </button>
              </span>
            </div>
          )}
        </div>

        <div className="sy-tablewrap">
          <table className="dr-t" aria-label="Document Requirements">
            <thead>
              <tr>
                <th>Document Requirement</th>
                <th>Needed at</th>
                <th>Tracks</th>
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
                      <button type="button" className="dr-open" onClick={() => setDrawer({ id: row.id })}>
                        {row.name}
                      </button>
                      {row.description && <small>{row.description}</small>}
                    </div>
                  </td>
                  <td>{STAGE_LABEL[row.stage]}</td>
                  <td>
                    <span className="dr-tracks">
                      {row.tracks.map((track) => (
                        <span key={track} className="dr-track">
                          {TRACK_LABEL[track]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="dr-actions">
                    {canCurate ? (
                      <>
                        <button type="button" className="hc-btn" aria-label={`Edit ${row.name}`} onClick={() => setDrawer({ id: row.id })}>
                          Edit
                        </button>{" "}
                        <button type="button" className="hc-btn dr-danger" aria-label={`Delete ${row.name}`} onClick={() => setPending({ id: row.id, error: null })}>
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
                    {rows.length === 0 ? "No Document Requirements yet." : "No Document Requirement matches the search and filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="sy-foot">
          <span className="num" role="status">
            {listed.length} of {rows.length} Document Requirements
          </span>
          <span className="muted">{canCurate ? "Open a requirement to edit it" : "Open a requirement to read it"}</span>
        </div>
      </section>

      {drawer && (drawer.id === null || rows.some((row) => row.id === drawer.id)) && (
        <DocumentRequirementDrawer
          key={drawer.id ?? "new"}
          requirement={drawer.id ? (rows.find((row) => row.id === drawer.id) ?? null) : null}
          canCurate={canCurate}
          onClose={() => setDrawer(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

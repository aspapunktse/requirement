"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/app/home/HomeGraphics";
import type { ControlPackRow } from "@/lib/control-pack";
import { MAX_CONTROL_PACK_NAME_LENGTH, MAX_CONTROL_PACK_NOTE_LENGTH } from "@/lib/control-pack";
import "@/app/home/home.css";
import "./control-packs.css";

export type PackControl = { id: string; code: string; title: string; category: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const byName = (a: ControlPackRow, b: ControlPackRow) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/** `null` is a new pack that isn't saved yet. */
type Editing = string | null | undefined;

/**
 * Manage the Control Packs (#394): a list with each pack's name, note and Control count, and an editor beside it
 * (name, note, a searchable Control picker) with a delete that asks first. The Internal Auditor edits; every other
 * role that may open the page sees the same editor read-only. The routes decide who may write, `canWrite` only shapes
 * what is offered. After a save, the pack in the list is replaced by the route's answer.
 */
export function ControlPacksManager({ initialPacks, controls, canWrite }: { initialPacks: ControlPackRow[]; controls: PackControl[]; canWrite: boolean }) {
  const [packs, setPacks] = useState(initialPacks);
  const [editing, setEditing] = useState<Editing>(undefined);
  const [notice, setNotice] = useState<string | null>(null);
  const editedPack = editing ? packs.find((pack) => pack.id === editing) : undefined;

  function saved(pack: ControlPackRow, created: boolean) {
    setPacks((current) => (created ? [...current, pack] : current.map((item) => (item.id === pack.id ? pack : item))));
    setNotice(created ? `Added ${pack.name}.` : `Saved ${pack.name}.`);
    setEditing(pack.id);
  }
  function deleted(pack: ControlPackRow) {
    setPacks((current) => current.filter((item) => item.id !== pack.id));
    setNotice(`Deleted ${pack.name}. Internal Audits already planned are unchanged.`);
    setEditing(undefined);
  }

  return (
    <div className="hc cp" data-page-id="INTERNAL AUDITS . CONTROL PACKS">
      <nav className="cp-crumb" aria-label="Breadcrumb">
        <Link href="/internal-audits">Internal Audits</Link>
        <span>/</span>
        <span>Control Packs</span>
      </nav>

      <section className="hc-hero" aria-labelledby="cp-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Internal Audits</span>
          </div>
          <h1 id="cp-title">Control Packs</h1>
          <p className="hc-lede">
            Named sets of Controls for planning Internal Audits, offered as &ldquo;Start from&rdquo; cards in the planner. {plural(packs.length, "pack")}.{" "}
            {canWrite ? "Picking a pack adds its Controls to an audit; the audit doesn't remember the pack." : "Only an Internal Auditor changes Control Packs."}
          </p>
        </div>
      </section>

      <div aria-live="polite">
        {notice && (
          <p className="cp-banner" role="status">
            {notice}{" "}
            <button type="button" className="cp-link" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </p>
        )}
      </div>

      <div className="cp-main">
        <section className="hc-card" aria-labelledby="cp-list-h">
          <div className="hc-card-h">
            <h2 id="cp-list-h">Packs</h2>
            {canWrite && (
              <button type="button" className="hc-btn primary" onClick={() => setEditing(null)}>
                New Control Pack
              </button>
            )}
          </div>
          {packs.length === 0 ? (
            <p className="cp-empty">{canWrite ? "No Control Packs yet. Add one for a theme you audit again and again." : "No Control Packs yet."}</p>
          ) : (
            <ul className="cp-list">
              {[...packs].sort(byName).map((pack) => (
                <li key={pack.id}>
                  <button type="button" className="cp-row" aria-pressed={editing === pack.id} onClick={() => setEditing(pack.id)}>
                    <span className="ib">
                      <Icon name="layers" size={18} />
                    </span>
                    <b>{pack.name}</b>
                    <small>{pack.note || "No note"}</small>
                    <span className="cp-count">{plural(pack.controlIds.length, "Control")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {editing !== undefined && (editing === null || editedPack) && (
          <PackEditor
            key={editing ?? "new"}
            pack={editedPack ?? null}
            controls={controls}
            canWrite={canWrite}
            taken={packs}
            onSaved={saved}
            onDeleted={deleted}
            onClose={() => setEditing(undefined)}
          />
        )}
      </div>
    </div>
  );
}

function PackEditor({
  pack,
  controls,
  canWrite,
  taken,
  onSaved,
  onDeleted,
  onClose,
}: {
  pack: ControlPackRow | null;
  controls: PackControl[];
  canWrite: boolean;
  taken: ControlPackRow[];
  onSaved: (pack: ControlPackRow, created: boolean) => void;
  onDeleted: (pack: ControlPackRow) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(pack?.name ?? "");
  const [note, setNote] = useState(pack?.note ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(pack?.controlIds ?? []));
  const [query, setQuery] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => controls.filter((control) => (!onlyPicked || picked.has(control.id)) && (!needle || `${control.code} ${control.title}`.toLowerCase().includes(needle))),
    [controls, onlyPicked, picked, needle],
  );
  const knownIds = useMemo(() => new Set(controls.map((control) => control.id)), [controls]);
  const trimmed = name.trim();
  const clash = taken.find((other) => other.id !== pack?.id && other.name.toLowerCase() === trimmed.toLowerCase());

  function toggle(id: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }
  function toggleShown(on: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      for (const control of shown) {
        if (on) next.add(control.id);
        else next.delete(control.id);
      }
      return next;
    });
  }

  async function save() {
    if (!trimmed) return setError("Give the Control Pack a name.");
    if (clash) return setError(`A Control Pack named "${clash.name}" already exists.`);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(pack ? `/api/control-packs/${pack.id}` : "/api/control-packs", {
        method: pack ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, note: note.trim(), controlIds: [...picked].filter((id) => knownIds.has(id)) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.controlPack) return setError(body?.error ?? "Could not save the Control Pack.");
      onSaved(body.controlPack, !pack);
    } catch {
      setError("Could not save the Control Pack.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!pack) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/control-packs/${pack.id}`, { method: "DELETE" });
      if (response.ok || response.status === 404) return onDeleted(pack);
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Could not delete the Control Pack.");
    } catch {
      setError("Could not delete the Control Pack.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hc-card cp-editor" aria-labelledby="cp-ed-h">
      <div className="hc-card-h">
        <h2 id="cp-ed-h">{pack ? (canWrite ? "Edit Control Pack" : pack.name) : "New Control Pack"}</h2>
        <button type="button" className="hc-btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="cp-body">
        {error && (
          <p role="alert" className="cp-error">
            {error}
          </p>
        )}
        <label className="cp-field">
          Name
          <input value={name} maxLength={MAX_CONTROL_PACK_NAME_LENGTH} readOnly={!canWrite} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="cp-field">
          Note (optional)
          <input value={note} maxLength={MAX_CONTROL_PACK_NOTE_LENGTH} readOnly={!canWrite} placeholder={canWrite ? "What this pack is for" : ""} onChange={(event) => setNote(event.target.value)} />
        </label>

        <div className="cp-picker">
          <div className="cp-picker-h">
            <b>
              Controls <span className="cp-count">{picked.size} picked</span>
            </b>
            <label className="hc-search">
              <Icon name="search" size={15} />
              <input type="search" placeholder="Search by code or title" aria-label="Search Controls" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="cp-check">
              <input type="checkbox" checked={onlyPicked} onChange={(event) => setOnlyPicked(event.target.checked)} />
              Picked only
            </label>
            {canWrite && (
              <span className="cp-bulk">
                <button type="button" className="hc-btn ghost" onClick={() => toggleShown(true)} disabled={shown.length === 0}>
                  Add shown
                </button>
                <button type="button" className="hc-btn ghost" onClick={() => toggleShown(false)} disabled={shown.length === 0}>
                  Remove shown
                </button>
              </span>
            )}
          </div>
          <ul className="cp-controls" aria-label="Controls">
            {shown.map((control) => (
              <li key={control.id}>
                <label className="cp-control">
                  <input type="checkbox" checked={picked.has(control.id)} disabled={!canWrite} onChange={() => toggle(control.id)} />
                  <span className="cp-code">{control.code}</span>
                  <span className="cp-title">{control.title}</span>
                  <small>{control.category}</small>
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="cp-empty">{onlyPicked && !needle ? "No Controls picked." : "No Control matches."}</li>}
          </ul>
        </div>

        {canWrite && (
          <div className="cp-actions">
            {pack &&
              (confirming ? (
                <span className="cp-confirm" role="alert">
                  Delete {pack.name}? Internal Audits already planned are unchanged.
                  <button type="button" className="hc-btn cp-danger" disabled={busy} onClick={remove}>
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                  <button type="button" className="hc-btn ghost" onClick={() => setConfirming(false)}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="hc-btn cp-danger" onClick={() => setConfirming(true)}>
                  Delete Control Pack
                </button>
              ))}
            <span className="cp-grow" />
            <button type="button" className="hc-btn primary" disabled={busy || !trimmed} onClick={save}>
              {busy ? "Saving…" : pack ? "Save" : "Add Control Pack"}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import type { CoverageView } from "./coverage-types";
import type { Mutate } from "./RequirementDrawer";

/**
 * The Framework Owner in the page header (#319). Everyone sees who it is ("No owner" while unset); a Compliance
 * Manager or an Admin gets "Assign owner" / "Change owner", a picker of Users and a Clear action. Saved through
 * `PATCH /api/frameworks/[id]`; a refusal is shown here and nothing changes.
 */
export function FrameworkOwnerLine({ view, mutate, pending }: { view: CoverageView; mutate: Mutate; pending: boolean }) {
  const { framework, owners, canAssignOwner } = view;
  const [editing, setEditing] = useState(false);
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(ownerId: string | null, notice: string) {
    setBusy(true);
    setError(null);
    const failure = await mutate({ path: `/api/frameworks/${framework.id}`, method: "PATCH", body: { ownerId } }, notice);
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setEditing(false);
    setChoice("");
  }

  return (
    <div className="cv-owner" role="group" aria-label="Framework Owner">
      <span className="cv-owner-k">Framework Owner</span>
      {framework.owner ? <b>{framework.owner.name}</b> : <span className="cv-muted">No owner</span>}
      {canAssignOwner && !editing && (
        <button type="button" className="hc-btn sm" onClick={() => setEditing(true)}>
          {framework.owner ? "Change owner" : "Assign owner"}
        </button>
      )}
      {canAssignOwner && editing && (
        <>
          <label className="cv-owner-pick">
            <span className="sr-only">Choose a Framework Owner</span>
            <select className="hc-sel" value={choice} onChange={(event) => setChoice(event.target.value)} disabled={busy}>
              <option value="" disabled>
                Choose a Framework Owner…
              </option>
              {owners.map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="hc-btn primary sm" disabled={busy || pending || choice === ""} onClick={() => void save(choice, "Framework Owner saved")}>
            {busy ? "Saving…" : "Save owner"}
          </button>
          {framework.owner && (
            <button type="button" className="hc-btn sm" disabled={busy || pending} onClick={() => void save(null, "Framework Owner cleared")}>
              Clear owner
            </button>
          )}
          <button type="button" className="hc-btn sm" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="cv-owner-err">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The Controls mapped to the Framework with a first-round toggle each (#319). The Framework's owner, a Compliance
 * Manager or an Admin toggles; everyone else sees it read-only. Each toggle is one
 * `PUT /api/frameworks/[id]/first-round-controls/[controlId]`; a refusal is shown and the box stays as it was.
 * Stored and shown only: it changes nothing about Assessments, submission or compliance yet.
 */
export function FirstRoundCard({ view, mutate, pending }: { view: CoverageView; mutate: Mutate; pending: boolean }) {
  const { framework, firstRound, canMarkFirstRound } = view;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const markedCount = firstRound.filter((control) => control.marked).length;

  async function toggle(controlId: string, code: string, on: boolean) {
    setBusyId(controlId);
    setError(null);
    const failure = await mutate(
      { path: `/api/frameworks/${framework.id}/first-round-controls/${controlId}`, method: "PUT", body: { firstRound: on } },
      on ? `${code} is now first round` : `${code} is no longer first round`,
    );
    setBusyId(null);
    if (failure) setError(failure);
  }

  return (
    <section className="hc-card cv-first" aria-label="First-round Controls">
      <h2>First round</h2>
      <p className="cv-muted">
        The Controls this Framework&rsquo;s owner wants asked first, before a System&rsquo;s track is chosen. A Control is first round on a System when the owner of any Framework in the
        System&rsquo;s scope has marked it. Nothing changes for Systems yet.
        {!canMarkFirstRound && " Only the Framework Owner, a Compliance Manager or an Admin can change this."}
      </p>
      {firstRound.length === 0 ? (
        <p className="cv-muted">No Control is mapped to this Framework yet.</p>
      ) : (
        <>
          <p role="status" className="cv-first-count">
            {markedCount} of {firstRound.length} {firstRound.length === 1 ? "Control" : "Controls"} first round
          </p>
          <ul className="cv-first-list">
            {firstRound.map((control) => (
              <li key={control.controlId}>
                <label>
                  <input
                    type="checkbox"
                    checked={control.marked}
                    disabled={!canMarkFirstRound || busyId !== null || pending}
                    onChange={(event) => void toggle(control.controlId, control.code, event.target.checked)}
                  />
                  <span className="cv-first-code">{control.code}</span> {control.title}
                </label>
                {busyId === control.controlId && <span className="cv-muted"> Saving…</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="cv-owner-err">
          {error}
        </p>
      )}
    </section>
  );
}

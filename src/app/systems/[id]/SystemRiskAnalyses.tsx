"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusChip } from "@/components/ui/StatusChip";
import type { RiskAnalysisView } from "@/lib/risk-analysis";
import { formatDay } from "./system-page-logic";
import { RISK_LEVELS } from "./system-page-types";
import { useRemote } from "./use-remote";

type Level = (typeof RISK_LEVELS)[number];
type OpenRisk = { id: string; title: string };
type NewRisk = { key: number; title: string; description: string; severity: Level; likelihood: Level };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The form to record a Risk Analysis, or to edit one that isn't completed: date, participants (Users), named outsiders (one per
 * line), notes, which open Risks were reviewed and new Risks raised in the meeting. New Risks are logged by the server with the
 * analysis, in one transaction. When editing, the Risks already raised stay and only new ones are added.
 */
function AnalysisForm({
  systemId,
  existing,
  people,
  openRisks,
  onSaved,
  onCancel,
}: {
  systemId: string;
  existing: RiskAnalysisView | null;
  people: { id: string; name: string }[];
  openRisks: OpenRisk[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [heldOn, setHeldOn] = useState(existing?.heldOn ?? today());
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [participantIds, setParticipantIds] = useState<string[]>(existing?.participants.map((person) => person.id) ?? []);
  const [outsiders, setOutsiders] = useState((existing?.outsiders ?? []).join("\n"));
  // A new analysis starts with every open Risk ticked as reviewed; the meeting un-ticks what it didn't cover.
  const [reviewedIds, setReviewedIds] = useState<string[]>(existing ? existing.reviewedRisks.map((risk) => risk.id) : openRisks.map((risk) => risk.id));
  const [newRisks, setNewRisks] = useState<NewRisk[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>, id: string) =>
    setter((previous) => (previous.includes(id) ? previous.filter((candidate) => candidate !== id) : [...previous, id]));
  const updateRisk = (key: number, patch: Partial<NewRisk>) =>
    setNewRisks((previous) => previous.map((risk) => (risk.key === key ? { ...risk, ...patch } : risk)));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/risk-analyses${existing ? `/${existing.id}` : ""}`, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          heldOn,
          notes,
          participantIds,
          outsiders: outsiders.split("\n").map((name) => name.trim()).filter((name) => name !== ""),
          reviewedRiskIds: reviewedIds,
          newRisks: newRisks.map((risk) => ({ title: risk.title, description: risk.description, severity: risk.severity, likelihood: risk.likelihood })),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Couldn't save the Risk Analysis");
        return;
      }
      onSaved();
    } catch {
      setError("Couldn't save the Risk Analysis");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="sc-form" aria-label={existing ? "Edit Risk Analysis" : "Record a Risk Analysis"}>
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      <label className="sc-field">
        <span>Date of the meeting</span>
        <input type="date" aria-label="Date of the meeting" value={heldOn} onChange={(event) => setHeldOn(event.target.value)} required />
      </label>
      <fieldset className="sc-field">
        <span>Participants</span>
        {people.length === 0 ? (
          <p className="muted">No Users to pick from.</p>
        ) : (
          <div className="sc-checklist">
            {people.map((person) => (
              <label key={person.id}>
                <input type="checkbox" checked={participantIds.includes(person.id)} onChange={() => toggle(setParticipantIds, person.id)} /> {person.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <label className="sc-field">
        <span>Outside participants, one name per line (the vendor, for example)</span>
        <textarea aria-label="Outside participants" rows={2} value={outsiders} onChange={(event) => setOutsiders(event.target.value)} />
      </label>
      <label className="sc-field">
        <span>Notes</span>
        <textarea aria-label="Notes" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <fieldset className="sc-field">
        <span>Open Risks reviewed</span>
        {openRisks.length === 0 ? (
          <p className="muted">This System has no open Risks.</p>
        ) : (
          <div className="sc-checklist">
            {openRisks.map((risk) => (
              <label key={risk.id}>
                <input type="checkbox" checked={reviewedIds.includes(risk.id)} onChange={() => toggle(setReviewedIds, risk.id)} /> {risk.title}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      {existing && existing.raisedRisks.length > 0 && (
        <p className="muted">Already raised in this meeting: {existing.raisedRisks.map((risk) => risk.title).join(", ")}</p>
      )}
      <fieldset className="sc-field">
        <span>Risks raised in the meeting</span>
        {newRisks.map((risk, index) => (
          <div key={risk.key} className="sc-form" role="group" aria-label={`New Risk ${index + 1}`}>
            <label className="sc-field">
              <span>Title</span>
              <input aria-label={`New Risk ${index + 1} title`} value={risk.title} onChange={(event) => updateRisk(risk.key, { title: event.target.value })} required />
            </label>
            <label className="sc-field">
              <span>Description</span>
              <textarea aria-label={`New Risk ${index + 1} description`} rows={2} value={risk.description} onChange={(event) => updateRisk(risk.key, { description: event.target.value })} required />
            </label>
            <div className="sc-form-pair">
              <label className="sc-field">
                <span>Severity</span>
                <select aria-label={`New Risk ${index + 1} severity`} value={risk.severity} onChange={(event) => updateRisk(risk.key, { severity: event.target.value as Level })}>
                  {RISK_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sc-field">
                <span>Likelihood</span>
                <select aria-label={`New Risk ${index + 1} likelihood`} value={risk.likelihood} onChange={(event) => updateRisk(risk.key, { likelihood: event.target.value as Level })}>
                  {RISK_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="sc-btnrow">
              <button type="button" className="hc-btn" onClick={() => setNewRisks((previous) => previous.filter((candidate) => candidate.key !== risk.key))}>
                Remove this Risk
              </button>
            </div>
          </div>
        ))}
        <div className="sc-btnrow">
          <button
            type="button"
            className="hc-btn"
            onClick={() => {
              setNewRisks((previous) => [...previous, { key: nextKey, title: "", description: "", severity: "MEDIUM", likelihood: "MEDIUM" }]);
              setNextKey((previous) => previous + 1);
            }}
          >
            + Raise a Risk
          </button>
        </div>
      </fieldset>
      <div className="sc-btnrow">
        <button type="submit" className="hc-btn primary" disabled={saving}>
          {existing ? "Save changes" : "Record Risk Analysis"}
        </button>
        <button type="button" className="hc-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AnalysisEntry({
  systemId,
  analysis,
  canRecord,
  onEdit,
  onChanged,
}: {
  systemId: string;
  analysis: RiskAnalysisView;
  canRecord: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const completed = analysis.completedAt !== null;

  async function complete() {
    setError(null);
    setCompleting(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/risk-analyses/${analysis.id}/complete`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Couldn't complete the Risk Analysis");
        return;
      }
      onChanged();
    } catch {
      setError("Couldn't complete the Risk Analysis");
    } finally {
      setCompleting(false);
    }
  }

  const everyone = [...analysis.participants.map((person) => person.name), ...analysis.outsiders];
  return (
    <li className="sc-analysis">
      <div className="sc-btnrow">
        <b>{formatDay(analysis.heldOn)}</b>
        <StatusChip tone={completed ? "success" : "warn"}>{completed ? "Completed" : "In progress"}</StatusChip>
        {canRecord && !completed && (
          <>
            <button type="button" className="hc-btn" onClick={onEdit} disabled={completing}>
              Edit
            </button>
            <button type="button" className="hc-btn primary" onClick={complete} disabled={completing}>
              Complete
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      <p className="muted">
        {everyone.length > 0 ? `With ${everyone.join(", ")}` : "No participants recorded"}
        {analysis.recordedBy && ` · recorded by ${analysis.recordedBy.name}`}
        {completed && analysis.completedBy && ` · completed by ${analysis.completedBy.name}`}
      </p>
      {analysis.notes !== "" && <p className="sc-notes">{analysis.notes}</p>}
      <p className="muted">
        Reviewed: {analysis.reviewedRisks.length === 0 ? "none" : analysis.reviewedRisks.map((risk) => risk.title).join(", ")}
        {analysis.raisedRisks.length > 0 && ` · Raised: ${analysis.raisedRisks.map((risk) => risk.title).join(", ")}`}
      </p>
    </li>
  );
}

/**
 * Risk Analyses on the Risks tab (#325, PRD 0002 F-RA.2-3): the meetings recorded on this System, newest first, read by anyone who
 * sees the System. Those who `canRecord` (a Risk Owner or an Admin who isn't the System's owner, the rule the routes enforce)
 * record one, edit it while it isn't completed and complete it. Completing is refused by the server while an open Risk has no owner;
 * its message names them and is shown here. `openRisks` are the System's open Risks as the register loaded them, and `onRisksChanged`
 * asks the register to read again after a meeting logged new ones.
 */
export function SystemRiskAnalyses({
  systemId,
  canRecord,
  people,
  openRisks,
  onRisksChanged,
}: {
  systemId: string;
  canRecord: boolean;
  people: { id: string; name: string }[];
  openRisks: OpenRisk[];
  onRisksChanged: () => void;
}) {
  const router = useRouter();
  // "new", the id of the analysis being edited, or nothing.
  const [editing, setEditing] = useState<"new" | string | null>(null);

  const read = useCallback(async (): Promise<RiskAnalysisView[]> => {
    const response = await fetch(`/api/systems/${systemId}/risk-analyses`);
    if (!response.ok) throw new Error("Failed to load the Risk Analyses");
    return (await response.json()).riskAnalyses ?? [];
  }, [systemId]);
  const { data: analyses, failed: loadError, reload: load } = useRemote(read);

  function changed() {
    setEditing(null);
    load();
    onRisksChanged();
    // The timeline and the header's figures are read on the server.
    router.refresh();
  }

  const beingEdited = analyses?.find((analysis) => analysis.id === editing) ?? null;
  return (
    <section className="hc-card" aria-labelledby="sc-ra-h">
      <div className="hc-card-h">
        <h2 id="sc-ra-h">Risk Analyses</h2>
        {canRecord && editing === null && (
          <button type="button" className="hc-btn primary" onClick={() => setEditing("new")}>
            + Record Risk Analysis
          </button>
        )}
      </div>
      <div className="hc-card-b sc-risks">
        {editing !== null && (editing === "new" || beingEdited) && (
          <div className="sc-risks-form">
            <AnalysisForm
              key={editing}
              systemId={systemId}
              existing={editing === "new" ? null : beingEdited}
              people={people}
              openRisks={openRisks}
              onSaved={changed}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
        {loadError && (
          <p role="alert" className="sc-err sc-risks-form">
            Couldn&apos;t load the Risk Analyses.{" "}
            <button type="button" className="sc-link" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {analyses === null ? (
          !loadError && (
            <p role="status" className="hc-empty sc-risks-form">
              Loading Risk Analyses…
            </p>
          )
        ) : analyses.length === 0 ? (
          <p className="hc-empty">No Risk Analysis has been recorded for this System.</p>
        ) : (
          <ul className="sc-analyses" aria-label="Risk Analyses">
            {analyses.map((analysis) => (
              <AnalysisEntry key={analysis.id} systemId={systemId} analysis={analysis} canRecord={canRecord} onEdit={() => setEditing(analysis.id)} onChanged={changed} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

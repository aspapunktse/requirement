"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusChip } from "@/components/ui/StatusChip";
import { Ring } from "@/app/home/HomeGraphics";
import { evaluationSteps, EVALUATION_STAGE_LABEL, STEP_INFO, TRACK_LABEL, type Step, type StepKey } from "@/lib/evaluation-stages";
import type { EvaluationOagParticipantView, EvaluationParticipantView, EvaluationView, GateView } from "@/lib/evaluation";
import { formatDay } from "./system-page-logic";
import { RiskAnalysisRecord, RiskSummary, StageDocumentation } from "./StageCards";
import { useRemote } from "./use-remote";
import "./system-evaluation.css";

const STEP_TONE = { done: "var(--rg-success)", now: "var(--rg-gold)", todo: "var(--rg-line)" } as const;

/** The stepper, as in design proposal A: one cell per step of the flow, the current one marked. */
function Stepper({ steps, selected, onSelect }: { steps: Step[]; selected: StepKey; onSelect: (key: StepKey) => void }) {
  return (
    <ol className="ev-stepper" aria-label="Evaluation stages">
      {steps.map((step) => (
        <li key={step.key} className={`ev-step ${step.state}`}>
          <button type="button" aria-current={step.state === "now" ? "step" : undefined} aria-pressed={selected === step.key} onClick={() => onSelect(step.key)}>
            <span className="bar" style={{ background: STEP_TONE[step.state] }} aria-hidden="true" />
            <span className="lbl">{step.label}</span>
            <span className="sr-only">{step.state === "done" ? ", done" : step.state === "now" ? ", current" : ", later"}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The two Tracks, with the chosen one marked, and what each leads to. */
function TracksStrip({ track }: { track: EvaluationView["track"] }) {
  return (
    <ul className="ev-tracks" aria-label="Tracks">
      {(["SELF", "FULL"] as const).map((key) => (
        <li key={key} className={track === key ? "chosen" : track === null ? "" : "other"}>
          <b>{TRACK_LABEL[key]}</b>
          <span>{key === "SELF" ? "Straight to the second round" : "Qualification, documentation and OG2 first"}</span>
          {track === key && <StatusChip tone="accent">Chosen at OG1</StatusChip>}
        </li>
      ))}
    </ul>
  );
}

/** The first-round checklist and its Submit (F-ST.2). */
function FirstRoundCard({ systemId, evaluation, onDone }: { systemId: string; evaluation: EvaluationView; onDone: () => void }) {
  const readiness = evaluation.firstRound;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!readiness) return null;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/evaluation/submit-first-round`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Couldn't submit the first round");
        return;
      }
      onDone();
    } catch {
      setError("Couldn't submit the first round");
    } finally {
      setBusy(false);
    }
  }

  const checks: { key: string; ok: boolean; text: string }[] = [
    {
      key: "level",
      ok: readiness.hasSensitivityLevel && readiness.belowInformationTypes === null,
      text: !readiness.hasSensitivityLevel
        ? "No Sensitivity Level yet (set it on the Profile tab)"
        : readiness.belowInformationTypes
          ? readiness.belowInformationTypes.replace(/^Cannot submit: /, "")
          : "The Sensitivity Level is set",
    },
    { key: "bso", ok: readiness.hasBusinessSystemOwner, text: readiness.hasBusinessSystemOwner ? "A Business System Owner is set" : "No Business System Owner yet (set it on the Profile tab)" },
    { key: "ra", ok: readiness.riskAnalysisCompleted, text: readiness.riskAnalysisCompleted ? "A Risk Analysis is completed" : "No completed Risk Analysis yet (record one on the Risks tab)" },
    {
      key: "controls",
      ok: readiness.mandatoryMissing.length === 0,
      text: `${readiness.mandatoryTotal - readiness.mandatoryMissing.length} of ${readiness.mandatoryTotal} mandatory first-round Controls have an Assessment`,
    },
  ];

  return (
    <section className="hc-card ev-card" aria-labelledby="ev-first-h">
      <div className="hc-card-h">
        <h2 id="ev-first-h">First round</h2>
        <p>{STEP_INFO.FIRST_ROUND.hint}</p>
      </div>
      <div className="hc-card-b">
        <ul className="ev-checks" aria-label="First-round checklist">
          {checks.map((check) => (
            <li key={check.key} className={check.ok ? "ok" : "todo"}>
              <span className="mark" aria-hidden="true">
                {check.ok ? "✓" : "○"}
              </span>
              <span>{check.text}</span>
            </li>
          ))}
        </ul>
        {readiness.mandatoryMissing.length > 0 && (
          <p className="ev-missing">Still without an Assessment: {readiness.mandatoryMissing.map((control) => `${control.code} (${control.title})`).join(", ")}</p>
        )}
        {error && (
          <p role="alert" className="sc-err">
            {error}
          </p>
        )}
        {evaluation.canSubmit ? (
          <div className="sc-btnrow ev-actions">
            <button type="button" className="hc-btn primary" disabled={busy || !readiness.ready} onClick={submit}>
              Submit the first round
            </button>
            {!readiness.ready && <span className="ev-hint">Complete the checklist first</span>}
          </div>
        ) : (
          <p className="ev-hint">The System&apos;s owner or an Admin submits the first round.</p>
        )}
      </div>
    </section>
  );
}

/** A verdict form for a participant the viewer may answer for (an addition to proposal A, which shows verdicts only). */
function VerdictForm({ systemId, participant, onDone }: { systemId: string; participant: EvaluationParticipantView; onDone: () => void }) {
  const [verdict, setVerdict] = useState<"SELF" | "FULL">("SELF");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/evaluation/verdicts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewGroupId: participant.reviewGroupId, verdict, comment }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Couldn't give the verdict");
        return;
      }
      onDone();
    } catch {
      setError("Couldn't give the verdict");
    } finally {
      setBusy(false);
    }
  }

  const name = `ev-verdict-${participant.reviewGroupId ?? "base"}`;
  return (
    <form className="sc-form ev-form" onSubmit={submit} aria-label={`Verdict for ${participant.name}`}>
      <fieldset className="sc-field">
        <legend>Verdict for {participant.name}</legend>
        <div className="ev-radios">
          {(["SELF", "FULL"] as const).map((key) => (
            <label key={key}>
              <input type="radio" name={name} value={key} checked={verdict === key} onChange={() => setVerdict(key)} />
              {TRACK_LABEL[key]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="sc-field">
        <span>Comment</span>
        <textarea rows={2} value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} required />
      </label>
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      <div className="sc-btnrow">
        <button type="submit" className="hc-btn primary" disabled={busy || comment.trim() === ""}>
          Give verdict
        </button>
      </div>
    </form>
  );
}

/** OG1: each participant's verdict, shown as the group's, and the outcome line (any Full means the Full track). */
function Og1Card({ systemId, evaluation, onDone }: { systemId: string; evaluation: EvaluationView; onDone: () => void }) {
  const og1 = evaluation.og1;
  if (!og1) {
    return (
      <section className="hc-card ev-card" aria-labelledby="ev-og1-h">
        <div className="hc-card-h">
          <h2 id="ev-og1-h">OG1: choose the Track</h2>
        </div>
        <div className="hc-card-b">
          <p className="hc-empty">{STEP_INFO.OG1.hint} It opens once the first round is submitted.</p>
        </div>
      </section>
    );
  }
  const given = og1.participants.filter((participant) => participant.verdict !== null);
  const anyFull = given.some((participant) => participant.verdict?.verdict === "FULL");
  const open = og1.participants.length - given.length;

  let outcome: string;
  if (!og1.open) outcome = `OG1 closed: the ${TRACK_LABEL[og1.track ?? "SELF"]} track.`;
  else if (anyFull) outcome = "At least one Full verdict: once everyone has answered, the Full track follows.";
  else outcome = "Any Full verdict sends the System to the Full track; if everyone answers Self it goes to the second round.";

  return (
    <section className="hc-card ev-card" aria-labelledby="ev-og1-h">
      <div className="hc-card-h">
        <h2 id="ev-og1-h">OG1: choose the Track</h2>
        <p>{og1.open ? `${given.length} of ${og1.participants.length} verdicts given` : "Closed"}</p>
      </div>
      <div className="hc-card-b">
        {og1.participants.length === 0 ? (
          <p className="hc-empty">Nobody takes part in OG1.</p>
        ) : (
          <ul className="ev-verdicts" aria-label="OG1 verdicts">
            {og1.participants.map((participant) => (
              <li key={participant.reviewGroupId ?? "base"}>
                <div className="ev-vrow">
                  <b>{participant.name}</b>
                  {participant.verdict ? (
                    <StatusChip tone={participant.verdict.verdict === "FULL" ? "warn" : "success"}>{TRACK_LABEL[participant.verdict.verdict]}</StatusChip>
                  ) : (
                    <StatusChip tone="neutral">Open</StatusChip>
                  )}
                </div>
                {participant.verdict && (
                  <p className="ev-comment">
                    {participant.verdict.comment}
                    <span className="ev-when">
                      {" "}
                      {formatDay(participant.verdict.givenAt)}
                      {participant.verdict.by ? ` · ${participant.verdict.by}` : ""}
                    </span>
                  </p>
                )}
                {participant.reopened && (
                  <p className="ev-reopened">
                    Reopened {formatDay(participant.reopened.at)}: {participant.reopened.reason}
                  </p>
                )}
                {participant.canGive && <VerdictForm systemId={systemId} participant={participant} onDone={onDone} />}
              </li>
            ))}
          </ul>
        )}
        <p className="ev-outcome" aria-live="polite">
          {outcome}
          {og1.open && open > 0 ? ` ${open} still to answer.` : ""}
        </p>
      </div>
    </section>
  );
}

/** The second-round checklist and its Submit (F-ST.2): every mandatory Control assessed, every second-round Document Requirement provided. */
function SecondRoundCard({ systemId, evaluation, onDone }: { systemId: string; evaluation: EvaluationView; onDone: () => void }) {
  const readiness = evaluation.secondRound;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!readiness) return null;

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/evaluation/submit-second-round`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Couldn't submit the second round");
        return;
      }
      onDone();
    } catch {
      setError("Couldn't submit the second round");
    } finally {
      setBusy(false);
    }
  }

  const checks: { key: string; ok: boolean; text: string }[] = [
    {
      key: "controls",
      ok: readiness.mandatoryMissing.length === 0,
      text: `${readiness.mandatoryTotal - readiness.mandatoryMissing.length} of ${readiness.mandatoryTotal} mandatory Controls have an Assessment`,
    },
    {
      key: "docs",
      ok: readiness.documentsMissing.length === 0,
      text: readiness.documentsMissing.length === 0 ? "Every second-round Document Requirement is provided" : "Second-round documentation is not all provided (see the Documentation tab)",
    },
  ];

  return (
    <section className="hc-card ev-card" aria-labelledby="ev-second-h">
      <div className="hc-card-h">
        <h2 id="ev-second-h">Second round</h2>
        <p>{STEP_INFO.SECOND_ROUND.hint}</p>
      </div>
      <div className="hc-card-b">
        <ul className="ev-checks" aria-label="Second-round checklist">
          {checks.map((check) => (
            <li key={check.key} className={check.ok ? "ok" : "todo"}>
              <span className="mark" aria-hidden="true">
                {check.ok ? "✓" : "○"}
              </span>
              <span>{check.text}</span>
            </li>
          ))}
        </ul>
        {readiness.mandatoryMissing.length > 0 && (
          <p className="ev-missing">Still without an Assessment: {readiness.mandatoryMissing.map((control) => `${control.code} (${control.title})`).join(", ")}</p>
        )}
        {readiness.documentsMissing.length > 0 && <p className="ev-missing">Not yet provided: {readiness.documentsMissing.map((document) => document.name).join(", ")}</p>}
        {error && (
          <p role="alert" className="sc-err">
            {error}
          </p>
        )}
        {evaluation.canSubmit ? (
          <div className="sc-btnrow ev-actions">
            <button type="button" className="hc-btn primary" disabled={busy || !readiness.ready} onClick={submit}>
              Submit the second round
            </button>
            {!readiness.ready && <span className="ev-hint">Complete the checklist first</span>}
          </div>
        ) : (
          <p className="ev-hint">The System&apos;s owner or an Admin submits the second round.</p>
        )}
        <StageDocumentation systemId={systemId} stage="SECOND_ROUND" track={evaluation.track} />
      </div>
    </section>
  );
}

/** The decisions made at gates, newest last: who, what and why (the System's history also has each as a Change Event). */
function DecisionLog({ decisions }: { decisions: EvaluationView["decisions"] }) {
  if (decisions.length === 0) return null;
  return (
    <ul className="ev-verdicts" aria-label="Gate decisions">
      {decisions.map((decision) => (
        <li key={`${decision.decidedAt}-${decision.outcome}`}>
          <div className="ev-vrow">
            <b>{outcomeLabel(decision.gate, decision.outcome)}</b>
            <StatusChip tone={decision.outcome === "AUTHORIZE" ? "success" : decision.outcome === "REJECT" ? "danger" : "warn"}>
              {decision.outcome === "SEND_BACK" && decision.sentBackTo ? `Back to ${EVALUATION_STAGE_LABEL[decision.sentBackTo]}` : outcomeLabel(decision.gate, decision.outcome)}
            </StatusChip>
          </div>
          {decision.justification && <p className="ev-justification">Justification for proceeding against advice: {decision.justification}</p>}
          <p className="ev-comment">
            {decision.comment}
            <span className="ev-when">
              {" "}
              {formatDay(decision.decidedAt)} · {decision.by}
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

const OUTCOME_LABEL = { AUTHORIZE: "Authorized to operate", REJECT: "Rejected", SEND_BACK: "Sent back" } as const;

/** What a decision is called at its gate: AUTHORIZE is "Yes" at Qualification, "Proceed" at OG2 and the ATO at OG3. */
function outcomeLabel(gate: EvaluationView["decisions"][number]["gate"], outcome: keyof typeof OUTCOME_LABEL): string {
  if (gate === "OG3") return OUTCOME_LABEL[outcome];
  const authorize = gate === "QUALIFICATION" ? "Qualified" : "Proceeded";
  return `${EVALUATION_STAGE_LABEL[gate]}: ${outcome === "AUTHORIZE" ? authorize : OUTCOME_LABEL[outcome]}`;
}

const GATE_FORM = {
  QUALIFICATION: { slug: "qualification-decision", label: "Qualification", yes: "Yes: qualified", yesButton: "Qualify the System" },
  OG2: { slug: "og2-decision", label: "OG2", yes: "Proceed", yesButton: "Proceed" },
  OG3: { slug: "og3-decision", label: "OG3", yes: "Authorize to operate", yesButton: "Authorize to operate" },
} as const;

/**
 * The decision form of the Business System Owner (or an Admin) at a gate: yes / proceed / authorize, reject (final) or send back to an
 * earlier stage. At OG2, when a group advised against, proceeding needs a written justification.
 */
function GateDecisionForm({ systemId, gate, view, adviseAgainst = false, onDone }: { systemId: string; gate: keyof typeof GATE_FORM; view: GateView; adviseAgainst?: boolean; onDone: () => void }) {
  const text = GATE_FORM[gate];
  const [decision, setDecision] = useState<"AUTHORIZE" | "REJECT" | "SEND_BACK">("AUTHORIZE");
  const [sendBackTo, setSendBackTo] = useState<string>(view.sendBackTargets[view.sendBackTargets.length - 1] ?? "FIRST_ROUND");
  const [comment, setComment] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsJustification = gate === "OG2" && adviseAgainst && decision === "AUTHORIZE";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/evaluation/${text.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          comment,
          ...(decision === "SEND_BACK" ? { sendBackTo } : {}),
          ...(needsJustification ? { justification } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Couldn't record the decision");
        return;
      }
      onDone();
    } catch {
      setError("Couldn't record the decision");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="sc-form ev-form" onSubmit={submit} aria-label={`${text.label} decision`}>
      <fieldset className="sc-field">
        <legend>Your decision</legend>
        <div className="ev-radios">
          {(
            [
              ["AUTHORIZE", text.yes],
              ["REJECT", "Reject"],
              ["SEND_BACK", "Send back"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input type="radio" name={`ev-${text.slug}`} value={key} checked={decision === key} onChange={() => setDecision(key)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      {decision === "SEND_BACK" && (
        <label className="sc-field">
          <span>Send back to</span>
          <select value={sendBackTo} onChange={(event) => setSendBackTo(event.target.value)}>
            {view.sendBackTargets.map((stage) => (
              <option key={stage} value={stage}>
                {EVALUATION_STAGE_LABEL[stage]}
                {stage === "FIRST_ROUND" ? ": OG1 runs again" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {decision === "REJECT" && <p className="sc-callout warn">Reject is final. The System is closed and read-only for everyone.</p>}
      {needsJustification && (
        <label className="sc-field">
          <span>Justification for proceeding against an Advise-against</span>
          <textarea rows={2} value={justification} maxLength={2000} onChange={(event) => setJustification(event.target.value)} required />
        </label>
      )}
      <label className="sc-field">
        <span>Comment</span>
        <textarea rows={2} value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} required />
      </label>
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      <div className="sc-btnrow">
        <button
          type="submit"
          className={`hc-btn ${decision === "REJECT" ? "reject" : "primary"}`}
          disabled={busy || comment.trim() === "" || (needsJustification && justification.trim() === "")}
        >
          {decision === "AUTHORIZE" ? text.yesButton : decision === "REJECT" ? "Reject the System" : "Send back"}
        </button>
      </div>
    </form>
  );
}

/** OG3: the Business System Owner decides whether the System may operate; open Risks never block it, they are shown (the Risk summary) beside it. */
function Og3Card({ systemId, evaluation, atGate, onDone }: { systemId: string; evaluation: EvaluationView; atGate: boolean; onDone: () => void }) {
  return (
    <section className="hc-card ev-card" aria-labelledby="ev-og3-h">
      <div className="hc-card-h">
        <h2 id="ev-og3-h">{STEP_INFO.OG3.long}</h2>
        <p>{STEP_INFO.OG3.hint}</p>
      </div>
      <div className="hc-card-b">
        {evaluation.closed ? (
          <p className="ev-outcome" aria-live="polite">
            Rejected at {evaluation.closedAt ? EVALUATION_STAGE_LABEL[evaluation.closedAt] : "OG3"}. The System is closed and read-only.
          </p>
        ) : evaluation.authorized ? (
          <p className="ev-outcome" aria-live="polite">
            Authorized to operate (ATO). The System&apos;s owner or an Admin marks it Onboarded when the cutover has happened.
          </p>
        ) : evaluation.og3 ? (
          evaluation.og3.canDecide ? (
            <GateDecisionForm systemId={systemId} gate="OG3" view={evaluation.og3} onDone={onDone} />
          ) : (
            <p className="ev-hint">The System&apos;s Business System Owner (or an Admin who doesn&apos;t own it) decides. Open Risks don&apos;t block the decision.</p>
          )
        ) : (
          !atGate && <p className="hc-empty">{STEP_INFO.OG3.hint} It opens once the earlier stages are done.</p>
        )}
        <DecisionLog decisions={evaluation.decisions.filter((decision) => decision.gate === "OG3")} />
      </div>
    </section>
  );
}

/** Qualification (Full track): the Business System Owner decides whether the System is worth a full evaluation. */
function QualificationCard({ systemId, evaluation, atGate, onDone }: { systemId: string; evaluation: EvaluationView; atGate: boolean; onDone: () => void }) {
  return (
    <section className="hc-card ev-card" aria-labelledby="ev-q-h">
      <div className="hc-card-h">
        <h2 id="ev-q-h">{STEP_INFO.QUALIFICATION.long}</h2>
        <p>{STEP_INFO.QUALIFICATION.hint}</p>
      </div>
      <div className="hc-card-b">
        {evaluation.qualification ? (
          evaluation.qualification.canDecide ? (
            <GateDecisionForm systemId={systemId} gate="QUALIFICATION" view={evaluation.qualification} onDone={onDone} />
          ) : (
            <p className="ev-hint">The System&apos;s Business System Owner (or an Admin who doesn&apos;t own it) decides.</p>
          )
        ) : (
          !atGate && evaluation.decisions.length === 0 && <p className="hc-empty">{STEP_INFO.QUALIFICATION.hint} It opens once OG1 has chosen the Full track.</p>
        )}
        <DecisionLog decisions={evaluation.decisions.filter((decision) => decision.gate === "QUALIFICATION")} />
      </div>
    </section>
  );
}

/** The first-documentation checklist and its Submit (F-ST.4): every Full-track first-documentation Document Requirement provided. */
function FirstDocumentationCard({ systemId, evaluation, shownState, onDone }: { systemId: string; evaluation: EvaluationView; shownState: Step["state"]; onDone: () => void }) {
  const readiness = evaluation.firstDocumentation;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/evaluation/submit-first-documentation`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Couldn't submit the first documentation");
        return;
      }
      onDone();
    } catch {
      setError("Couldn't submit the first documentation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="hc-card ev-card" aria-labelledby="ev-docs-h">
      <div className="hc-card-h">
        <h2 id="ev-docs-h">{STEP_INFO.FIRST_DOCUMENTATION.long}</h2>
        <p>{STEP_INFO.FIRST_DOCUMENTATION.hint}</p>
      </div>
      <div className="hc-card-b">
        {readiness && (
          <>
            <ul className="ev-checks" aria-label="First-documentation checklist">
              <li className={readiness.documentsMissing.length === 0 ? "ok" : "todo"}>
                <span className="mark" aria-hidden="true">
                  {readiness.documentsMissing.length === 0 ? "✓" : "○"}
                </span>
                <span>{readiness.documentsMissing.length === 0 ? "Every first-documentation Document Requirement is provided" : "First documentation is not all provided (see below)"}</span>
              </li>
            </ul>
            {readiness.documentsMissing.length > 0 && <p className="ev-missing">Not yet provided: {readiness.documentsMissing.map((document) => document.name).join(", ")}</p>}
            {error && (
              <p role="alert" className="sc-err">
                {error}
              </p>
            )}
            {evaluation.canSubmit ? (
              <div className="sc-btnrow ev-actions">
                <button type="button" className="hc-btn primary" disabled={busy || !readiness.ready} onClick={submit}>
                  Submit the first documentation
                </button>
                {!readiness.ready && <span className="ev-hint">Provide every Document Requirement first</span>}
              </div>
            ) : (
              <p className="ev-hint">The System&apos;s owner or an Admin submits the first documentation.</p>
            )}
          </>
        )}
        {shownState === "todo" && <p className="hc-empty">It opens once Qualification is passed.</p>}
        <StageDocumentation systemId={systemId} stage="FIRST_DOCUMENTATION" track={evaluation.track} />
      </div>
    </section>
  );
}

const RECOMMENDATION_TONE = { RECOMMEND: "success", RECOMMEND_WITH_CONDITIONS: "warn", ADVISE_AGAINST: "danger" } as const;
const RECOMMENDATION_TEXT = { RECOMMEND: "Recommend", RECOMMEND_WITH_CONDITIONS: "Recommend with conditions", ADVISE_AGAINST: "Advise against" } as const;
type RecommendationKindValue = keyof typeof RECOMMENDATION_TEXT;

/** A Recommendation form for a group the viewer may answer for. Conditions are free text in the comment. */
function RecommendationForm({ systemId, participant, onDone }: { systemId: string; participant: EvaluationOagParticipantView; onDone: () => void }) {
  const [kind, setKind] = useState<RecommendationKindValue>("RECOMMEND");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/evaluation/recommendations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewGroupId: participant.reviewGroupId, kind, comment }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Couldn't give the Recommendation");
        return;
      }
      onDone();
    } catch {
      setError("Couldn't give the Recommendation");
    } finally {
      setBusy(false);
    }
  }

  const name = `ev-recommendation-${participant.reviewGroupId ?? "base"}`;
  return (
    <form className="sc-form ev-form" onSubmit={submit} aria-label={`Recommendation for ${participant.name}`}>
      <fieldset className="sc-field">
        <legend>Recommendation for {participant.name}</legend>
        <div className="ev-radios">
          {(Object.keys(RECOMMENDATION_TEXT) as RecommendationKindValue[]).map((key) => (
            <label key={key}>
              <input type="radio" name={name} value={key} checked={kind === key} onChange={() => setKind(key)} />
              {RECOMMENDATION_TEXT[key]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="sc-field">
        <span>{kind === "RECOMMEND_WITH_CONDITIONS" ? "Comment (state the conditions)" : "Comment"}</span>
        <textarea rows={2} value={comment} maxLength={2000} onChange={(event) => setComment(event.target.value)} required />
      </label>
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      <div className="sc-btnrow">
        <button type="submit" className="hc-btn primary" disabled={busy || comment.trim() === ""}>
          Give Recommendation
        </button>
      </div>
    </form>
  );
}

/** Each group's Recommendation, shown as the group's, with the BSO's justification next to an Advise-against once it exists. */
function RecommendationList({ systemId, oag, justification, onDone }: { systemId: string; oag: NonNullable<EvaluationView["oag"]>; justification: string | null; onDone: () => void }) {
  if (oag.participants.length === 0) return <p className="hc-empty">No Recommendations were given.</p>;
  return (
    <ul className="ev-verdicts" aria-label="Recommendations">
      {oag.participants.map((participant) => (
        <li key={participant.reviewGroupId ?? "base"}>
          <div className="ev-vrow">
            <b>{participant.name}</b>
            {participant.recommendation ? (
              <StatusChip tone={RECOMMENDATION_TONE[participant.recommendation.kind]}>{RECOMMENDATION_TEXT[participant.recommendation.kind]}</StatusChip>
            ) : (
              <StatusChip tone="neutral">Open</StatusChip>
            )}
          </div>
          {participant.recommendation && (
            <p className="ev-comment">
              {participant.recommendation.comment}
              <span className="ev-when">
                {" "}
                {formatDay(participant.recommendation.givenAt)}
                {participant.recommendation.by ? ` · ${participant.recommendation.by}` : ""}
              </span>
            </p>
          )}
          {participant.recommendation?.kind === "ADVISE_AGAINST" && justification && <p className="ev-justification">Justification for proceeding against this advice: {justification}</p>}
          {participant.reopened && (
            <p className="ev-reopened">
              Reopened {formatDay(participant.reopened.at)}: {participant.reopened.reason}
            </p>
          )}
          {participant.canGive && <RecommendationForm systemId={systemId} participant={participant} onDone={onDone} />}
        </li>
      ))}
    </ul>
  );
}

/** The OAG review (before OG2): each group gives a Recommendation; once every group has, the System moves to OG2. */
function OagReviewCard({ systemId, evaluation, onDone }: { systemId: string; evaluation: EvaluationView; onDone: () => void }) {
  const oag = evaluation.oag;
  const given = oag ? oag.participants.filter((participant) => participant.recommendation !== null).length : 0;
  return (
    <section className="hc-card ev-card" aria-labelledby="ev-oag-h">
      <div className="hc-card-h">
        <h2 id="ev-oag-h">{STEP_INFO.OAG_REVIEW_1.long}</h2>
        <p>{oag ? (oag.open ? `${given} of ${oag.participants.length} Recommendations given` : "Closed") : STEP_INFO.OAG_REVIEW_1.hint}</p>
      </div>
      <div className="hc-card-b">
        {oag ? (
          <>
            <RecommendationList systemId={systemId} oag={oag} justification={evaluation.og2Justification} onDone={onDone} />
            <p className="ev-outcome" aria-live="polite">
              {oag.open ? `The System moves to OG2 once every group has recommended. ${oag.participants.length - given} still to answer.` : "The OAG review is closed."}
            </p>
          </>
        ) : (
          <p className="hc-empty">{STEP_INFO.OAG_REVIEW_1.hint} It opens once the first documentation is submitted.</p>
        )}
      </div>
    </section>
  );
}

/** OG2: the Business System Owner sees every Recommendation, then decides whether the System proceeds; open Risks never block it. */
function Og2Card({ systemId, evaluation, atGate, onDone }: { systemId: string; evaluation: EvaluationView; atGate: boolean; onDone: () => void }) {
  return (
    <section className="hc-card ev-card" aria-labelledby="ev-og2-h">
      <div className="hc-card-h">
        <h2 id="ev-og2-h">{STEP_INFO.OG2.long}</h2>
        <p>{STEP_INFO.OG2.hint}</p>
      </div>
      <div className="hc-card-b">
        {evaluation.oag && <RecommendationList systemId={systemId} oag={evaluation.oag} justification={evaluation.og2Justification} onDone={onDone} />}
        {evaluation.og2 ? (
          evaluation.og2.canDecide ? (
            <GateDecisionForm systemId={systemId} gate="OG2" view={evaluation.og2} adviseAgainst={evaluation.og2.adviseAgainst} onDone={onDone} />
          ) : (
            <p className="ev-hint">The System&apos;s Business System Owner (or an Admin who doesn&apos;t own it) decides. Open Risks don&apos;t block the decision.</p>
          )
        ) : (
          !atGate && !evaluation.oag && <p className="hc-empty">{STEP_INFO.OG2.hint} It opens once the OAG review is done.</p>
        )}
        <DecisionLog decisions={evaluation.decisions.filter((decision) => decision.gate === "OG2")} />
      </div>
    </section>
  );
}

/** The Risk Analysis stage: waiting for a Risk Owner or an Admin who isn't the System's owner to complete one, then done. */
function RiskAnalysisStageCard({ systemId, evaluation, shown }: { systemId: string; evaluation: EvaluationView; shown: "RISK_ANALYSIS_1" | "RISK_ANALYSIS_2" }) {
  const waiting = shown === "RISK_ANALYSIS_2" && evaluation.stage === "RISK_ANALYSIS_2";
  return (
    <section className="hc-card ev-card" aria-labelledby="ev-ra-h">
      <div className="hc-card-h">
        <h2 id="ev-ra-h">{STEP_INFO[shown].long}</h2>
        <p>{STEP_INFO[shown].hint}</p>
      </div>
      <div className="hc-card-b">
        {waiting && (
          <p className="ev-hint" aria-live="polite">
            {evaluation.canRecordRiskAnalysis
              ? "The second round is submitted. Record a Risk Analysis on the Risks tab and complete it: the System then moves on to OG3."
              : "The second round is submitted. A Risk Owner or an Admin who isn't the System's owner completes a Risk Analysis, and the System then moves on to OG3."}
          </p>
        )}
        <RiskAnalysisRecord systemId={systemId} />
      </div>
    </section>
  );
}

/**
 * The Evaluation tab of a staged System (#328, design proposal A "Stepper", PRD 0002): where the System is in its flow, the Tracks,
 * and the card of the selected stage (the current one to start with): the first-round checklist with its Submit, the OG1
 * verdicts, then Qualification, first documentation, the OAG review and OG2 (Full track, #331), the second round and its Risk Analysis. Later stages are shown in the stepper and have no actions yet. Reads `GET /api/systems/[id]/evaluation`; after an
 * action it reads again and refreshes the page, so the header follows.
 */
export function SystemEvaluation({ systemId }: { systemId: string }) {
  const router = useRouter();
  const read = useCallback(async () => {
    const response = await fetch(`/api/systems/${systemId}/evaluation`);
    if (!response.ok) throw new Error("read failed");
    return ((await response.json()) as { evaluation: EvaluationView }).evaluation;
  }, [systemId]);
  const { data: evaluation, failed, reload } = useRemote(read);
  const [selected, setSelected] = useState<StepKey | null>(null);

  if (!evaluation) {
    return failed ? (
      <p role="alert" className="sc-error">
        Couldn&apos;t load the evaluation.
      </p>
    ) : (
      <p className="hc-empty">Loading the evaluation…</p>
    );
  }

  const steps = evaluationSteps({
    stage: evaluation.stage,
    track: evaluation.track,
    riskAnalysisCompleted: evaluation.firstRound ? evaluation.firstRound.riskAnalysisCompleted : true,
  });
  const done = steps.filter((step) => step.state === "done").length;
  const current = steps.find((step) => step.state === "now");
  const shown: StepKey = selected ?? current?.key ?? "FIRST_ROUND";
  const shownStep = steps.find((step) => step.key === shown);
  const laterShown = !["FIRST_ROUND", "RISK_ANALYSIS_1", "RISK_ANALYSIS_2", "SECOND_ROUND", "OG1", "OG3", "FIRST_DOCUMENTATION", "QUALIFICATION", "OAG_REVIEW_1", "OG2"].includes(shown);
  // As in proposal A: the Risk summary sits with every stage card but a current gate other than OG1, which weighs it elsewhere.
  const showRiskSummary = !(shownStep && shownStep.kind === "gate" && shown !== "OG1" && shown !== "OG2" && shown !== "OG3" && shownStep.state === "now");
  const afterAction = () => {
    setSelected(null);
    reload();
    router.refresh();
  };

  return (
    <div className="ev">
      {failed && (
        <p role="alert" className="sc-error">
          Couldn&apos;t refresh the evaluation; what follows may be out of date.
        </p>
      )}
      {evaluation.closed && (
        <p role="status" className="sc-callout warn">
          <b>Closed.</b> The Business System Owner rejected this System at {evaluation.closedAt ? EVALUATION_STAGE_LABEL[evaluation.closedAt] : "OG3"}. It is read-only for everyone.
        </p>
      )}
      <section className="hc-card ev-head" aria-label="Evaluation progress">
        <Ring segments={[[done / steps.length, "var(--rg-success)"]]} size={88} stroke={10} center={`${done}/${steps.length}`} label={`${done} of ${steps.length} steps done`} />
        <div className="ev-head-text">
          <h2>{evaluation.closed ? `Rejected at ${evaluation.closedAt ? EVALUATION_STAGE_LABEL[evaluation.closedAt] : "OG3"}` : evaluation.authorized ? "Authorized to operate (ATO)" : current ? STEP_INFO[current.key].long : EVALUATION_STAGE_LABEL[evaluation.stage]}</h2>
          <p>
            {evaluation.track ? `${TRACK_LABEL[evaluation.track]} track` : "Track not chosen yet"} · in this stage since {formatDay(evaluation.stageEnteredAt)}
          </p>
        </div>
      </section>
      <Stepper steps={steps} selected={shown} onSelect={setSelected} />
      <TracksStrip track={evaluation.track} />

      {shown === "FIRST_ROUND" &&
        (evaluation.stage === "FIRST_ROUND" ? (
          <FirstRoundCard systemId={systemId} evaluation={evaluation} onDone={afterAction} />
        ) : (
          <section className="hc-card ev-card" aria-labelledby="ev-first-done-h">
            <div className="hc-card-h">
              <h2 id="ev-first-done-h">First round</h2>
              <p>Submitted</p>
            </div>
          </section>
        ))}
      {shown === "SECOND_ROUND" &&
        (shownStep?.state === "now" ? (
          <SecondRoundCard systemId={systemId} evaluation={evaluation} onDone={afterAction} />
        ) : (
          <section className="hc-card ev-card" aria-labelledby="ev-second-done-h">
            <div className="hc-card-h">
              <h2 id="ev-second-done-h">Second round</h2>
              <p>{shownStep?.state === "done" ? "Submitted" : "Not available yet"}</p>
            </div>
            <div className="hc-card-b">
              {shownStep?.state !== "done" && <p className="hc-empty">{STEP_INFO.SECOND_ROUND.hint} This stage isn&apos;t available yet.</p>}
              <StageDocumentation systemId={systemId} stage="SECOND_ROUND" track={evaluation.track} />
            </div>
          </section>
        ))}
      {(shown === "RISK_ANALYSIS_1" || shown === "RISK_ANALYSIS_2") && <RiskAnalysisStageCard systemId={systemId} evaluation={evaluation} shown={shown} />}
      {shown === "OG1" && <Og1Card systemId={systemId} evaluation={evaluation} onDone={afterAction} />}
      {shown === "OG3" && <Og3Card systemId={systemId} evaluation={evaluation} atGate={shownStep?.state === "now"} onDone={afterAction} />}
      {shown === "QUALIFICATION" && <QualificationCard systemId={systemId} evaluation={evaluation} atGate={shownStep?.state === "now"} onDone={afterAction} />}
      {shown === "FIRST_DOCUMENTATION" && <FirstDocumentationCard systemId={systemId} evaluation={evaluation} shownState={shownStep?.state ?? "todo"} onDone={afterAction} />}
      {shown === "OAG_REVIEW_1" && <OagReviewCard systemId={systemId} evaluation={evaluation} onDone={afterAction} />}
      {shown === "OG2" && <Og2Card systemId={systemId} evaluation={evaluation} atGate={shownStep?.state === "now"} onDone={afterAction} />}
      {laterShown && (
        <section className="hc-card ev-card" aria-labelledby="ev-later-h">
          <div className="hc-card-h">
            <h2 id="ev-later-h">{STEP_INFO[shown].long}</h2>
          </div>
          <div className="hc-card-b">
            <p className="hc-empty">{STEP_INFO[shown].hint} This stage isn&apos;t available yet.</p>
          </div>
        </section>
      )}
      {showRiskSummary && <RiskSummary systemId={systemId} />}
    </div>
  );
}

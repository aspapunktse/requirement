"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusChip } from "@/components/ui/StatusChip";
import { Ring } from "@/app/home/HomeGraphics";
import { evaluationSteps, EVALUATION_STAGE_LABEL, STEP_INFO, TRACK_LABEL, type Step, type StepKey } from "@/lib/evaluation-stages";
import type { EvaluationParticipantView, EvaluationView } from "@/lib/evaluation";
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
 * verdicts, then the second round (Self track) and its Risk Analysis. Later stages are shown in the stepper and have no actions yet. Reads `GET /api/systems/[id]/evaluation`; after an
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
  const laterShown = !["FIRST_ROUND", "RISK_ANALYSIS_1", "RISK_ANALYSIS_2", "SECOND_ROUND", "OG1", "FIRST_DOCUMENTATION"].includes(shown);
  // As in proposal A: the Risk summary sits with every stage card but a current gate other than OG1, which weighs it elsewhere.
  const showRiskSummary = !(shownStep && shownStep.kind === "gate" && shown !== "OG1" && shownStep.state === "now");
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
      <section className="hc-card ev-head" aria-label="Evaluation progress">
        <Ring segments={[[done / steps.length, "var(--rg-success)"]]} size={88} stroke={10} center={`${done}/${steps.length}`} label={`${done} of ${steps.length} steps done`} />
        <div className="ev-head-text">
          <h2>{current ? STEP_INFO[current.key].long : EVALUATION_STAGE_LABEL[evaluation.stage]}</h2>
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
      {shown === "FIRST_DOCUMENTATION" && (
        <section className="hc-card ev-card" aria-labelledby="ev-docs-h">
          <div className="hc-card-h">
            <h2 id="ev-docs-h">{STEP_INFO[shown].long}</h2>
            <p>{STEP_INFO[shown].hint}</p>
          </div>
          <div className="hc-card-b">
            <StageDocumentation systemId={systemId} stage="FIRST_DOCUMENTATION" track={evaluation.track} />
          </div>
        </section>
      )}
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

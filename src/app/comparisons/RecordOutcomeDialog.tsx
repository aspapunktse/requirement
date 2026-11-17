"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { isNotTopScorer } from "@/lib/comparison-outcome";
import { FIELD, Shell, send } from "./ComparisonDialogs";
import { chooseable } from "./comparison-logic";
import type { CandidateRow } from "./comparison-types";

/** The value of the "None chosen" option (a System id is never "none"). */
const NONE = "none";

/**
 * Where the "Close the others as Not selected" offer goes (#376). Recording the outcome closes the Comparison; the Not selected issue
 * adds, here, a choice per Candidate not chosen (the Candidates the acting user may close, never one that is authorized or Onboarded),
 * sent with the outcome. Nothing is offered yet, so it renders nothing. `chosenSystemId` is the pick (null while none is made,
 * "none" for None chosen).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function NotSelectedOffer(props: { candidates: readonly CandidateRow[]; chosenSystemId: string | null }) {
  return null;
}

/**
 * Record outcome (#375), design proposal B: pick the chosen Candidate or "None chosen" and write the comment (required). A Candidate
 * rejected at a gate is listed, disabled, with the reason. The dialog says that the Comparison closes and its figures freeze, and warns
 * (never blocks) when the pick is not the top scorer. Saves through `POST /api/comparisons/[id]/outcome`; the server applies the rules again.
 */
export function RecordOutcomeDialog({ id, candidates, onClose, onDone }: { id: string; candidates: readonly CandidateRow[]; onClose: () => void; onDone: () => void }) {
  const titleId = useId();
  const [pick, setPick] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const notTop = pick !== null && pick !== NONE && isNotTopScorer(pick, candidates);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pick === null) return setError("Pick the chosen Candidate, or None chosen");
    if (comment.trim() === "") return setError("A comment is required");
    setError(null);
    setSaving(true);
    const result = await send(`/api/comparisons/${id}/outcome`, "POST", { chosenSystemId: pick === NONE ? null : pick, comment });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onDone();
  }

  return (
    <Shell title="Record outcome" titleId={titleId} onClose={onClose} onSubmit={save}>
      <p className="text-rg-muted">
        This closes the Comparison. It becomes read-only, and each Candidate&apos;s score, counts and Control statuses are frozen as of today. The chosen Candidate does not have to be the top scorer.
      </p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-semibold">Who is chosen</legend>
        {candidates.map((candidate) => (
          <label key={candidate.systemId} className="flex items-start gap-2">
            <input type="radio" name="pick" className="mt-1" value={candidate.systemId} checked={pick === candidate.systemId} disabled={!chooseable(candidate)} onChange={() => setPick(candidate.systemId)} />
            <span>
              {candidate.name}
              <small className="block text-rg-muted">{chooseable(candidate) ? (candidate.vendor ?? "No vendor") : "Rejected at a gate: it can't be chosen."}</small>
            </span>
          </label>
        ))}
        <label className="flex items-start gap-2">
          <input type="radio" name="pick" className="mt-1" value={NONE} checked={pick === NONE} onChange={() => setPick(NONE)} />
          <span>
            None chosen
            <small className="block text-rg-muted">No Candidate meets the need.</small>
          </span>
        </label>
      </fieldset>
      {notTop && (
        <p role="note" className="cmp-note warn">
          This Candidate does not have the highest Comparison Score. You can still choose it; the page will say so.
        </p>
      )}
      <label className="flex flex-col gap-1 font-semibold">
        Comment (required)
        <textarea className={FIELD} rows={3} value={comment} placeholder="Why this one, or why none" onChange={(event) => setComment(event.target.value)} />
      </label>
      <NotSelectedOffer candidates={candidates} chosenSystemId={pick} />
      {error && (
        <p role="alert" className="text-rg-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={saving}>
          {saving ? "Recording…" : "Record outcome"}
        </Button>
      </div>
    </Shell>
  );
}

/** Reopening asks first: the outcome and the frozen figures are cleared. Systems closed as Not selected stay closed. */
export function ReopenComparisonDialog({ id, name, onClose, onDone }: { id: string; name: string; onClose: () => void; onDone: () => void }) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await send(`/api/comparisons/${id}/outcome`, "DELETE");
    setBusy(false);
    if (!result.ok) return setError(result.error);
    onDone();
  }

  return (
    <Shell title="Reopen this Comparison?" titleId={titleId} onClose={onClose} onSubmit={confirm}>
      <p>
        <b>{name}</b> is reopened: the recorded outcome and its comment are cleared, and the figures are live again. Systems closed as Not selected stay closed until an Admin reopens them.
      </p>
      {error && (
        <p role="alert" className="text-rg-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Reopening…" : "Reopen"}
        </Button>
      </div>
    </Shell>
  );
}

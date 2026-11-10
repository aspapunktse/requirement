"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { StatusChip } from "@/components/ui/StatusChip";
import { EVALUATION_STAGE_LABEL } from "@/lib/evaluation-stages";
import type { ChangeReviewView } from "@/lib/change-review";
import { formatDay } from "./system-page-logic";
import { useRemote } from "./use-remote";
import "./system-evaluation.css";

const RECOMMENDATION_TONE = { RECOMMEND: "success", RECOMMEND_WITH_CONDITIONS: "warn", ADVISE_AGAINST: "danger" } as const;
const RECOMMENDATION_TEXT = { RECOMMEND: "Recommend", RECOMMEND_WITH_CONDITIONS: "Recommend with conditions", ADVISE_AGAINST: "Advise against" } as const;
type Kind = keyof typeof RECOMMENDATION_TEXT;
type Participant = ChangeReviewView["participants"][number];

/** Posts JSON; null when it worked, otherwise the error text to show. */
async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return null;
    return ((await response.json().catch(() => ({}))) as { error?: string }).error ?? "That didn't work";
  } catch {
    return "That didn't work";
  }
}

function RecommendationForm({ systemId, changeReviewId, participant, onDone }: { systemId: string; changeReviewId: string; participant: Participant; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>("RECOMMEND");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const failure = await post(`/api/systems/${systemId}/change-review/recommendations`, { changeReviewId, reviewGroupId: participant.reviewGroupId, kind, comment });
    setBusy(false);
    if (failure) setError(failure);
    else onDone();
  }

  return (
    <form className="sc-form ev-form" onSubmit={submit} aria-label={`Recommendation for ${participant.name}`}>
      <fieldset className="sc-field">
        <legend>Recommendation for {participant.name}</legend>
        <div className="ev-radios">
          {(Object.keys(RECOMMENDATION_TEXT) as Kind[]).map((key) => (
            <label key={key}>
              <input type="radio" name={`cr-recommendation-${participant.reviewGroupId ?? "base"}`} value={key} checked={kind === key} onChange={() => setKind(key)} />
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

/** The Business System Owner's decision: accept the change, or revoke the ATO and send the System back to a stage they pick. */
function DecisionForm({ systemId, review, onDone }: { systemId: string; review: ChangeReviewView; onDone: () => void }) {
  const targets = review.sendBackTargets;
  const [decision, setDecision] = useState<"ACCEPT" | "REVOKE">("ACCEPT");
  const [sendBackTo, setSendBackTo] = useState<string>(targets?.[targets.length - 1] ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const failure = await post(`/api/systems/${systemId}/change-review/decision`, {
      decision,
      comment,
      changeReviewId: review.id,
      ...(decision === "REVOKE" && targets ? { sendBackTo } : {}),
    });
    setBusy(false);
    if (failure) setError(failure);
    else onDone();
  }

  return (
    <form className="sc-form ev-form" onSubmit={submit} aria-label="Change Review decision">
      <fieldset className="sc-field">
        <legend>Your decision</legend>
        <div className="ev-radios">
          <label>
            <input type="radio" name="cr-decision" value="ACCEPT" checked={decision === "ACCEPT"} onChange={() => setDecision("ACCEPT")} />
            Accept the change
          </label>
          <label>
            <input type="radio" name="cr-decision" value="REVOKE" checked={decision === "REVOKE"} onChange={() => setDecision("REVOKE")} />
            Revoke the ATO
          </label>
        </div>
      </fieldset>
      {decision === "REVOKE" && targets && (
        <label className="sc-field">
          <span>Send back to</span>
          <select value={sendBackTo} onChange={(event) => setSendBackTo(event.target.value)}>
            {targets.map((stage) => (
              <option key={stage} value={stage}>
                {EVALUATION_STAGE_LABEL[stage]}
                {stage === "FIRST_ROUND" ? ": OG1 runs again" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {decision === "REVOKE" && <p className="sc-callout warn">Revoking the ATO takes the System out of operations: it goes back to {targets ? "the stage you pick" : "Draft"}.</p>}
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
        <button type="submit" className={`hc-btn ${decision === "REVOKE" ? "reject" : "primary"}`} disabled={busy || comment.trim() === ""}>
          {decision === "ACCEPT" ? "Accept the change" : "Revoke the ATO"}
        </button>
      </div>
    </form>
  );
}

/**
 * The open Change Review of an Onboarded System (#334, PRD 0002 F-CR): the groups whose remit a change widened, each with the Controls
 * added to it and its Recommendation; the Business System Owner then accepts or revokes the ATO. Rendered by the System page only
 * while a review is open. Reads `GET /api/systems/[id]/change-review`; after an action it reads again and refreshes the page.
 */
export function SystemChangeReview({ systemId }: { systemId: string }) {
  const router = useRouter();
  const read = useCallback(async () => {
    const response = await fetch(`/api/systems/${systemId}/change-review`);
    if (!response.ok) throw new Error("read failed");
    return ((await response.json()) as { changeReview: ChangeReviewView | null }).changeReview;
  }, [systemId]);
  const { data: review, failed, reload } = useRemote(read);
  const afterAction = () => {
    reload();
    router.refresh();
  };

  if (!review) {
    return failed ? (
      <p role="alert" className="sc-error">
        Couldn&apos;t load the Change Review.
      </p>
    ) : null;
  }

  const given = review.participants.filter((participant) => participant.recommendation !== null).length;
  return (
    <section id="change-review" className="hc-card ev-card" aria-labelledby="cr-h">
      <div className="hc-card-h">
        <h2 id="cr-h">Change Review</h2>
        <p>
          Started {formatDay(review.startedAt)} · {given} of {review.participants.length} Recommendations given
        </p>
      </div>
      <div className="hc-card-b">
        <p className="sc-callout warn">
          A change added Controls to the remit of the groups below. The System stays Onboarded while they recommend on just those Controls and the Business System Owner decides.
        </p>
        <ul className="ev-verdicts" aria-label="Change Review Recommendations">
          {review.participants.map((participant) => (
            <li key={participant.reviewGroupId ?? "base"}>
              <div className="ev-vrow">
                <b>{participant.name}</b>
                {participant.recommendation ? (
                  <StatusChip tone={RECOMMENDATION_TONE[participant.recommendation.kind]}>{RECOMMENDATION_TEXT[participant.recommendation.kind]}</StatusChip>
                ) : (
                  <StatusChip tone="neutral">Open</StatusChip>
                )}
              </div>
              <p className="ev-hint">Added Controls: {participant.controls.map((control) => `${control.code} ${control.title}`).join("; ")}</p>
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
              {participant.reopened && (
                <p className="ev-reopened">
                  Reopened {formatDay(participant.reopened.at)}: {participant.reopened.reason}
                </p>
              )}
              {participant.canGive && <RecommendationForm systemId={systemId} changeReviewId={review.id} participant={participant} onDone={afterAction} />}
            </li>
          ))}
        </ul>
        {!review.hasBusinessSystemOwner && (
          <p role="status" className="sc-callout warn">
            This System has no Business System Owner. Its owner needs to set one before the Change Review can be decided.
          </p>
        )}
        {review.canDecide && review.hasBusinessSystemOwner && review.allRecommended && <DecisionForm systemId={systemId} review={review} onDone={afterAction} />}
        {review.canDecide && review.hasBusinessSystemOwner && !review.allRecommended && <p className="ev-hint">You can decide once every group has recommended.</p>}
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusChip, type ChipTone } from "@/components/ui/StatusChip";
import { onboardingStatusTone } from "@/lib/status-tones";

type Decision = "APPROVED" | "REJECTED";

type Approval = {
  id: string;
  decision: Decision;
  comment: string | null;
  decidedAt: string;
  stepName: string;
  /** The step's decision no longer counts: its group's step left the round (CONTEXT.md, Review Step). */
  voided?: boolean;
  /** Present only when the viewer may see who decided (an Admin, Internal Auditor, Compliance Manager or the step's deciders). */
  approver?: { name: string };
};

/** One Review Round: a submission of the System, with the decisions made in it (CONTEXT.md). */
type ReviewRound = { id: string; submittedAt: string; current: boolean; approvals: Approval[] };

type ReviewStep = {
  reviewGroupId: string | null;
  name: string;
  status: "OPEN" | "APPROVED" | "REJECTED";
  /** Whether the viewer may decide this step now. */
  canDecide?: boolean;
};

const STEP_STATUS_LABEL: Record<ReviewStep["status"], string> = { OPEN: "Open", APPROVED: "Approved", REJECTED: "Rejected" };
const STEP_STATUS_TONE: Record<ReviewStep["status"], ChipTone> = { OPEN: "neutral", APPROVED: "success", REJECTED: "danger" };

function DecisionForm({ systemId, step }: { systemId: string; step: ReviewStep }) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleDecide(decision: Decision) {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment, reviewGroupId: step.reviewGroupId }),
      });

      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to record decision");
        return;
      }

      setComment("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="mt-2 flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800"
      role="group"
      aria-label={`Decide ${step.name}`}
    >
      {error && <p className="text-sm text-red-600">{error}</p>}

      <label className="flex flex-col gap-1 text-sm">
        Comment for {step.name}
        <textarea
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>

      <div className="flex gap-2">
        <Button variant="primary" onClick={() => handleDecide("APPROVED")} disabled={submitting}>
          Approve
        </Button>
        <Button onClick={() => handleDecide("REJECTED")} disabled={submitting}>
          Reject
        </Button>
      </div>
    </div>
  );
}

export function ApprovalPanel({ systemId }: { systemId: string }) {
  const [rounds, setRounds] = useState<ReviewRound[] | null>(null);
  const [steps, setSteps] = useState<ReviewStep[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/systems/${systemId}/approvals`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setRounds(body.rounds ?? []);
        setSteps(body.steps ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [systemId]);

  return (
    <div>
      {steps.length > 0 && (
        <section className="mb-4" aria-label="Review Steps">
          <h3 className="mb-2 text-sm font-semibold text-rg-muted">Review Steps</h3>
          <ul className="flex flex-col gap-2">
            {steps.map((step) => (
              <li
                key={step.reviewGroupId ?? "base"}
                className="rounded border border-rg-line px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{step.name}</span>
                  <StatusChip tone={STEP_STATUS_TONE[step.status]}>{STEP_STATUS_LABEL[step.status]}</StatusChip>
                </div>
                {step.canDecide && step.status === "OPEN" && <DecisionForm systemId={systemId} step={step} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rounds === null ? (
        <p>Loading Approval history…</p>
      ) : rounds.length === 0 ? (
        <p className="text-sm text-zinc-500">No Approval decisions recorded yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Newest Review Round first. */}
          {rounds.map((round) => (
            <section key={round.id} aria-label={`Review Round submitted ${new Date(round.submittedAt).toLocaleDateString()}`}>
              <h3 className="mb-2 text-sm font-semibold text-rg-muted">
                Submitted {new Date(round.submittedAt).toLocaleDateString()}
                {round.current && " (current round)"}
              </h3>
              {round.approvals.length === 0 ? (
                <p className="text-sm text-rg-muted">No decisions yet.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {round.approvals.map((approval) => (
                    <li key={approval.id} className="rounded border border-rg-line p-3">
                      <div className="flex items-center gap-2 font-medium">
                        <StatusChip tone={onboardingStatusTone(approval.decision)}>{approval.decision}</StatusChip>
                        <span>{approval.stepName}</span>
                        {approval.approver && (
                          <span className="text-xs font-normal text-rg-muted">by {approval.approver.name}</span>
                        )}
                        {approval.voided && (
                          <span className="text-xs font-normal text-rg-muted">(step dropped, no longer counts)</span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500">{new Date(approval.decidedAt).toLocaleString()}</p>
                      {approval.comment && <p className="mt-1 text-sm">{approval.comment}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

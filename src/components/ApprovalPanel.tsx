"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { onboardingStatusTone } from "@/lib/status-tones";

type Decision = "APPROVED" | "REJECTED";

type Approval = {
  id: string;
  decision: Decision;
  comment: string | null;
  decidedAt: string;
  approver: { name: string };
};

function DecisionForm({ systemId }: { systemId: string }) {
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
        body: JSON.stringify({ decision, comment }),
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
    <div className="mb-4 flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <label className="flex flex-col gap-1 text-sm">
        Comment
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

export function ApprovalPanel({
  systemId,
  canDecide,
}: {
  systemId: string;
  canDecide: boolean;
}) {
  const [approvals, setApprovals] = useState<Approval[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/systems/${systemId}/approvals`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setApprovals(body.approvals ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [systemId]);

  return (
    <div>
      {canDecide && <DecisionForm systemId={systemId} />}

      {approvals === null ? (
        <p>Loading Approval history…</p>
      ) : approvals.length === 0 ? (
        <p className="text-sm text-zinc-500">No Approval decisions recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {approvals.map((approval) => (
            <li key={approval.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-center gap-2 font-medium">
                <StatusChip tone={onboardingStatusTone(approval.decision)}>{approval.decision}</StatusChip>
                <span>by {approval.approver.name}</span>
              </div>
              <p className="text-xs text-zinc-500">{new Date(approval.decidedAt).toLocaleString()}</p>
              {approval.comment && <p className="mt-1 text-sm">{approval.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

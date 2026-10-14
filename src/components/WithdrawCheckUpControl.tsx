"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { MAX_WITHDRAWAL_REASON_LENGTH, validateWithdrawal } from "@/lib/check-up-withdrawal-rules";

const INPUT_CLASSES = "w-full rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent";

/**
 * An Internal Auditor's withdrawal of a Check-up that has not been evaluated (PRD 0001 F-IA.8, #158):
 * a button that opens a reason field (required), then a confirmation, because a withdrawal is final.
 * It is only rendered where the server says the Check-up can be withdrawn (`checkUpAccess`); the
 * server applies the same rules (`validateWithdrawal`), the role and the Check-up's state again.
 */
export function WithdrawCheckUpControl({ checkUpId, label = "Withdraw" }: { checkUpId: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found = validateWithdrawal({ reason }).problems;
    setProblems(found);
    if (found.length > 0) return;
    // A withdrawal is final (decision 2a, #158), so ask first; validation has passed.
    if (!window.confirm("Withdraw this Check-up? A withdrawal is final: it leaves the recipient's tasks and can no longer be answered or evaluated.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/check-ups/${checkUpId}/withdrawal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(result.problems ?? [result.error ?? "Failed to withdraw the Check-up"]);
        return;
      }
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} aria-label={label === "Withdraw" ? "Withdraw this Check-up" : label}>
        {label}
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      aria-label="Withdraw this Check-up"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Reason for withdrawing (required)</span>
        <textarea
          className={INPUT_CLASSES}
          rows={2}
          maxLength={MAX_WITHDRAWAL_REASON_LENGTH}
          aria-label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-600">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          Withdraw Check-up
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setProblems([]);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

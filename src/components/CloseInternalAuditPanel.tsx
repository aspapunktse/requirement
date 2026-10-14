"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

/**
 * Closing a launched Internal Audit (PRD 0001 F-IA.8, #158). The page computes which Check-ups are
 * still neither evaluated nor withdrawn (`unfinished`, already described by Control and target) with
 * the very rule the close uses. While there are any, the panel names them and the button is disabled;
 * an Internal Auditor can otherwise close the audit after a confirmation that says it becomes
 * read-only for everyone. Readers who can't close see the list but no button. The server decides
 * again, and a refusal it sends back (a Check-up changed meanwhile) is shown here.
 */
export function CloseInternalAuditPanel({
  internalAuditId,
  title,
  unfinished,
  canClose,
}: {
  internalAuditId: string;
  title: string;
  unfinished: string[];
  canClose: boolean;
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleClose() {
    if (
      !window.confirm(
        `Close "${title}"? The audit, its Check-ups, responses, evaluations and withdrawals become read-only for everyone, and this can't be undone.`,
      )
    )
      return;
    setBusy(true);
    setProblems([]);
    try {
      const response = await fetch(`/api/internal-audits/${internalAuditId}/close`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems([body.error ?? "Failed to close the Internal Audit", ...(response.status === 409 ? (body.problems ?? []).filter((p: string) => p !== body.error) : [])]);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const blocked = unfinished.length > 0;
  return (
    <section className="mb-6 rounded border border-zinc-200 p-3 dark:border-zinc-800" aria-label="Close this Internal Audit">
      <h2 className="mb-1 text-lg">Close this Internal Audit</h2>
      {blocked ? (
        <div className="mb-2 text-sm" data-testid="close-blockers">
          <p>
            It can be closed once every Check-up is evaluated or withdrawn. Still open ({unfinished.length}):
          </p>
          <ul className="list-disc pl-6">
            {unfinished.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mb-2 text-sm">Every Check-up is evaluated or withdrawn, so this audit can be closed. Closing makes it read-only for everyone.</p>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="mb-2 list-disc pl-6 text-sm text-red-600">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {canClose && (
        <Button variant="primary" disabled={blocked || busy} onClick={handleClose}>
          Close Internal Audit
        </Button>
      )}
    </section>
  );
}

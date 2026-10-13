"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { LaunchReport } from "@/lib/check-ups";

/** The Controls and Systems a launch skips because the Control doesn't apply to the System. */
function SkippedList({ report }: { report: LaunchReport }) {
  if (report.skipped.length === 0) return null;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer">
        {report.skippedCount} {report.skippedCount === 1 ? "pair" : "pairs"} skipped: the Control doesn&apos;t apply to the System
      </summary>
      <ul className="mt-1 list-disc pl-6">
        {report.skipped.map(({ control, systems }) => (
          <li key={control.id}>
            <span className="font-medium">{control.code}</span> is skipped for {systems.map((system) => system.name).join(", ")}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Launching a draft Internal Audit (PRD 0001 F-IA.3, #154). A draft shows the launch preview, which
 * the server computes with the very rule the launch uses: what would be created and skipped, and
 * what blocks it. An Internal Auditor can launch after a confirmation that states what will be
 * created; the summary of the launch then stays on screen.
 */
export function LaunchInternalAuditPanel({
  internalAuditId,
  title,
  preview,
  canLaunch,
}: {
  internalAuditId: string;
  title: string;
  preview: LaunchReport | null;
  canLaunch: boolean;
}) {
  const router = useRouter();
  const [launched, setLaunched] = useState<LaunchReport | null>(null);
  const [error, setError] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleLaunch() {
    if (!preview) return;
    const confirmed = window.confirm(
      `Launch "${title}"? This creates ${preview.summary}. After launch the audit's Controls, Systems and questions can't be changed.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError([]);
    try {
      const response = await fetch(`/api/internal-audits/${internalAuditId}/launch`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.problems ?? [body.error ?? "Failed to launch the Internal Audit"]);
        return;
      }
      setLaunched(body.summary);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (launched) {
    return (
      <section className="mb-6 rounded border border-zinc-200 p-3 dark:border-zinc-800" aria-label="Launch summary">
        <h2 className="mb-1 text-lg">Launched</h2>
        <p className="mb-1 text-sm">{launched.summary}.</p>
        <SkippedList report={launched} />
      </section>
    );
  }

  if (!preview) return null;

  const blocked = preview.blockers.length > 0;
  return (
    <section className="mb-6 rounded border border-zinc-200 p-3 dark:border-zinc-800" aria-label="Launch preview">
      <h2 className="mb-1 text-lg">Launch preview</h2>
      <p className="mb-1 text-sm">{blocked ? `If it could be launched now: ${preview.summary}.` : `Launching creates ${preview.summary}.`}</p>
      <SkippedList report={preview} />
      {blocked && (
        <div role="alert" className="mt-2 text-sm">
          <p className="font-medium text-red-600">Launch is blocked:</p>
          <ul className="list-disc pl-6 text-red-600">
            {preview.blockers.map((blocker) => (
              <li key={blocker.message}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      )}
      {error.length > 0 && (
        <ul role="alert" className="mt-2 list-disc pl-6 text-sm text-red-600">
          {error.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {canLaunch && (
        <div className="mt-3">
          <Button variant="primary" disabled={blocked || busy} onClick={handleLaunch}>
            Launch Internal Audit
          </Button>
        </div>
      )}
    </section>
  );
}

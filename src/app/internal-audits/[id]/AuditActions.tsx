"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The two actions that change an audit's status, on the single audit page (#399). Both call the existing routes
 * (`POST /api/internal-audits/[id]/launch` and `/close`), ask first, show what the server refuses with, and refresh
 * the page so the new status, the ring and the banner appear without a full navigation. The page renders them only
 * for a role that may (`canWriteInternalAudits`, `canCloseInternalAudits`); the routes decide again.
 */

function Problems({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <ul role="alert" className="ad-problems">
      {problems.map((problem) => (
        <li key={problem}>{problem}</li>
      ))}
    </ul>
  );
}

export function LaunchAuditButton({
  internalAuditId,
  title,
  summary,
  blockers,
}: {
  internalAuditId: string;
  title: string;
  /** What launching creates, as the server's launch preview words it. */
  summary: string;
  blockers: string[];
}) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const blocked = blockers.length > 0;

  async function launch() {
    if (!window.confirm(`Launch "${title}"? This creates ${summary}. After launch the audit's Controls, Systems and questions can't be changed.`)) return;
    setBusy(true);
    setProblems([]);
    try {
      const response = await fetch(`/api/internal-audits/${internalAuditId}/launch`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(body.problems ?? [body.error ?? "Failed to launch the Internal Audit"]);
        return;
      }
      router.refresh();
    } catch {
      setProblems(["Failed to launch the Internal Audit"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="hc-btn primary"
        disabled={blocked || busy}
        title={blocked ? "Fix what blocks the launch first" : undefined}
        onClick={() => void launch()}
      >
        {busy ? "Launching…" : "Launch"}
      </button>
      <Problems problems={problems} />
    </>
  );
}

export function CloseAuditButton({ internalAuditId, title, openCount }: { internalAuditId: string; title: string; openCount: number }) {
  const router = useRouter();
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function close() {
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
    } catch {
      setProblems(["Failed to close the Internal Audit"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="hc-btn primary"
        disabled={openCount > 0 || busy}
        title={openCount > 0 ? "Every Check-up must be evaluated or withdrawn first" : undefined}
        onClick={() => void close()}
      >
        {busy ? "Closing…" : "Close audit"}
      </button>
      <Problems problems={problems} />
    </>
  );
}

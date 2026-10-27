"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { riskStatusTone } from "@/lib/status-tones";

type RiskStatus = "OPEN" | "MITIGATED" | "ACCEPTED" | "TRANSFERRED" | "CLOSED";
type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type Risk = {
  id: string;
  title: string;
  description: string;
  severity: RiskSeverity;
  likelihood: RiskSeverity;
  status: RiskStatus;
  mitigationPlan: string | null;
  ownerId?: string | null;
  owner?: { id: string; name: string } | null;
  controlAssessment: {
    id: string;
    control: { id: string; code: string; title: string };
  } | null;
  /** The Check-up whose Nonconformity opened this Risk (#157), if one did. */
  checkUp?: { id: string } | null;
};

const STATUSES: RiskStatus[] = ["OPEN", "MITIGATED", "ACCEPTED", "TRANSFERRED", "CLOSED"];

/**
 * One Risk with, for those who may manage it, the status / mitigation plan form. `patchUrl` is where
 * the form saves (a System's Risk route, or `/api/risks/[id]` for an Organization Risk, #157); with
 * `owners` the form also assigns the Risk's owner. The link to the Check-up that opened it is shown
 * only when `canOpenCheckUp`: not everyone who sees a Risk may read the audit (#157).
 */
export function RiskRow({
  risk,
  patchUrl,
  canManageStatus,
  canOpenCheckUp = false,
  owners,
  onUpdated,
}: {
  risk: Risk;
  patchUrl: string;
  canManageStatus: boolean;
  canOpenCheckUp?: boolean;
  owners?: { id: string; name: string }[];
  onUpdated: (risk: Risk) => void;
}) {
  const [status, setStatus] = useState<RiskStatus>(risk.status);
  const [mitigationPlan, setMitigationPlan] = useState(risk.mitigationPlan ?? "");
  const [ownerId, setOwnerId] = useState(risk.ownerId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(risk.status);
    setMitigationPlan(risk.mitigationPlan ?? "");
    setOwnerId(risk.ownerId ?? "");
  }, [risk]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, mitigationPlan: mitigationPlan || null, ...(owners && { ownerId: ownerId || null }) }),
      });

      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to update Risk");
        return;
      }

      const body = await response.json();
      onUpdated(body.risk);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="mb-1 flex items-center gap-2 font-medium">
        <span>{risk.title}</span>
        <StatusChip tone={riskStatusTone(risk.status)}>{risk.status}</StatusChip>
      </div>
      <p className="text-sm text-zinc-500">{risk.description}</p>
      <p className="text-xs text-zinc-500">
        Severity: {risk.severity} · Likelihood: {risk.likelihood}
      </p>
      {risk.controlAssessment && (
        <p className="text-xs text-zinc-500">
          Originated from {risk.controlAssessment.control.code} —{" "}
          {risk.controlAssessment.control.title}
        </p>
      )}
      {risk.checkUp && (
        <p className="text-xs text-zinc-500">
          Opened by an Internal Audit Nonconformity
          {canOpenCheckUp && (
            <>
              {": "}
              <Link className="underline" href={`/check-ups/${risk.checkUp.id}`}>
                see the finding
              </Link>
            </>
          )}
        </p>
      )}
      {risk.owner && <p className="text-xs text-zinc-500">Owner: {risk.owner.name}</p>}
      {risk.mitigationPlan && (
        <p className="text-xs text-zinc-500">Mitigation plan: {risk.mitigationPlan}</p>
      )}

      {canManageStatus && (
        <div className="mt-2 flex flex-col gap-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              aria-label={`Status for ${risk.title}`}
              className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
              value={status}
              onChange={(event) => setStatus(event.target.value as RiskStatus)}
            >
              {STATUSES.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </label>

          {owners && (
            <label className="flex flex-col gap-1 text-sm">
              Owner
              <select
                aria-label={`Owner for ${risk.title}`}
                className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
                value={ownerId}
                onChange={(event) => setOwnerId(event.target.value)}
              >
                <option value="">Unassigned</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            {status === "MITIGATED" ? "Mitigation Plan (required)" : "Mitigation Plan (optional)"}
            <textarea
              aria-label={`Mitigation plan for ${risk.title}`}
              className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
              value={mitigationPlan}
              onChange={(event) => setMitigationPlan(event.target.value)}
            />
          </label>

          <Button variant="secondary" onClick={handleSave} disabled={saving}>
            Save
          </Button>
        </div>
      )}
    </li>
  );
}

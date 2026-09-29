"use client";

import { useEffect, useState } from "react";
import { LogRiskForm } from "@/components/LogRiskForm";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { riskStatusTone } from "@/lib/status-tones";

type RiskStatus = "OPEN" | "MITIGATED" | "ACCEPTED" | "TRANSFERRED" | "CLOSED";
type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

type Risk = {
  id: string;
  title: string;
  description: string;
  severity: RiskSeverity;
  likelihood: RiskSeverity;
  status: RiskStatus;
  mitigationPlan: string | null;
  controlAssessment: {
    id: string;
    control: { id: string; code: string; title: string };
  } | null;
};

const STATUSES: RiskStatus[] = ["OPEN", "MITIGATED", "ACCEPTED", "TRANSFERRED", "CLOSED"];

function RiskRow({
  risk,
  systemId,
  canManageStatus,
  onUpdated,
}: {
  risk: Risk;
  systemId: string;
  canManageStatus: boolean;
  onUpdated: (risk: Risk) => void;
}) {
  const [status, setStatus] = useState<RiskStatus>(risk.status);
  const [mitigationPlan, setMitigationPlan] = useState(risk.mitigationPlan ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(risk.status);
    setMitigationPlan(risk.mitigationPlan ?? "");
  }, [risk]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/risks/${risk.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, mitigationPlan: mitigationPlan || null }),
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

export function RiskList({
  systemId,
  canLog,
  canManageStatus,
}: {
  systemId: string;
  canLog: boolean;
  canManageStatus: boolean;
}) {
  const [risks, setRisks] = useState<Risk[] | null>(null);

  function load() {
    fetch(`/api/systems/${systemId}/risks`)
      .then((response) => response.json())
      .then((body) => setRisks(body.risks ?? []));
  }

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/systems/${systemId}/risks`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setRisks(body.risks ?? []);
      });

    return () => {
      cancelled = true;
    };
  }, [systemId]);

  return (
    <div>
      {canLog && <LogRiskForm systemId={systemId} onLogged={load} />}

      {risks === null ? (
        <p>Loading Risks…</p>
      ) : risks.length === 0 ? (
        <p className="text-sm text-zinc-500">No Risks logged for this System.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {risks.map((risk) => (
            <RiskRow
              key={risk.id}
              risk={risk}
              systemId={systemId}
              canManageStatus={canManageStatus}
              onUpdated={(updated) =>
                setRisks((prev) => (prev ?? []).map((r) => (r.id === updated.id ? updated : r)))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

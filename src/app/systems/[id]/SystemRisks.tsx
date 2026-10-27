"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { RiskRow, type Risk } from "@/components/RiskList";
import { StatusChip } from "@/components/ui/StatusChip";
import { riskSeverityTone, riskStatusTone } from "@/lib/status-tones";
import { initialsOf } from "@/app/home/home-format";
import { RiskGrid, SEVERITY_TEXT } from "./RiskGrid";
import { riskGridOf } from "./system-page-logic";
import { RISK_LEVELS } from "./system-page-types";
import { useRemote } from "./use-remote";

const STATUS_TEXT: Record<Risk["status"], string> = { OPEN: "Open", MITIGATED: "Mitigated", ACCEPTED: "Accepted", TRANSFERRED: "Transferred", CLOSED: "Closed" };

function LogRiskForm({ systemId, onLogged, onCancel }: { systemId: string; onLogged: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Risk["severity"]>("MEDIUM");
  const [likelihood, setLikelihood] = useState<Risk["likelihood"]>("MEDIUM");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/risks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, severity, likelihood }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Failed to log Risk");
        return;
      }
      onLogged();
    } catch {
      setError("Failed to log Risk");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="sc-form" aria-label="Log a Risk">
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      <label className="sc-field">
        <span>Title</span>
        <input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} required />
      </label>
      <label className="sc-field">
        <span>Description</span>
        <textarea aria-label="Description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} required />
      </label>
      <div className="sc-form-pair">
        <label className="sc-field">
          <span>Severity</span>
          <select aria-label="Severity" value={severity} onChange={(event) => setSeverity(event.target.value as Risk["severity"])}>
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="sc-field">
          <span>Likelihood</span>
          <select aria-label="Likelihood" value={likelihood} onChange={(event) => setLikelihood(event.target.value as Risk["likelihood"])}>
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="sc-btnrow">
        <button type="submit" className="hc-btn primary" disabled={saving}>
          Log Risk
        </button>
        <button type="button" className="hc-btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The Risks tab (design proposal A, #245): the "Risk register" card with the severity by likelihood grid of
 * open Risks and a table of every Risk on the System. A Risk's row opens `RiskRow`, so status changes (for
 * those who may manage them), the mitigation plan and the link to the Check-up that opened it work as before.
 * "+ Log Risk" is for those who `canLog` (the same rule `POST /api/systems/[id]/risks` enforces). The Risks
 * are read from `GET /api/systems/[id]/risks` and read again after logging one.
 */
export function SystemRisks({
  systemId,
  canLog,
  canManageStatus,
  canOpenCheckUp,
}: {
  systemId: string;
  canLog: boolean;
  canManageStatus: boolean;
  canOpenCheckUp: boolean;
}) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const read = useCallback(async (): Promise<Risk[]> => {
    const response = await fetch(`/api/systems/${systemId}/risks`);
    if (!response.ok) throw new Error("Failed to load the Risks");
    return (await response.json()).risks ?? [];
  }, [systemId]);
  const { data: risks, failed: loadError, reload: load, setData: setRisks } = useRemote(read);

  const grid = riskGridOf(risks ?? []);
  const open = (risks ?? []).filter((risk) => risk.status === "OPEN").length;

  return (
    <section className="hc-card" aria-labelledby="sc-riskreg-h">
      <div className="hc-card-h">
        <h2 id="sc-riskreg-h">Risk register</h2>
        {canLog && !logging && (
          <button type="button" className="hc-btn primary" onClick={() => setLogging(true)}>
            + Log Risk
          </button>
        )}
      </div>
      <div className="hc-card-b sc-risks">
        {logging && (
          <div className="sc-risks-form">
            <LogRiskForm
              systemId={systemId}
              onCancel={() => setLogging(false)}
              onLogged={() => {
                setLogging(false);
                load();
                // The header's Open Risks, the Overview and the timeline are read on the server.
                router.refresh();
              }}
            />
          </div>
        )}
        {loadError && (
          <p role="alert" className="sc-err sc-risks-form">
            Couldn&apos;t load the Risks.{" "}
            <button type="button" className="sc-link" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {risks === null ? (
          !loadError && (
            <p role="status" className="hc-empty sc-risks-form">
              Loading Risks…
            </p>
          )
        ) : (
          <>
            <div className="sc-risks-grid">
              <RiskGrid grid={grid} open={open} size={46} />
              <p className="muted">Open Risks · severity (rows) by likelihood (columns)</p>
            </div>
            {risks.length === 0 ? (
              <p className="hc-empty">No Risks logged for this System.</p>
            ) : (
              <div className="sc-tablewrap">
                <table className="sc-rt">
                  <thead>
                    <tr>
                      <th>Risk</th>
                      <th>Severity</th>
                      <th className="hide-sm">Likelihood</th>
                      <th>Status</th>
                      <th className="hide-sm">Owner</th>
                    </tr>
                  </thead>
                  <tbody>
                    {risks.map((risk) => {
                      const expanded = openId === risk.id;
                      return (
                        <RiskTableRow
                          key={risk.id}
                          risk={risk}
                          expanded={expanded}
                          onToggle={() => setOpenId(expanded ? null : risk.id)}
                          patchUrl={`/api/systems/${systemId}/risks/${risk.id}`}
                          canManageStatus={canManageStatus}
                          canOpenCheckUp={canOpenCheckUp}
                          onUpdated={(updated) => {
                            setRisks((previous) => (previous ?? []).map((candidate) => (candidate.id === updated.id ? updated : candidate)));
                            router.refresh();
                          }}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function RiskTableRow({
  risk,
  expanded,
  onToggle,
  patchUrl,
  canManageStatus,
  canOpenCheckUp,
  onUpdated,
}: {
  risk: Risk;
  expanded: boolean;
  onToggle: () => void;
  patchUrl: string;
  canManageStatus: boolean;
  canOpenCheckUp: boolean;
  onUpdated: (risk: Risk) => void;
}) {
  const detailId = `sc-risk-${risk.id}`;
  return (
    <>
      <tr>
        <td>
          <button type="button" className="sc-rowbtn" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} onClick={onToggle}>
            <span className="chev" aria-hidden="true">
              ▸
            </span>
            <b>{risk.title}</b>
          </button>
        </td>
        <td>
          <StatusChip tone={riskSeverityTone(risk.severity)}>{SEVERITY_TEXT[risk.severity]}</StatusChip>
        </td>
        <td className="hide-sm">{SEVERITY_TEXT[risk.likelihood]}</td>
        <td>
          <StatusChip tone={riskStatusTone(risk.status)}>{STATUS_TEXT[risk.status]}</StatusChip>
        </td>
        <td className="hide-sm">
          {risk.owner ? (
            <span className="sc-owner" title={risk.owner.name}>
              <span className="av" aria-hidden="true">
                {initialsOf(risk.owner.name)}
              </span>
              {risk.owner.name}
            </span>
          ) : (
            <span className="muted">Unassigned</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="sc-risk-detail">
          <td colSpan={5} id={detailId}>
            <ul className="sc-risk-list">
              <RiskRow risk={risk} patchUrl={patchUrl} canManageStatus={canManageStatus} canOpenCheckUp={canOpenCheckUp} onUpdated={onUpdated} />
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

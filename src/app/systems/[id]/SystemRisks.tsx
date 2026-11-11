"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RiskRow, type Risk } from "@/components/RiskList";
import { StatusChip } from "@/components/ui/StatusChip";
import { RISK_SOURCES, RISK_SOURCE_LABELS, type RiskSourceValue } from "@/lib/risk-source";
import { riskSeverityTone, riskStatusTone } from "@/lib/status-tones";
import { initialsOf } from "@/app/home/home-format";
import { RiskGrid, SEVERITY_TEXT } from "./RiskGrid";
import { SystemRiskAnalyses } from "./SystemRiskAnalyses";
import { currentRiskId, subscribeToHash } from "./system-hash";
import { riskGridOf } from "./system-page-logic";
import { RISK_LEVELS } from "./system-page-types";
import { useRemote } from "./use-remote";

const STATUS_TEXT: Record<Risk["status"], string> = { OPEN: "Open", MITIGATED: "Mitigated", ACCEPTED: "Accepted", TRANSFERRED: "Transferred", CLOSED: "Closed" };

function LogRiskForm({
  systemId,
  owners,
  onLogged,
  onCancel,
}: {
  systemId: string;
  /** Every User, for picking the new Risk's owner; passed only to those who may assign one (#360). */
  owners?: { id: string; name: string }[];
  onLogged: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Risk["severity"]>("MEDIUM");
  const [likelihood, setLikelihood] = useState<Risk["likelihood"]>("MEDIUM");
  const [ownerId, setOwnerId] = useState("");
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
        body: JSON.stringify({ title, description, severity, likelihood, ...(owners && ownerId !== "" && { ownerId }) }),
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
      {owners && (
        <label className="sc-field">
          <span>Owner</span>
          <select aria-label="Owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
            <option value="">Unassigned</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </label>
      )}
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
 * are read from `GET /api/systems/[id]/risks` and read again after logging one. The URL hash `#risk-<id>` (#360) opens the
 * Risks tab (the cockpit reads the tab from it) and expands that Risk's row, scrolled into view.
 */
export function SystemRisks({
  systemId,
  canLog,
  canManageStatus,
  canAssignOwner = canManageStatus,
  canOpenCheckUp,
  owners,
  riskAnalyses,
}: {
  systemId: string;
  canLog: boolean;
  canManageStatus: boolean;
  /** Whether the opened Risk and the log form get an owner control (#360): an Admin, a Risk Owner or a Risk Facilitator. */
  canAssignOwner?: boolean;
  canOpenCheckUp: boolean;
  /** Every User, for assigning a Risk's owner (any role) and picking Risk Analysis participants; passed only to those who may do either. */
  owners?: { id: string; name: string }[];
  /**
   * Shows the Risk Analyses card below the register (#325). `canRecord` is `canRecordRiskAnalysis`: those who may record, edit and
   * complete one; `owners` (every User, passed to the same people) is who can be picked as a participant. Left out, no card.
   */
  riskAnalyses?: { canRecord: boolean };
}) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  // The open Risk is state read from the hash at the start and whenever it changes (a link, Back, Forward), as the Controls tab does.
  const [openId, setOpenId] = useState<string | null>(() => (typeof window === "undefined" ? null : currentRiskId()));
  useEffect(
    () =>
      subscribeToHash(() => {
        const id = currentRiskId();
        if (id) setOpenId(id);
      }),
    [],
  );
  const [sourceFilter, setSourceFilter] = useState<RiskSourceValue | "">("");

  const read = useCallback(async (): Promise<Risk[]> => {
    const response = await fetch(`/api/systems/${systemId}/risks`);
    if (!response.ok) throw new Error("Failed to load the Risks");
    return (await response.json()).risks ?? [];
  }, [systemId]);
  const { data: risks, failed: loadError, reload: load, setData: setRisks } = useRemote(read);

  const grid = riskGridOf(risks ?? []);
  const open = (risks ?? []).filter((risk) => risk.status === "OPEN").length;
  const shown = (risks ?? []).filter((risk) => !sourceFilter || risk.source === sourceFilter);

  return (
    <div className="sc-stackgap">
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
              owners={canAssignOwner ? owners : undefined}
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
              <>
              <label className="sc-field sc-risks-form">
                <span>Source</span>
                <select aria-label="Filter by Risk Source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as RiskSourceValue | "")}>
                  <option value="">All sources</option>
                  {RISK_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {RISK_SOURCE_LABELS[source]}
                    </option>
                  ))}
                </select>
              </label>
              {shown.length === 0 ? (
              <p className="hc-empty">No Risks from this source.</p>
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
                      <th className="hide-sm">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((risk) => {
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
                          owners={canAssignOwner ? owners : undefined}
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
          </>
        )}
      </div>
    </section>
    {riskAnalyses && (
      <SystemRiskAnalyses
        systemId={systemId}
        canRecord={riskAnalyses.canRecord}
        people={owners ?? []}
        openRisks={(risks ?? []).filter((risk) => risk.status === "OPEN").map((risk) => ({ id: risk.id, title: risk.title, ownerId: risk.ownerId ?? risk.owner?.id ?? null }))}
        onRisksChanged={load}
      />
    )}
    </div>
  );
}

function RiskTableRow({
  risk,
  expanded,
  onToggle,
  patchUrl,
  canManageStatus,
  canOpenCheckUp,
  owners,
  onUpdated,
}: {
  risk: Risk;
  expanded: boolean;
  onToggle: () => void;
  patchUrl: string;
  canManageStatus: boolean;
  canOpenCheckUp: boolean;
  owners?: { id: string; name: string }[];
  onUpdated: (risk: Risk) => void;
}) {
  const detailId = `sc-risk-${risk.id}`;
  const rowRef = useRef<HTMLTableRowElement>(null);
  // A deep link (`#risk-<id>`) lands on the row it opened.
  useEffect(() => {
    if (expanded && currentRiskId() === risk.id) rowRef.current?.scrollIntoView?.({ block: "center" });
  }, [expanded, risk.id]);
  return (
    <>
      <tr ref={rowRef} id={`risk-${risk.id}`}>
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
        <td className="hide-sm">{RISK_SOURCE_LABELS[risk.source]}</td>
      </tr>
      {expanded && (
        <tr className="sc-risk-detail">
          <td colSpan={6} id={detailId}>
            <ul className="sc-risk-list">
              <RiskRow risk={risk} patchUrl={patchUrl} canManageStatus={canManageStatus} canOpenCheckUp={canOpenCheckUp} owners={owners} onUpdated={onUpdated} />
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

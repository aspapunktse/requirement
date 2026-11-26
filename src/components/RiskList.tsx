"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { riskStatusTone } from "@/lib/status-tones";
import { RISK_SOURCE_LABELS, type RiskSourceValue } from "@/lib/risk-source";

type RiskStatus = "OPEN" | "MITIGATED" | "ACCEPTED" | "TRANSFERRED" | "CLOSED";
type RiskSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type Risk = {
  id: string;
  title: string;
  description: string;
  severity: RiskSeverity;
  likelihood: RiskSeverity;
  status: RiskStatus;
  /** Where the Risk came from (#322). */
  source: RiskSourceValue;
  mitigationPlan: string | null;
  ownerId?: string | null;
  owner?: { id: string; name: string } | null;
  controlAssessment: {
    id: string;
    control: { id: string; code: string; title: string };
  } | null;
  /** The Check-up whose Nonconformity opened this Risk (#157), if one did. */
  checkUp?: { id: string } | null;
  /** The date the Risk is to be dealt with by (#456): a calendar date, as a `Date` from a page or an ISO string from the API. */
  deadline?: string | Date | null;
  /** The planned steps of its remediation (#456), in planned-date order. */
  milestones?: Milestone[];
};

export type Milestone = {
  id: string;
  title: string;
  plannedDate: string | Date;
  completedDate: string | Date | null;
};

/** `YYYY-MM-DD` of a calendar date (the columns are dates, so the UTC day is the date). */
function dayOf(value: string | Date | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 10) : "";
}

const STATUSES: RiskStatus[] = ["OPEN", "MITIGATED", "ACCEPTED", "TRANSFERRED", "CLOSED"];

/**
 * One Risk with, for those who may manage it, the status / mitigation plan form. `patchUrl` is where
 * the form saves (a System's Risk route, or `/api/risks/[id]` for an Organization Risk, #157). Given
 * `owners` (every User, passed only to those who may assign an owner), the row also has its own owner
 * control, apart from the status form, that sets, changes or clears the owner and sends nothing else
 * (#360); everyone else reads the owner. A Risk Facilitator gets that control without the status form. The link to the Check-up that opened it is shown
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
  const [ownerId, setOwnerId] = useState(risk.ownerId ?? risk.owner?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [savingOwner, setSavingOwner] = useState(false);
  const [deadline, setDeadline] = useState(dayOf(risk.deadline));

  useEffect(() => {
    setStatus(risk.status);
    setMitigationPlan(risk.mitigationPlan ?? "");
    setOwnerId(risk.ownerId ?? risk.owner?.id ?? "");
    setDeadline(dayOf(risk.deadline));
  }, [risk]);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          mitigationPlan: mitigationPlan || null,
          ...(deadline !== dayOf(risk.deadline) ? { deadline: deadline || null } : {}),
        }),
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

  async function handleSaveOwner() {
    setOwnerError(null);
    setSavingOwner(true);
    try {
      const response = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: ownerId || null }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setOwnerError(body.error ?? "Failed to update the owner");
        return;
      }
      onUpdated(body.risk);
    } catch {
      setOwnerError("Failed to update the owner");
    } finally {
      setSavingOwner(false);
    }
  }

  return (
    <li className="rounded border border-rg-line p-3">
      <div className="mb-1 flex items-center gap-2 font-medium">
        <span>{risk.title}</span>
        <StatusChip tone={riskStatusTone(risk.status)}>{risk.status}</StatusChip>
      </div>
      <p className="text-sm text-rg-muted">{risk.description}</p>
      <p className="text-xs text-rg-muted">
        Severity: {risk.severity} · Likelihood: {risk.likelihood}
      </p>
      <p className="text-xs text-rg-muted">Source: {RISK_SOURCE_LABELS[risk.source]}</p>
      {risk.controlAssessment && (
        <p className="text-xs text-rg-muted">
          Originated from {risk.controlAssessment.control.code} —{" "}
          {risk.controlAssessment.control.title}
        </p>
      )}
      {risk.checkUp && (
        <p className="text-xs text-rg-muted">
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
      {!owners && <p className="text-xs text-rg-muted">Owner: {risk.owner ? risk.owner.name : "Unassigned"}</p>}
      {risk.mitigationPlan && (
        <p className="text-xs text-rg-muted">Mitigation plan: {risk.mitigationPlan}</p>
      )}
      {risk.deadline && <p className="text-xs text-rg-muted">Deadline: {dayOf(risk.deadline)}</p>}
      <RemediationMilestones risk={risk} patchUrl={patchUrl} canManage={canManageStatus} onUpdated={onUpdated} />

      {owners && (
        <div role="group" aria-label={`Owner of ${risk.title}`} className="mt-2 flex flex-col gap-2 border-t border-rg-line pt-2">
          {ownerError && <p className="text-sm text-rg-danger">{ownerError}</p>}
          <label className="flex flex-col gap-1 text-sm">
            Owner
            <select
              aria-label={`Owner for ${risk.title}`}
              className="rounded border border-rg-control p-2"
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
          <Button variant="secondary" onClick={handleSaveOwner} disabled={savingOwner || ownerId === (risk.ownerId ?? risk.owner?.id ?? "")}>
            Save owner
          </Button>
        </div>
      )}

      {canManageStatus && (
        <div className="mt-2 flex flex-col gap-2 border-t border-rg-line pt-2">
          {error && <p className="text-sm text-rg-danger">{error}</p>}

          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              aria-label={`Status for ${risk.title}`}
              className="rounded border border-rg-control p-2"
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
              className="rounded border border-rg-control p-2"
              value={mitigationPlan}
              onChange={(event) => setMitigationPlan(event.target.value)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Deadline (optional)
            <input
              type="date"
              aria-label={`Deadline for ${risk.title}`}
              className="rounded border border-rg-control p-2"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
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

/**
 * A Risk's remediation milestones (#456): what is planned, by when, and what is done. Everyone who sees the Risk reads them;
 * who may manage the Risk can add one, edit it, mark it completed on a date, and delete one that is not completed. Each change
 * saves at once against `${patchUrl}/milestones` and gives back the whole Risk.
 */
function RemediationMilestones({
  risk,
  patchUrl,
  canManage,
  onUpdated,
}: {
  risk: Risk;
  patchUrl: string;
  canManage: boolean;
  onUpdated: (risk: Risk) => void;
}) {
  const milestones = risk.milestones ?? [];
  const [title, setTitle] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [completedOn, setCompletedOn] = useState(today);

  async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "Failed to save the milestone");
        return false;
      }
      onUpdated(data.risk);
      return true;
    } catch {
      setError("Failed to save the milestone");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (await send(`${patchUrl}/milestones`, "POST", { title: title.trim(), plannedDate })) {
      setTitle("");
      setPlannedDate("");
    }
  }

  if (milestones.length === 0 && !canManage) return null;
  return (
    <div role="group" aria-label={`Remediation milestones of ${risk.title}`} className="mt-2 flex flex-col gap-1 border-t border-rg-line pt-2">
      <p className="text-xs font-medium text-rg-muted">Remediation milestones</p>
      {error && <p className="text-sm text-rg-danger">{error}</p>}
      {milestones.length === 0 && <p className="text-xs text-rg-muted">None planned.</p>}
      {canManage && milestones.some((m) => !m.completedDate) && (
        <label className="flex items-center gap-2 text-xs text-rg-muted">
          Completed on
          <input
            type="date"
            aria-label={`Completion date for ${risk.title}`}
            className="rounded border border-rg-control p-1"
            value={completedOn}
            max={today}
            onChange={(event) => setCompletedOn(event.target.value)}
          />
        </label>
      )}
      <ul className="flex flex-col gap-1">
        {milestones.map((milestone) => (
          <MilestoneItem
            key={milestone.id}
            milestone={milestone}
            canManage={canManage}
            busy={busy}
            completedOn={completedOn}
            onSend={(method, body) => send(`${patchUrl}/milestones/${milestone.id}`, method, body)}
          />
        ))}
      </ul>
      {canManage && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            New milestone
            <input
              aria-label={`New milestone for ${risk.title}`}
              className="rounded border border-rg-control p-2"
              value={title}
              maxLength={300}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Planned date
            <input
              type="date"
              aria-label={`Planned date of the new milestone for ${risk.title}`}
              className="rounded border border-rg-control p-2"
              value={plannedDate}
              onChange={(event) => setPlannedDate(event.target.value)}
            />
          </label>
          <Button variant="secondary" disabled={busy || !title.trim() || !plannedDate} onClick={handleAdd}>
            Add milestone
          </Button>
        </div>
      )}
    </div>
  );
}

function MilestoneItem({
  milestone,
  canManage,
  busy,
  completedOn,
  onSend,
}: {
  milestone: Milestone;
  canManage: boolean;
  busy: boolean;
  completedOn: string;
  onSend: (method: "PATCH" | "DELETE", body?: unknown) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(milestone.title);
  const [plannedDate, setPlannedDate] = useState(dayOf(milestone.plannedDate));

  if (editing) {
    return (
      <li className="flex flex-wrap items-end gap-2 text-sm">
        <input aria-label={`Title of milestone ${milestone.title}`} className="rounded border border-rg-control p-1" value={title} maxLength={300} onChange={(event) => setTitle(event.target.value)} />
        <input
          type="date"
          aria-label={`Planned date of milestone ${milestone.title}`}
          className="rounded border border-rg-control p-1"
          value={plannedDate}
          onChange={(event) => setPlannedDate(event.target.value)}
        />
        <Button
          variant="secondary"
          disabled={busy || !title.trim() || !plannedDate}
          onClick={async () => {
            if (await onSend("PATCH", { title: title.trim(), plannedDate })) setEditing(false);
          }}
        >
          Save milestone
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span>{milestone.title}</span>
      <span className="text-xs text-rg-muted">planned {dayOf(milestone.plannedDate)}</span>
      {milestone.completedDate ? (
        <span className="text-xs text-rg-muted">completed {dayOf(milestone.completedDate)}</span>
      ) : (
        canManage && (
          <>
            <Button variant="secondary" disabled={busy || !completedOn} aria-label={`Mark ${milestone.title} completed`} onClick={() => onSend("PATCH", { completedDate: completedOn })}>
              Mark completed
            </Button>
            <Button variant="secondary" disabled={busy} aria-label={`Edit milestone ${milestone.title}`} onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="secondary" disabled={busy} aria-label={`Delete milestone ${milestone.title}`} onClick={() => onSend("DELETE")}>
              Delete
            </Button>
          </>
        )
      )}
    </li>
  );
}

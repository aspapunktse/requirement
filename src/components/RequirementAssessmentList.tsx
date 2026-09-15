"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { requirementStatusTone } from "@/lib/status-tones";

type RequirementStatus = "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED" | "NOT_APPLICABLE" | "WAIVED";
type UserRole = "ADMIN" | "RISK_OWNER" | "SYSTEM_OWNER" | "REVIEWER" | "VIEWER" | "BUSINESS_RISK_OWNER";

type SelfAssessmentAnswer = "YES" | "NO" | "NA";

type Requirement = {
  id: string;
  code: string;
  title: string;
  description: string;
  category: string;
  mandatory: boolean;
  question: string | null;
};

type Assessment = {
  id: string;
  status: RequirementStatus;
  evidence: string | null;
  notes: string | null;
  selfAssessmentAnswer: SelfAssessmentAnswer | null;
} | null;

type AssessmentRow = { requirement: Requirement; assessment: Assessment };

const STATUSES_REQUIRING_WAIVE_ROLE: RequirementStatus[] = ["NOT_APPLICABLE", "WAIVED"];
const ROLES_ALLOWED_TO_WAIVE: UserRole[] = ["ADMIN", "RISK_OWNER"];

const STATUS_LABELS: Record<RequirementStatus, string> = {
  NOT_STARTED: "Not Started",
  IN_PROGRESS: "In Progress",
  FULFILLED: "Fulfilled",
  NOT_APPLICABLE: "Not Applicable",
  WAIVED: "Waived",
};

const ANSWER_LABELS: Record<SelfAssessmentAnswer, string> = {
  YES: "Yes",
  NO: "No",
  NA: "N/A",
};

function SelfAssessmentQuestion({
  requirement,
  assessment,
  systemId,
  userRole,
  onAnswered,
}: {
  requirement: Requirement;
  assessment: Assessment;
  systemId: string;
  userRole: UserRole;
  onAnswered: (assessment: NonNullable<Assessment>) => void;
}) {
  const canAnswerNa = ROLES_ALLOWED_TO_WAIVE.includes(userRole);
  const [notes, setNotes] = useState(assessment?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);

  useEffect(() => {
    setNotes(assessment?.notes ?? "");
  }, [assessment]);

  async function handleAnswer(answer: SelfAssessmentAnswer) {
    setError(null);
    setAnswering(true);
    try {
      const response = await fetch(
        `/api/systems/${systemId}/assessments/${requirement.id}/answer`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer, notes: notes || null }),
        },
      );

      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to save answer");
        return;
      }

      const body = await response.json();
      onAnswered(body.assessment);
    } finally {
      setAnswering(false);
    }
  }

  if (!requirement.question) return null;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
      <p className="font-medium">{requirement.question}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {assessment?.selfAssessmentAnswer && (
        <p className="text-xs text-zinc-500">
          Recorded answer: {ANSWER_LABELS[assessment.selfAssessmentAnswer]}
        </p>
      )}

      {(requirement.mandatory || assessment?.selfAssessmentAnswer === "NA") && (
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {requirement.mandatory ? "Justification (required for N/A)" : "Notes (optional)"}
          <textarea
            aria-label={`Self-assessment justification for ${requirement.code}`}
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      )}

      <div className="flex gap-2">
        <Button className="px-3 py-0.5 text-xs" onClick={() => handleAnswer("YES")} disabled={answering}>
          Yes
        </Button>
        <Button className="px-3 py-0.5 text-xs" onClick={() => handleAnswer("NO")} disabled={answering}>
          No
        </Button>
        {canAnswerNa && (
          <Button className="px-3 py-0.5 text-xs" onClick={() => handleAnswer("NA")} disabled={answering}>
            N/A
          </Button>
        )}
      </div>
    </div>
  );
}

function RequirementRow({
  row,
  systemId,
  userRole,
  onSaved,
  stale = false,
}: {
  row: AssessmentRow;
  systemId: string;
  userRole: UserRole;
  onSaved: (assessment: NonNullable<Assessment>) => void;
  stale?: boolean;
}) {
  const { requirement, assessment } = row;
  const canWaive = ROLES_ALLOWED_TO_WAIVE.includes(userRole);
  const [status, setStatus] = useState<RequirementStatus>(assessment?.status ?? "NOT_STARTED");
  const [evidence, setEvidence] = useState(assessment?.evidence ?? "");
  const [notes, setNotes] = useState(assessment?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(assessment?.status ?? "NOT_STARTED");
    setEvidence(assessment?.evidence ?? "");
    setNotes(assessment?.notes ?? "");
  }, [assessment]);

  const availableStatuses = (Object.keys(STATUS_LABELS) as RequirementStatus[]).filter(
    (candidate) => canWaive || !STATUSES_REQUIRING_WAIVE_ROLE.includes(candidate),
  );

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/assessments/${requirement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          evidence: evidence || null,
          notes: notes || null,
        }),
      });

      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to save assessment");
        return;
      }

      const body = await response.json();
      onSaved(body.assessment);
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
      {stale && (
        <p className="mb-2 rounded bg-ems-warn-tint p-2 text-xs text-ems-warn">
          No longer applicable to this System&apos;s current Type — left in place because it was
          already worked on. Resolve it manually below, or leave it as a record.
        </p>
      )}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 font-medium">
            <span>{requirement.code} — {requirement.title}</span>
            <StatusChip tone={requirementStatusTone(assessment?.status ?? "NOT_STARTED")}>
              {STATUS_LABELS[assessment?.status ?? "NOT_STARTED"]}
            </StatusChip>
            {requirement.mandatory && <span className="text-xs text-zinc-500">Mandatory</span>}
          </div>
          <p className="text-sm text-zinc-500">{requirement.description}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            aria-label={`Status for ${requirement.code}`}
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={status}
            onChange={(event) => setStatus(event.target.value as RequirementStatus)}
          >
            {availableStatuses.map((candidate) => (
              <option key={candidate} value={candidate}>
                {STATUS_LABELS[candidate]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Evidence (optional)
          <input
            aria-label={`Evidence for ${requirement.code}`}
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          {STATUSES_REQUIRING_WAIVE_ROLE.includes(status) && requirement.mandatory
            ? "Justification (required)"
            : "Notes (optional)"}
          <textarea
            aria-label={`Notes for ${requirement.code}`}
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>

        <Button variant="secondary" onClick={handleSave} disabled={saving}>
          Save
        </Button>
      </div>

      {!stale && (
        <SelfAssessmentQuestion
          requirement={requirement}
          assessment={assessment}
          systemId={systemId}
          userRole={userRole}
          onAnswered={onSaved}
        />
      )}
    </li>
  );
}

type StaleAssessmentApi = NonNullable<Assessment> & { requirement: Requirement };

export function RequirementAssessmentList({
  systemId,
  userRole,
}: {
  systemId: string;
  userRole: UserRole;
}) {
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [staleRows, setStaleRows] = useState<AssessmentRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/systems/${systemId}/assessments`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setRows(body.assessments ?? []);
        setStaleRows(
          (body.staleAssessments ?? []).map((assessment: StaleAssessmentApi) => ({
            requirement: assessment.requirement,
            assessment,
          })),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [systemId]);

  if (rows === null) {
    return <p>Loading Requirements…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No Requirements apply to this System.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <RequirementRow
              key={row.requirement.id}
              row={row}
              systemId={systemId}
              userRole={userRole}
              onSaved={(assessment) =>
                setRows((prev) =>
                  (prev ?? []).map((r) =>
                    r.requirement.id === row.requirement.id ? { ...r, assessment } : r,
                  ),
                )
              }
            />
          ))}
        </ul>
      )}

      {staleRows.length > 0 && (
        <div>
          <h3 className="mb-3 text-lg">No Longer Applicable</h3>
          <ul className="flex flex-col gap-3">
            {staleRows.map((row) => (
              <RequirementRow
                key={row.requirement.id}
                row={row}
                systemId={systemId}
                userRole={userRole}
                stale
                onSaved={(assessment) =>
                  setStaleRows((prev) =>
                    prev.map((r) => (r.requirement.id === row.requirement.id ? { ...r, assessment } : r)),
                  )
                }
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

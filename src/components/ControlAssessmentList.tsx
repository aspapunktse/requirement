"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import type { AssessmentEditAccess } from "@/lib/system-permissions";

type ControlAssessmentStatus = "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED" | "NOT_APPLICABLE" | "WAIVED";
type UserRole =
  | "ADMIN"
  | "RISK_OWNER"
  | "SYSTEM_OWNER"
  | "REVIEWER"
  | "VIEWER"
  | "BUSINESS_RISK_OWNER"
  | "COMPLIANCE_MANAGER";

type SelfAssessmentAnswer = "YES" | "NO" | "NA";

type Control = {
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
  status: ControlAssessmentStatus;
  evidence: string | null;
  notes: string | null;
  selfAssessmentAnswer: SelfAssessmentAnswer | null;
} | null;

type QueryMessage = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string; role: UserRole };
};

type AssessmentQuery = {
  id: string;
  resolved: boolean;
  lastMessageAuthorId: string;
  createdAt: string;
  messages: QueryMessage[];
};

type AssessmentRow = { control: Control; assessment: Assessment; queries: AssessmentQuery[] };

// Mirrors src/lib/assessment-queries.ts's ROLES_ALLOWED_TO_MANAGE_QUERIES —
// duplicated here (not imported) because that module pulls in the Prisma
// client, which can't be bundled into a "use client" component.
const ROLES_ALLOWED_TO_MANAGE_QUERIES: UserRole[] = ["REVIEWER", "RISK_OWNER", "ADMIN"];

const STATUSES_REQUIRING_WAIVE_ROLE: ControlAssessmentStatus[] = ["NOT_APPLICABLE", "WAIVED"];
const ROLES_ALLOWED_TO_WAIVE: UserRole[] = ["ADMIN", "RISK_OWNER"];

const STATUS_LABELS: Record<ControlAssessmentStatus, string> = {
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
  control,
  assessment,
  systemId,
  userRole,
  editAccess,
  onAnswered,
}: {
  control: Control;
  assessment: Assessment;
  systemId: string;
  userRole: UserRole;
  /** "waive-only" (a Risk Owner who doesn't own the System) offers only N/A (#78). */
  editAccess: AssessmentEditAccess;
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
        `/api/systems/${systemId}/assessments/${control.id}/answer`,
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

  if (!control.question) return null;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
      <p className="font-medium">{control.question}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {assessment?.selfAssessmentAnswer && (
        <p className="text-xs text-zinc-500">
          Recorded answer: {ANSWER_LABELS[assessment.selfAssessmentAnswer]}
        </p>
      )}

      {(control.mandatory || assessment?.selfAssessmentAnswer === "NA") && (
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          {control.mandatory ? "Justification (required for N/A)" : "Notes (optional)"}
          <textarea
            aria-label={`Self-assessment justification for ${control.code}`}
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      )}

      <div className="flex gap-2">
        {editAccess === "full" && (
          <>
            <Button className="px-3 py-0.5 text-xs" onClick={() => handleAnswer("YES")} disabled={answering}>
              Yes
            </Button>
            <Button className="px-3 py-0.5 text-xs" onClick={() => handleAnswer("NO")} disabled={answering}>
              No
            </Button>
          </>
        )}
        {canAnswerNa && (
          <Button className="px-3 py-0.5 text-xs" onClick={() => handleAnswer("NA")} disabled={answering}>
            N/A
          </Button>
        )}
      </div>
    </div>
  );
}

function QueryThreadItem({
  query,
  systemId,
  controlId,
  canReply,
  canResolve,
  onUpdated,
}: {
  query: AssessmentQuery;
  systemId: string;
  controlId: string;
  canReply: boolean;
  canResolve: boolean;
  onUpdated: (query: AssessmentQuery) => void;
}) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body?: unknown) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(
        `/api/systems/${systemId}/assessments/${controlId}/queries/${query.id}${path}`,
        {
          method: "POST",
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        },
      );
      if (!response.ok) {
        const responseBody = await response.json();
        setError(responseBody.error ?? "Failed to update this question");
        return;
      }
      const responseBody = await response.json();
      onUpdated(responseBody.query);
      setReply("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800">
      <div className="mb-1 flex items-center justify-between gap-2">
        <StatusChip tone={query.resolved ? "success" : "warn"}>
          {query.resolved ? "Resolved" : "Open"}
        </StatusChip>
        {canResolve && !query.resolved && (
          <Button
            variant="secondary"
            className="px-2 py-0.5 text-xs"
            onClick={() => post("/resolve")}
            disabled={busy}
          >
            Mark Resolved
          </Button>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {query.messages.map((message) => (
          <li key={message.id}>
            <div className="text-xs text-zinc-500">
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{message.author.name}</span>{" "}
              ({message.author.role}) · {new Date(message.createdAt).toLocaleString()}
            </div>
            <p>{message.body}</p>
          </li>
        ))}
      </ul>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {canReply && (
        <div className="mt-2 flex flex-col gap-1">
          <textarea
            aria-label="Reply"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
          />
          <Button
            className="self-start px-2 py-0.5 text-xs"
            onClick={() => reply.trim() && post("/messages", { body: reply })}
            disabled={busy}
          >
            Reply
          </Button>
        </div>
      )}
    </li>
  );
}

function AssessmentQueries({
  queries,
  systemId,
  controlId,
  userRole,
  isSystemOwner,
  readOnly,
  onChange,
}: {
  queries: AssessmentQuery[];
  systemId: string;
  controlId: string;
  userRole: UserRole;
  isSystemOwner: boolean;
  readOnly: boolean;
  onChange: (queries: AssessmentQuery[]) => void;
}) {
  const canRaise = !readOnly && ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(userRole);
  const canReply = !readOnly && (isSystemOwner || canRaise);
  const openCount = queries.filter((q) => !q.resolved).length;
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRaise() {
    if (!draft.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/assessments/${controlId}/queries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!response.ok) {
        const body = await response.json();
        setError(body.error ?? "Failed to raise a question");
        return;
      }
      const body = await response.json();
      onChange([...queries, body.query]);
      setDraft("");
      setShowForm(false);
    } finally {
      setBusy(false);
    }
  }

  if (!canRaise && queries.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          Questions{openCount > 0 && ` (${openCount} open)`}
        </h4>
        {canRaise && (
          <Button
            variant="secondary"
            className="px-2 py-0.5 text-xs"
            onClick={() => setShowForm((s) => !s)}
          >
            Ask a question
          </Button>
        )}
      </div>

      {queries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {queries.map((query) => (
            <QueryThreadItem
              key={query.id}
              query={query}
              systemId={systemId}
              controlId={controlId}
              canReply={canReply}
              canResolve={canRaise}
              onUpdated={(updated) =>
                onChange(queries.map((q) => (q.id === updated.id ? updated : q)))
              }
            />
          ))}
        </ul>
      )}

      {showForm && (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="New question"
            className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button className="px-2 py-0.5 text-xs" onClick={handleRaise} disabled={busy}>
              Send
            </Button>
            <Button
              variant="outline"
              className="px-2 py-0.5 text-xs"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlRow({
  row,
  systemId,
  userRole,
  isSystemOwner,
  readOnly,
  editAccess,
  onSaved,
  onQueriesChanged,
  stale = false,
}: {
  row: AssessmentRow;
  systemId: string;
  userRole: UserRole;
  isSystemOwner: boolean;
  readOnly: boolean;
  editAccess: AssessmentEditAccess;
  onSaved: (assessment: NonNullable<Assessment>) => void;
  onQueriesChanged: (queries: AssessmentQuery[]) => void;
  stale?: boolean;
}) {
  const { control, assessment } = row;
  const canWaive = ROLES_ALLOWED_TO_WAIVE.includes(userRole);
  const [status, setStatus] = useState<ControlAssessmentStatus>(assessment?.status ?? "NOT_STARTED");
  const [evidence, setEvidence] = useState(assessment?.evidence ?? "");
  const [notes, setNotes] = useState(assessment?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStatus(assessment?.status ?? "NOT_STARTED");
    setEvidence(assessment?.evidence ?? "");
    setNotes(assessment?.notes ?? "");
  }, [assessment]);

  const waiveOnly = editAccess === "waive-only";
  const currentStatus = assessment?.status ?? "NOT_STARTED";
  // A waive-only editor (a Risk Owner who doesn't own the System) may only pick
  // Waived / Not Applicable; the current status stays visible but unselectable.
  const availableStatuses = (Object.keys(STATUS_LABELS) as ControlAssessmentStatus[]).filter((candidate) =>
    waiveOnly
      ? STATUSES_REQUIRING_WAIVE_ROLE.includes(candidate) || candidate === currentStatus
      : canWaive || !STATUSES_REQUIRING_WAIVE_ROLE.includes(candidate),
  );
  const canSave = !waiveOnly || STATUSES_REQUIRING_WAIVE_ROLE.includes(status);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/assessments/${control.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          // A waive-only editor can't touch evidence: leave it as it is.
          evidence: waiveOnly ? undefined : evidence || null,
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
          No longer applicable to this System&apos;s current classification or Framework Scope — left in place because it was
          already worked on. Resolve it manually below, or leave it as a record.
        </p>
      )}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2 font-medium">
            <span>{control.code} — {control.title}</span>
            <StatusChip tone={controlAssessmentStatusTone(assessment?.status ?? "NOT_STARTED")}>
              {STATUS_LABELS[assessment?.status ?? "NOT_STARTED"]}
            </StatusChip>
            {control.mandatory && <span className="text-xs text-zinc-500">Mandatory</span>}
          </div>
          <p className="text-sm text-zinc-500">{control.description}</p>
        </div>
      </div>

      {editAccess === "none" ? (
        (assessment?.evidence || assessment?.notes) && (
          <dl className="flex flex-col gap-1 text-sm">
            {assessment?.evidence && (
              <div>
                <dt className="font-medium">Evidence</dt>
                <dd>{assessment.evidence}</dd>
              </div>
            )}
            {assessment?.notes && (
              <div>
                <dt className="font-medium">Notes</dt>
                <dd>{assessment.notes}</dd>
              </div>
            )}
          </dl>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {error && <p className="text-sm text-red-600">{error}</p>}

          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              aria-label={`Status for ${control.code}`}
              className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
              value={status}
              onChange={(event) => setStatus(event.target.value as ControlAssessmentStatus)}
            >
              {availableStatuses.map((candidate) => (
                <option
                  key={candidate}
                  value={candidate}
                  disabled={waiveOnly && !STATUSES_REQUIRING_WAIVE_ROLE.includes(candidate)}
                >
                  {STATUS_LABELS[candidate]}
                </option>
              ))}
            </select>
          </label>

          {!waiveOnly && (
            <label className="flex flex-col gap-1 text-sm">
              Evidence (optional)
              <input
                aria-label={`Evidence for ${control.code}`}
                className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            {STATUSES_REQUIRING_WAIVE_ROLE.includes(status) && control.mandatory
              ? "Justification (required)"
              : "Notes (optional)"}
            <textarea
              aria-label={`Notes for ${control.code}`}
              className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          <Button variant="secondary" onClick={handleSave} disabled={saving || !canSave}>
            Save
          </Button>
        </div>
      )}

      {!stale && editAccess !== "none" && (
        <SelfAssessmentQuestion
          control={control}
          assessment={assessment}
          systemId={systemId}
          userRole={userRole}
          editAccess={editAccess}
          onAnswered={onSaved}
        />
      )}

      <AssessmentQueries
        queries={row.queries}
        systemId={systemId}
        controlId={control.id}
        userRole={userRole}
        isSystemOwner={isSystemOwner}
        readOnly={readOnly}
        onChange={onQueriesChanged}
      />
    </li>
  );
}

type StaleAssessmentApi = NonNullable<Assessment> & { control: Control; queries: AssessmentQuery[] };

export function ControlAssessmentList({
  systemId,
  userRole,
  currentUserId,
  systemOwnerId,
  readOnly = false,
  assessmentEditAccess = "full",
}: {
  systemId: string;
  userRole: UserRole;
  currentUserId: string;
  systemOwnerId: string;
  /** Show Assessments and Assessment Queries without any way to change
   * them — for a role that may read Systems but not write them (#71). */
  readOnly?: boolean;
  /** How far the user's right to edit Assessments / answer Self-Assessment
   * Questions reaches (#78): "waive-only" offers just Waived / Not Applicable
   * / N/A, "none" hides every edit control but keeps Assessment Queries. */
  assessmentEditAccess?: AssessmentEditAccess;
}) {
  const editAccess: AssessmentEditAccess = readOnly ? "none" : assessmentEditAccess;
  const isSystemOwner = currentUserId === systemOwnerId;
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [staleRows, setStaleRows] = useState<AssessmentRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/systems/${systemId}/assessments`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return;
        setRows(
          (body.assessments ?? []).map((row: { control: Control; assessment: Assessment }) => ({
            ...row,
            queries: (row.assessment as (Assessment & { queries?: AssessmentQuery[] }))?.queries ?? [],
          })),
        );
        setStaleRows(
          (body.staleAssessments ?? []).map((assessment: StaleAssessmentApi) => ({
            control: assessment.control,
            assessment,
            queries: assessment.queries ?? [],
          })),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [systemId]);

  if (rows === null) {
    return <p>Loading Controls…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">No Controls apply to this System.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <ControlRow
              key={row.control.id}
              row={row}
              systemId={systemId}
              userRole={userRole}
              isSystemOwner={isSystemOwner}
              readOnly={readOnly}
              editAccess={editAccess}
              onSaved={(assessment) =>
                setRows((prev) =>
                  (prev ?? []).map((r) =>
                    r.control.id === row.control.id ? { ...r, assessment } : r,
                  ),
                )
              }
              onQueriesChanged={(queries) =>
                setRows((prev) =>
                  (prev ?? []).map((r) => (r.control.id === row.control.id ? { ...r, queries } : r)),
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
              <ControlRow
                key={row.control.id}
                row={row}
                systemId={systemId}
                userRole={userRole}
                isSystemOwner={isSystemOwner}
                readOnly={readOnly}
                editAccess={editAccess}
                stale
                onSaved={(assessment) =>
                  setStaleRows((prev) =>
                    prev.map((r) => (r.control.id === row.control.id ? { ...r, assessment } : r)),
                  )
                }
                onQueriesChanged={(queries) =>
                  setStaleRows((prev) =>
                    prev.map((r) => (r.control.id === row.control.id ? { ...r, queries } : r)),
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

"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { canWaiveControl, isSystemOwnerOrAdmin, type AssessmentEditAccess } from "@/lib/system-permissions";
import {
  effectiveNote,
  effectiveSourceDetails,
  effectiveSourceLabel,
  isSharedSource,
  resetToInheritedRefusal,
  type EffectiveStatus,
} from "@/lib/effective-status";
import { ControlQueries } from "./ControlQueries";
import {
  rowSourceKey,
  rowSourceLabel,
  rowStatus,
  type Assessment,
  type AssessmentQuery,
  type AssessmentRow,
  type AssessmentRowApi,
  type Control,
  type SelfAssessmentAnswer,
  type UserRole,
} from "./controls-model";
import { formatDay } from "./system-page-logic";
import { SOURCE_COLOR, STATUS_TEXT } from "./system-page-types";
import type { ControlAssessmentStatus } from "@prisma/client";

/**
 * The Control drawer of the System page's Controls tab (design proposal A "Cockpit", issue #244): one Control
 * at a time, opened from a row or by the hash `#controls/<code>`. It carries everything the old
 * `ControlAssessmentList` did, for the same roles and through the same API routes: the Self-Assessment
 * answer, status, evidence and notes (Organization and Provider sources shown, an own status overrides
 * them), the Assessment Query thread, resetting to inherited and removing a stale Assessment.
 *
 * It is a modal dialog: Escape, the close button and the scrim close it, Tab stays inside it, and the page
 * behind does not scroll. Returning focus to the row that opened it is the Controls tab's job (the drawer
 * does not know the row).
 */

const STATUSES_REQUIRING_WAIVE_ROLE: ControlAssessmentStatus[] = ["NOT_APPLICABLE", "WAIVED"];
const STATUS_KEYS = Object.keys(CONTROL_ASSESSMENT_STATUS_LABEL) as ControlAssessmentStatus[];

const ANSWER_LABELS: Record<SelfAssessmentAnswer, string> = { YES: "Yes", NO: "No", NA: "N/A" };

const OVERRIDE_SENTENCE = "Saving a status below sets this System's own Assessment, which then overrides the inherited one.";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

async function errorOf(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : fallback;
}

function SelfAssessmentQuestion({
  control,
  assessment,
  systemId,
  userRole,
  currentUserId,
  systemOwnerId,
  editAccess,
  onAnswered,
}: {
  control: Control;
  assessment: Assessment;
  systemId: string;
  userRole: UserRole;
  currentUserId: string;
  systemOwnerId: string;
  /** "waive-only" (a Risk Owner who doesn't own the System) offers only N/A (#78). */
  editAccess: AssessmentEditAccess;
  onAnswered: (assessment: NonNullable<Assessment>) => void;
}) {
  // The shared waive rule (#97): an owning Risk Owner can't answer N/A to a mandatory Control, so the button is hidden for them.
  const canAnswerNa = canWaiveControl({ id: currentUserId, role: userRole }, { ownerId: systemOwnerId }, control);
  const [notes, setNotes] = useState(assessment?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);

  // Follow the Assessment when it changes (a save, a reset). Done during render, not in an effect, which would also run after mount.
  const [syncedAssessment, setSyncedAssessment] = useState(assessment);
  if (assessment !== syncedAssessment) {
    setSyncedAssessment(assessment);
    setNotes(assessment?.notes ?? "");
  }

  async function handleAnswer(answer: SelfAssessmentAnswer) {
    setError(null);
    setAnswering(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/assessments/${control.id}/answer`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, notes: notes || null }),
      });
      if (!response.ok) {
        setError(await errorOf(response, "Failed to save answer"));
        return;
      }
      const body = await response.json();
      onAnswered(body.assessment);
    } catch {
      setError("Failed to save answer");
    } finally {
      setAnswering(false);
    }
  }

  if (!control.question) return null;

  return (
    <section className="sc-dsec" aria-label="Self-Assessment Question">
      <h3>Self-Assessment Question</h3>
      <p className="sc-question">{control.question}</p>
      {control.intent && <p className="sc-faint">Intent: {control.intent}</p>}
      {control.examples && control.examples.length > 0 && (
        <div className="sc-faint">
          Examples:
          <ul className="sc-examples">
            {control.examples.map((example) => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      {assessment?.selfAssessmentAnswer && <p className="sc-faint">Recorded answer: {ANSWER_LABELS[assessment.selfAssessmentAnswer]}</p>}

      {(control.mandatory || assessment?.selfAssessmentAnswer === "NA") && (
        <label className="sc-field">
          <span>{control.mandatory ? "Justification (required for N/A)" : "Notes (optional)"}</span>
          <textarea aria-label={`Self-assessment justification for ${control.code}`} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
        </label>
      )}

      <div className="sc-btnrow">
        {editAccess === "full" && (
          <>
            <button type="button" className="hc-btn" onClick={() => handleAnswer("YES")} disabled={answering}>
              Yes
            </button>
            <button type="button" className="hc-btn" onClick={() => handleAnswer("NO")} disabled={answering}>
              No
            </button>
          </>
        )}
        {canAnswerNa && (
          <button type="button" className="hc-btn" onClick={() => handleAnswer("NA")} disabled={answering}>
            N/A
          </button>
        )}
      </div>
      {editAccess === "full" && <p className="sc-faint">Answering No opens a Risk on this System.</p>}
    </section>
  );
}

/**
 * Remove a stale Assessment (#109): the System's owner or an Admin only (the shared `isSystemOwnerOrAdmin`
 * rule). An open Assessment Query blocks the removal, so the button is replaced by a note until it's resolved.
 */
function RemoveStaleAssessment({ control, systemId, hasOpenQuery, onRemoved }: { control: Control; systemId: string; hasOpenQuery: boolean; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    const confirmed = window.confirm(
      `Remove the Assessment for ${control.code}? Its last status, evidence and notes are kept in the ` + "System's Change Event log, but the Assessment itself can't be restored.",
    );
    if (!confirmed) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/assessments/${control.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await errorOf(response, "Failed to remove assessment"));
        return;
      }
      onRemoved();
    } catch {
      setError("Failed to remove assessment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sc-dsec" aria-label="Remove this Assessment">
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      {hasOpenQuery ? (
        <p className="sc-faint">This Assessment can&apos;t be removed while it has an open question. Resolve the question first.</p>
      ) : (
        <div className="sc-btnrow">
          <button type="button" className="hc-btn" onClick={handleRemove} disabled={busy}>
            Remove
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * Reset the System's own Assessment to inherited (#129): the owner or an Admin only, and only where
 * `resetToInheritedRefusal` allows it (the caller checks). A confirmation says what is cleared and what
 * stays. The server answers with the row as the list shows it, so it replaces the row without a refetch.
 */
function ResetToInherited({ control, effective, systemId, onReset }: { control: Control; effective: EffectiveStatus; systemId: string; onReset: (row: AssessmentRowApi) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    const confirmed = window.confirm(
      `Reset ${control.code} to inherited? This clears this System's own status, evidence, notes and ` +
        `Self-Assessment answer, so the Control goes back to what it inherits (${effectiveSourceDetails({ sources: effective.sources.filter((source) => !isSharedSource(source)) }).join("; ")}). ` +
        "Its Assessment Queries and any Risks linked to it stay as they are, and what was cleared is kept in the System's Change Event log.",
    );
    if (!confirmed) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/systems/${systemId}/assessments/${control.id}/reset`, { method: "POST" });
      if (!response.ok) {
        setError(await errorOf(response, "Failed to reset assessment"));
        return;
      }
      onReset(await response.json());
    } catch {
      setError("Failed to reset assessment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sc-dsec" aria-label="Reset to inherited">
      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}
      <div className="sc-btnrow">
        <button type="button" className="hc-btn" onClick={handleReset} disabled={busy}>
          Reset to inherited
        </button>
      </div>
    </section>
  );
}

/**
 * What the status comes from, in a callout: the Organization's implementation (shown live; an own status
 * overrides it), a Provider covering the Control in full (nothing to do), and, for each Shared Offering, the
 * Provider's half next to this System's own responsibility (#125), so the owner knows what their half is.
 */
function SourceCallouts({ row, canEdit }: { row: AssessmentRow; canEdit: boolean }) {
  const { control, effective } = row;
  if (!effective) return null;
  const { source } = effective;
  const shared = effective.sources.filter(isSharedSource);
  return (
    <>
      {source.kind === "ORGANIZATION" && (
        <div className="sc-callout">
          Inherited from the <b>Organization</b>&apos;s implementation. Its status shows here live.{canEdit && ` ${OVERRIDE_SENTENCE}`}
        </div>
      )}
      {source.kind === "ORGANIZATION_DIRECT" && (
        <div className="sc-callout">
          Implemented by the <b>Organization</b>. Its status shows here live.
        </div>
      )}
      {source.kind === "PROVIDER" && source.type === "FULL" && (
        <div className="sc-callout">
          Fully covered by Provider <b>{source.provider.name}</b>. Nothing for this System to do.{canEdit && ` ${OVERRIDE_SENTENCE}`}
        </div>
      )}
      {shared.length > 0 && (
        <div role="note" aria-label={`Customer responsibility for ${control.code}`} className="sc-callout warn">
          <b>Shared with a Provider: customer responsibility, this System&apos;s own half</b>
          {shared.map((candidate) => (
            <p key={candidate.provider.id}>
              Provider &quot;{candidate.provider.name}&quot;: {candidate.customerResponsibility ?? "(no text recorded)"}
            </p>
          ))}
          {canEdit && <span className="sc-faint">Set the status below to Fulfilled once this System has done it.</span>}
        </div>
      )}
    </>
  );
}

export function ControlDrawer({
  row,
  stale = false,
  systemId,
  userRole,
  currentUserId,
  systemOwnerId,
  readOnly,
  editAccess,
  onClose,
  onSaved,
  onQueriesChanged,
  onReset,
  onRemoved,
}: {
  row: AssessmentRow;
  /** A stale Assessment: the Control no longer applies to the System. */
  stale?: boolean;
  systemId: string;
  userRole: UserRole;
  currentUserId: string;
  systemOwnerId: string;
  readOnly: boolean;
  editAccess: AssessmentEditAccess;
  onClose: () => void;
  onSaved: (assessment: NonNullable<Assessment>) => void;
  onQueriesChanged: (queries: AssessmentQuery[]) => void;
  /** Called with the server's row once the Assessment was reset to inherited (applicable rows only). */
  onReset: (row: AssessmentRowApi) => void;
  /** Called once a stale Assessment has been removed (stale rows only). */
  onRemoved: () => void;
}) {
  const { control, assessment, effective } = row;
  const isSystemOwner = currentUserId === systemOwnerId;
  const canWaive = canWaiveControl({ id: currentUserId, role: userRole }, { ownerId: systemOwnerId }, control);
  const titleId = useId();
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeNow = useRef(onClose);
  useEffect(() => {
    closeNow.current = onClose;
  });

  const [status, setStatus] = useState<ControlAssessmentStatus>(assessment?.status ?? "NOT_STARTED");
  const [evidence, setEvidence] = useState(assessment?.evidence ?? "");
  const [notes, setNotes] = useState(assessment?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset the form when the Assessment changes (a save, a reload). Done during render, not in an effect: an
  // effect also ran once after mount and could overwrite a status the user had already picked.
  const [syncedAssessment, setSyncedAssessment] = useState(assessment);
  if (assessment !== syncedAssessment) {
    setSyncedAssessment(assessment);
    setStatus(assessment?.status ?? "NOT_STARTED");
    setEvidence(assessment?.evidence ?? "");
    setNotes(assessment?.notes ?? "");
  }

  // Focus goes into the drawer, Escape closes it (unless something else, like the palette, has focus), and
  // the page behind stays put.
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target === document.body || (target instanceof Node && asideRef.current?.contains(target))) closeNow.current();
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, []);

  // Focus stays in the drawer: a disabled button (Save while saving) or a refresh of the page can drop it.
  useEffect(() => {
    const active = document.activeElement;
    if (asideRef.current?.contains(active) || document.querySelectorAll('[role="dialog"]').length > 1) return;
    closeRef.current?.focus();
  }, [row, saving]);

  function keepFocusInside(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const aside = asideRef.current;
    if (!aside) return;
    const items = [...aside.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === aside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === aside)) {
      event.preventDefault();
      first.focus();
    }
  }

  // Reset to inherited (#129): the shared owner rule, plus the shared reset rule (the server runs both).
  // Hidden for a read-only page and a waive-only Risk Owner.
  const canReset =
    !stale &&
    !readOnly &&
    editAccess === "full" &&
    isSystemOwnerOrAdmin({ id: currentUserId, role: userRole }, { ownerId: systemOwnerId }) &&
    effective !== null &&
    resetToInheritedRefusal({
      applies: true,
      sources: effective.sources,
      own: assessment ? { status: assessment.status, personSet: (assessment.assessedById ?? null) !== null } : null,
    }) === null;

  const waiveOnly = editAccess === "waive-only";
  const currentStatus = assessment?.status ?? "NOT_STARTED";
  // A waive-only editor (a Risk Owner who doesn't own the System) may only pick Waived / Not Applicable;
  // the current status stays visible but unselectable.
  const availableStatuses = STATUS_KEYS.filter((candidate) =>
    waiveOnly
      ? STATUSES_REQUIRING_WAIVE_ROLE.includes(candidate) || candidate === currentStatus
      : canWaive || !STATUSES_REQUIRING_WAIVE_ROLE.includes(candidate) || candidate === currentStatus,
  );
  // Saving a Waived / Not Applicable status this user can't set (it was set by someone else) would only be
  // refused, so leave Save disabled until they pick another.
  const canSave = (!waiveOnly || STATUSES_REQUIRING_WAIVE_ROLE.includes(status)) && (canWaive || !STATUSES_REQUIRING_WAIVE_ROLE.includes(status));

  async function handleSave() {
    setError(null);
    setSaved(false);
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
        setError(await errorOf(response, "Failed to save assessment"));
        return;
      }
      const body = await response.json();
      onSaved(body.assessment);
      setSaved(true);
    } catch {
      setError("Failed to save assessment");
    } finally {
      setSaving(false);
    }
  }

  const shownStatus = rowStatus(row);
  const sourceKey = rowSourceKey(row);
  const canEdit = editAccess !== "none";
  const lastSetBy = assessment?.assessedBy?.name && assessment.assessedAt ? `Last set by ${assessment.assessedBy.name} on ${formatDay(assessment.assessedAt)}` : null;

  return createPortal(
    <div className="sc-drawer-root">
      <div className="sc-scrim" data-testid="control-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={asideRef} className="sc-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={keepFocusInside}>
        <header>
          <button ref={closeRef} type="button" className="hc-btn ghost sc-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <span className="sc-eyebrow">
            {control.code} · {control.category}
          </span>
          <h2 id={titleId}>{control.title}</h2>
          <div className="sc-dmeta">
            <StatusChip tone={controlAssessmentStatusTone(shownStatus)}>{STATUS_TEXT[shownStatus]}</StatusChip>
            <span className="sc-src" style={{ "--c": SOURCE_COLOR[sourceKey] } as CSSProperties}>
              {rowSourceLabel(row)}
            </span>
            {control.mandatory && <span className="sc-tag">Mandatory</span>}
          </div>
        </header>

        <div className="sc-dbody">
          <p>{control.description}</p>

          {stale && (
            <p className="sc-callout warn">
              No longer applicable to this System&apos;s current classification or Framework Scope — left in place because it was already worked on. Resolve it manually below, remove it, or leave it as a
              record.
            </p>
          )}

          {!stale && <SourceCallouts row={row} canEdit={canEdit} />}

          {effective && !stale && (
            <p className="sc-faint">
              {[`Source: ${effectiveSourceLabel(effective)}`, ...effectiveSourceDetails(effective)].join(" · ")}
              {effectiveNote(effective) && `. ${effectiveNote(effective)}`}
            </p>
          )}

          {!canEdit ? (
            (assessment?.evidence || assessment?.notes) && (
              <dl className="sc-readonly">
                {assessment?.evidence && (
                  <div>
                    <dt>Evidence</dt>
                    <dd>{assessment.evidence}</dd>
                  </div>
                )}
                {assessment?.notes && (
                  <div>
                    <dt>Notes</dt>
                    <dd>{assessment.notes}</dd>
                  </div>
                )}
              </dl>
            )
          ) : (
            <form
              className="sc-dform"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSave && !saving) void handleSave();
              }}
            >
              {error && (
                <p role="alert" className="sc-err">
                  {error}
                </p>
              )}

              <label className="sc-field">
                <span>Status</span>
                <select
                  aria-label={`Status for ${control.code}`}
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as ControlAssessmentStatus);
                    setSaved(false);
                  }}
                >
                  {availableStatuses.map((candidate) => (
                    <option
                      key={candidate}
                      value={candidate}
                      disabled={waiveOnly ? !STATUSES_REQUIRING_WAIVE_ROLE.includes(candidate) : !canWaive && STATUSES_REQUIRING_WAIVE_ROLE.includes(candidate)}
                    >
                      {CONTROL_ASSESSMENT_STATUS_LABEL[candidate]}
                    </option>
                  ))}
                </select>
              </label>

              {!waiveOnly && (
                <label className="sc-field">
                  <span>Evidence (optional)</span>
                  <input
                    aria-label={`Evidence for ${control.code}`}
                    value={evidence}
                    onChange={(event) => {
                      setEvidence(event.target.value);
                      setSaved(false);
                    }}
                  />
                </label>
              )}

              <label className="sc-field">
                <span>{STATUSES_REQUIRING_WAIVE_ROLE.includes(status) && control.mandatory ? "Justification (required)" : "Notes (optional)"}</span>
                <textarea
                  aria-label={`Notes for ${control.code}`}
                  value={notes}
                  rows={3}
                  onChange={(event) => {
                    setNotes(event.target.value);
                    setSaved(false);
                  }}
                />
              </label>

              {lastSetBy && <p className="sc-faint">{lastSetBy}</p>}

              <div className="sc-btnrow">
                <button type="submit" className="hc-btn primary" disabled={saving || !canSave}>
                  Save
                </button>
                <button type="button" className="hc-btn" onClick={onClose}>
                  Cancel
                </button>
                {saved && (
                  <span role="status" className="sc-saved">
                    Saved
                  </span>
                )}
              </div>
            </form>
          )}
          {!canEdit && lastSetBy && <p className="sc-faint">{lastSetBy}</p>}

          {!stale && canEdit && (
            <SelfAssessmentQuestion
              control={control}
              assessment={assessment}
              systemId={systemId}
              userRole={userRole}
              currentUserId={currentUserId}
              systemOwnerId={systemOwnerId}
              editAccess={editAccess}
              onAnswered={onSaved}
            />
          )}

          {canReset && effective && <ResetToInherited control={control} effective={effective} systemId={systemId} onReset={onReset} />}

          <ControlQueries
            queries={row.queries}
            systemId={systemId}
            controlId={control.id}
            userRole={userRole}
            isSystemOwner={isSystemOwner}
            readOnly={readOnly}
            canManage={row.canManageQueries}
            onChange={onQueriesChanged}
          />

          {stale && !readOnly && assessment && isSystemOwnerOrAdmin({ id: currentUserId, role: userRole }, { ownerId: systemOwnerId }) && (
            <RemoveStaleAssessment control={control} systemId={systemId} hasOpenQuery={row.queries.some((query) => !query.resolved)} onRemoved={onRemoved} />
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ring } from "@/app/home/HomeGraphics";
import type { PaletteItem } from "@/app/home/JumpPalette";
import { usePagePalette } from "@/components/PaletteProvider";
import { SensitivityChip } from "@/components/SensitivityChip";
import { useRemote } from "@/app/systems/[id]/use-remote";
import { formatComparisonScore } from "@/lib/comparison-score";
import "@/app/home/home.css";
import "@/app/systems/systems.css";
import "./comparisons.css";
import { AddCandidateDialog } from "./AddCandidateDialog";
import { CloseNotSelectedDialog, RecordOutcomeDialog, ReopenComparisonDialog } from "./RecordOutcomeDialog";
import { ChangeComparisonOwnerDialog, ComparisonFormDialog, DeleteComparisonDialog, ParticipantsDialog } from "./ComparisonDialogs";
import {
  CONTROL_FILTERS,
  DIFFERENCE_LABEL,
  IMPACT_LABEL,
  STATUS_LABEL,
  canRemoveCandidate,
  controlCounts,
  filterGroups,
  formatOutcomeDate,
  incompleteText,
  noScoreReason,
  orderedCandidates,
  plural,
  stageLabel,
  tableGroups,
  type Cell,
  type ControlFilter,
} from "./comparison-logic";
import type { CandidateRow, ComparisonDetail } from "./comparison-types";

type Loaded = { detail: ComparisonDetail } | { missing: true };

async function readOne(id: string): Promise<Loaded> {
  const response = await fetch(`/api/comparisons/${id}`);
  if (response.status === 404) return { missing: true };
  if (!response.ok) throw new Error("The Comparison could not be loaded");
  const body = await response.json();
  return { detail: body.comparison as ComparisonDetail };
}

/**
 * One Comparison (#373), design proposal B "Shortlist and differences": a header with the name, need, owner, participants and
 * state; a shortlist with one row per Candidate (Comparison Score, "incomplete: N of M answered", mandatory Controls not
 * fulfilled, open Risks by severity, classification, owner and stage), complete Candidates first by score; a notice when the
 * classification differs; and the Control-by-Control table, which starts with the Controls where the Candidates differ and can
 * show only the mandatory ones or all of them, grouped under a separator per Framework. Everything the reader sees comes from
 * `GET /api/comparisons/[id]`, which builds only the limited summary of a Candidate. The write controls follow the response's
 * `canManage` and the Candidate's owner; the routes enforce the rules.
 */
export function ComparisonPage({ id, userId, role }: { id: string; userId: string; role: string }) {
  const read = useCallback(() => readOne(id), [id]);
  const { data, failed, reload } = useRemote(read);

  const detail = data && "detail" in data ? data.detail : null;
  const candidates = useMemo(() => (detail ? orderedCandidates(detail.candidates) : []), [detail]);

  const paletteItems: PaletteItem[] = useMemo(
    () => [
      { group: "Comparison", icon: "layers" as const, label: "All Comparisons", meta: "Systems", href: "/comparisons" },
      ...candidates.filter((candidate) => candidate.canOpen).map((candidate) => ({ group: "Candidates", icon: "system" as const, label: candidate.name, meta: "Open the System", href: `/systems/${candidate.systemId}` })),
    ],
    [candidates],
  );
  usePagePalette({ items: paletteItems, placeholder: "Jump to a Candidate…" });

  if (failed && data === null) {
    return (
      <div className="hc cmp">
        <div className="hc-card hc-done" role="alert">
          <h1>The Comparison could not be loaded</h1>
          <button type="button" className="hc-btn" onClick={reload}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="hc cmp">
        <div className="hc-card hc-done" role="status">
          <h1>Loading the Comparison…</h1>
        </div>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="hc cmp">
        <div className="hc-card hc-done" role="status">
          <h1>Comparison not found</h1>
          <p>It does not exist, or you can&apos;t see it.</p>
          <Link href="/comparisons" className="hc-btn">
            ← Comparisons
          </Link>
        </div>
      </div>
    );
  }
  return <ComparisonBody detail={detail} candidates={candidates} userId={userId} isAdmin={role === "ADMIN"} reload={reload} />;
}

function ComparisonBody({ detail, candidates, userId, isAdmin, reload }: { detail: ComparisonDetail; candidates: CandidateRow[]; userId: string; isAdmin: boolean; reload: () => void }) {
  const router = useRouter();
  const [dialog, setDialog] = useState<null | "edit" | "participants" | "owner" | "delete" | "add" | "record" | "reopen" | "close-not-selected">(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // With fewer than two Candidates nothing can differ, so the table starts with every Control.
  const [filter, setFilter] = useState<ControlFilter>(candidates.length < 2 ? "all" : "differ");

  const groups = useMemo(() => tableGroups(detail.controlGroups, candidates), [detail.controlGroups, candidates]);
  const counts = controlCounts(groups);
  const shownGroups = filterGroups(groups, filter);
  const readOnly = detail.closed;

  async function removeCandidate(systemId: string) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/comparisons/${detail.id}/candidates/${systemId}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(typeof body?.error === "string" ? body.error : "The Candidate could not be removed");
      else {
        setRemoving(null);
        reload();
      }
    } catch {
      setError("The Candidate could not be removed");
    } finally {
      setBusy(false);
    }
  }

  const differences = detail.classificationDifferences.map((key) => DIFFERENCE_LABEL[key] ?? key);

  return (
    <div className="hc cmp" data-page-id="COMPARISON">
      <nav className="cmp-crumb" aria-label="Breadcrumb">
        <Link href="/systems">Systems</Link> / <Link href="/comparisons">Comparisons</Link>
      </nav>

      <section className="hc-hero" aria-labelledby="cmp-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Comparison</span>
            <span className={`cmp-state ${detail.closed ? "closed" : "open"}`}>{detail.closed ? "Closed" : "Open"}</span>
            {detail.outcome && (
              <span className="cmp-frozen" title="The figures were frozen when the outcome was recorded">
                as of {formatOutcomeDate(detail.outcome.recordedAt)}
              </span>
            )}
          </div>
          <h1 id="cmp-title">{detail.name}</h1>
          <p className="hc-lede">{detail.need ?? "No need described yet."}</p>
          <dl className="cmp-meta">
            <div>
              <dt>Owner</dt>
              <dd>{detail.owner.name}</dd>
            </div>
            <div>
              <dt>Participants</dt>
              <dd>{detail.participants.length > 0 ? detail.participants.map((person) => person.name).join(", ") : "None named"}</dd>
            </div>
            <div>
              <dt>Candidates</dt>
              <dd>{plural(candidates.length, "Candidate")}</dd>
            </div>
          </dl>
          {detail.canManage && readOnly && (
            <div className="actions">
              <button type="button" className="hc-btn" onClick={() => setDialog("reopen")}>
                Reopen
              </button>
              {candidates.some((candidate) => candidate.canCloseAsNotSelected && !candidate.chosen) && (
                <button type="button" className="hc-btn" onClick={() => setDialog("close-not-selected")}>
                  Close as Not selected
                </button>
              )}
            </div>
          )}
          {(detail.canManage || detail.canAddCandidate) && !readOnly && (
            <div className="actions">
              {detail.canAddCandidate && (
                <button type="button" className="hc-btn primary" onClick={() => setDialog("add")}>
                  Add Candidate
                </button>
              )}
              {detail.canManage && (
                <>
                  <button type="button" className="hc-btn primary" disabled={candidates.length < 2} aria-describedby={candidates.length < 2 ? "cmp-record-hint" : undefined} onClick={() => setDialog("record")}>
                    Record outcome
                  </button>
                  <button type="button" className="hc-btn" onClick={() => setDialog("edit")}>
                    Edit name and need
                  </button>
                  <button type="button" className="hc-btn" onClick={() => setDialog("participants")}>
                    Participants
                  </button>
                  {isAdmin && (
                    <button type="button" className="hc-btn" onClick={() => setDialog("owner")}>
                      Change owner
                    </button>
                  )}
                  <button type="button" className="hc-btn danger" onClick={() => setDialog("delete")}>
                    Delete
                  </button>
                </>
              )}
            </div>
          )}
          {detail.canManage && !readOnly && candidates.length < 2 && (
            <p id="cmp-record-hint" className="cmp-hint">
              Add at least two Candidates to record an outcome.
            </p>
          )}
        </div>
        {candidates.length > 0 && (
          <div className="hc-move">
            <Ring
              segments={candidates.filter((candidate) => candidate.score.score !== null).slice(0, 1).map((candidate): [number, string] => [candidate.score.score ?? 0, "var(--rg-success)"])}
              size={84}
              stroke={10}
              center={formatComparisonScore(candidates[0].score.score)}
              sub="top score"
              label={`Top Comparison Score ${formatComparisonScore(candidates[0].score.score)}`}
            />
          </div>
        )}
      </section>

      {detail.outcome && <OutcomeCard outcome={detail.outcome} candidates={candidates} />}

      {error && (
        <p className="cmp-note warn" role="alert">
          {error}
        </p>
      )}

      {differences.length > 0 && (
        <aside className="cmp-note warn" role="note">
          <b>The Candidates differ in classification:</b> {differences.join(", ")}. A different classification means different Controls apply, so their scores rest on different sets of Controls.
        </aside>
      )}

      <section className="hc-card" aria-labelledby="cmp-sl-h">
        <div className="hc-card-h">
          <h2 id="cmp-sl-h">Shortlist</h2>
          <p>Complete Candidates first, highest score first; then incomplete ones.</p>
        </div>
        {candidates.length === 0 ? (
          <div className="hc-done">
            <h3>No Candidates yet</h3>
            <p>A Comparison needs two to five Candidates to set side by side.{detail.canAddCandidate && !readOnly ? " Use Add Candidate to put Systems in it, or to create a new one." : ""}</p>
          </div>
        ) : (
          <ol className="cmp-sl">
            {candidates.map((candidate, index) => (
              <CandidateRowView
                key={candidate.systemId}
                candidate={candidate}
                rank={index + 1}
                removable={!readOnly && canRemoveCandidate(detail, candidate, userId)}
                confirming={removing === candidate.systemId}
                busy={busy}
                onAsk={() => setRemoving(candidate.systemId)}
                onCancel={() => setRemoving(null)}
                onConfirm={() => removeCandidate(candidate.systemId)}
              />
            ))}
          </ol>
        )}
      </section>

      {candidates.length > 0 && (
        <section className="hc-card" aria-labelledby="cmp-mx-h">
          <div className="hc-card-h">
            <h2 id="cmp-mx-h">Control by Control</h2>
            <p>{plural(counts.all, "first-round Control")} across the Candidates</p>
          </div>
          <div className="hc-tabs" role="tablist" aria-label="Which Controls to show">
            {CONTROL_FILTERS.map(({ key, label }) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}>
                {label}
                <span className="n">{counts[key]}</span>
              </button>
            ))}
          </div>
          <Legend />
          {shownGroups.length === 0 ? (
            <p className="cmp-lane-empty">
              {counts.all === 0
                ? "No first-round Controls to compare: nothing is marked first round for the Candidates' Frameworks."
                : filter === "differ"
                  ? "Every Candidate has the same status on every first-round Control."
                  : "No mandatory first-round Controls."}
            </p>
          ) : (
            <div className="cmp-mx-wrap">
              <table className="cmp-mx">
                <thead>
                  <tr>
                    <th scope="col" className="ctl">
                      Control
                    </th>
                    {candidates.map((candidate) => (
                      <th key={candidate.systemId} scope="col" className="cand">
                        {candidate.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                {shownGroups.map((group) => (
                  <tbody key={group.key}>
                    <tr className="grp">
                      <th colSpan={candidates.length + 1} scope="colgroup">
                        <span className="grp-in">
                          <span>{group.name ?? "Other Controls"}</span>
                          <small>{plural(group.rows.length, "Control")}</small>
                        </span>
                      </th>
                    </tr>
                    {group.rows.map((row) => (
                      <tr key={row.controlId} className={row.differs ? "diff" : undefined}>
                        <th scope="row" className="ctl">
                          <span className="code">{row.code}</span>
                          {row.title}
                          {row.mandatory && <span className="mand">Mandatory</span>}
                        </th>
                        {row.cells.map((cell, index) => (
                          <td key={candidates[index].systemId} className="cell">
                            <StatusCell cell={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>
          )}
        </section>
      )}

      {dialog === "add" && (
        <AddCandidateDialog
          id={detail.id}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog === "record" && (
        <RecordOutcomeDialog
          id={detail.id}
          candidates={candidates}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog === "close-not-selected" && (
        <CloseNotSelectedDialog
          id={detail.id}
          candidates={candidates}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog === "reopen" && (
        <ReopenComparisonDialog
          id={detail.id}
          name={detail.name}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog === "edit" && (
        <ComparisonFormDialog
          comparison={detail}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog === "participants" && <ParticipantsDialog id={detail.id} owner={detail.owner} participants={detail.participants} onClose={() => setDialog(null)} onChanged={reload} />}
      {dialog === "owner" && (
        <ChangeComparisonOwnerDialog
          id={detail.id}
          owner={detail.owner}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            reload();
          }}
        />
      )}
      {dialog === "delete" && <DeleteComparisonDialog id={detail.id} name={detail.name} onClose={() => setDialog(null)} onDone={() => router.push("/comparisons")} />}
    </div>
  );
}

/** The recorded outcome of a closed Comparison (design proposal B): the chosen Candidate or None chosen, the comment, who recorded it and when, and a note when the chosen Candidate was not the top scorer. */
function OutcomeCard({ outcome, candidates }: { outcome: NonNullable<ComparisonDetail["outcome"]>; candidates: CandidateRow[] }) {
  const date = formatOutcomeDate(outcome.recordedAt);
  const chosenCandidate = outcome.chosen ? candidates.find((candidate) => candidate.systemId === outcome.chosen?.id) : undefined;
  return (
    <section className="hc-card cmp-outcome" aria-labelledby="cmp-out-h">
      <div className="hc-card-h">
        <h2 id="cmp-out-h">Outcome</h2>
        <p>
          Recorded {date}
          {outcome.recordedBy ? ` by ${outcome.recordedBy.name}` : ""}
        </p>
      </div>
      <div className="cmp-outcome-b">
        <p className="pick">
          {outcome.chosen ? (
            <>
              <span className="cmp-chosen">Chosen</span> {chosenCandidate?.canOpen ? <Link href={`/systems/${outcome.chosen.id}`}>{outcome.chosen.name}</Link> : outcome.chosen.name}
              {!chosenCandidate && <small> (this System has since been deleted)</small>}
            </>
          ) : (
            <>
              <span className="cmp-chosen none">None chosen</span> <small>No Candidate was picked.</small>
            </>
          )}
        </p>
        <blockquote>{outcome.comment}</blockquote>
        {outcome.chosenNotTopScorer && (
          <p className="cmp-note warn" role="note">
            <b>The chosen Candidate was not the top scorer.</b> That is allowed: price, fit and contract terms are outside the Comparison Score.
          </p>
        )}
        <p className="cmp-hint">This Comparison is read-only. The scores, counts and Control statuses below are frozen as of {date}. Reopen it to make changes and see live figures.</p>
      </div>
    </section>
  );
}

const RISKS = [
  ["CRITICAL", "Critical"],
  ["HIGH", "High"],
  ["MEDIUM", "Medium"],
  ["LOW", "Low"],
] as const;

function CandidateRowView({
  candidate,
  rank,
  removable,
  confirming,
  busy,
  onAsk,
  onCancel,
  onConfirm,
}: {
  candidate: CandidateRow;
  rank: number;
  removable: boolean;
  confirming: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { score, classification } = candidate;
  const incomplete = incompleteText(candidate);
  const reason = noScoreReason(candidate);
  const openRisks = RISKS.filter(([key]) => candidate.openRisks[key] > 0);
  const percent = score.score === null ? 0 : Math.round(score.score * 100);

  return (
    <li className={`cmp-row${candidate.rejected || candidate.notSelected ? " rejected" : ""}${candidate.chosen ? " chosen" : ""}`}>
      <span className="rank" title="Position in the order">
        {rank}
      </span>
      <div className="main">
        <span className="top">
          {candidate.canOpen ? (
            <Link href={`/systems/${candidate.systemId}`} className="cname">
              {candidate.name}
            </Link>
          ) : (
            <>
              <span className="cname plain">{candidate.name}</span>
              <span className="lim" title="You can't open this System, so you see a limited summary: no evidence, notes or Risk details.">
                Limited summary
              </span>
            </>
          )}
          {candidate.chosen && <span className="cmp-chosen">Chosen</span>}
        </span>
        <small>
          {candidate.vendor ? `${candidate.vendor} · ` : ""}owner {candidate.owner.name} · {candidate.rejected ? <span className="cmp-rejected">Rejected</span> : candidate.notSelected ? <span className="cmp-rejected">Not selected</span> : stageLabel(candidate.stage)}
        </small>
      </div>
      <div className="score-box">
        <span className={`score${score.score === null ? " none" : ""}`} aria-label={`Comparison Score ${formatComparisonScore(score.score)}`}>
          {formatComparisonScore(score.score)}
        </span>
        <div className="bar" role="img" aria-label={`Comparison Score ${formatComparisonScore(score.score)}`}>
          <div style={{ width: `${percent}%` }} />
        </div>
        {score.score !== null && (
          <small>
            {score.fulfilledCount} of {score.countedCount} fulfilled
          </small>
        )}
      </div>
      <div className="facts">
        {incomplete && <span className="cmp-flag warn">{incomplete}</span>}
        {reason && <span className="cmp-reason">{reason}</span>}
        <span className={`cmp-flag${score.mandatoryNotFulfilledCount > 0 ? " bad" : ""}`}>
          {score.mandatoryNotFulfilledCount} mandatory not fulfilled
        </span>
        <span className="cmp-risks" aria-label="Open Risks">
          {openRisks.length === 0 ? (
            <span className="muted">No open Risks</span>
          ) : (
            openRisks.map(([key, label]) => (
              <span key={key} className={`r-${key}`}>
                <b>{candidate.openRisks[key]}</b> {label}
              </span>
            ))
          )}
        </span>
      </div>
      <div className="cls">
        {classification.deploymentFacets.map((facet) => (
          <span key={facet.id} className="cmp-tag">
            {facet.name}
          </span>
        ))}
        <SensitivityChip level={classification.sensitivityLevel} size="sm" />
        <span className="cmp-tag">Integrity {classification.integrityImpactLevel ? IMPACT_LABEL[classification.integrityImpactLevel] ?? classification.integrityImpactLevel : "not set"}</span>
        <span className="cmp-tag">Availability {classification.availabilityImpactLevel ? IMPACT_LABEL[classification.availabilityImpactLevel] ?? classification.availabilityImpactLevel : "not set"}</span>
        {classification.frameworkScope.length > 0 && <small>Frameworks: {classification.frameworkScope.map((framework) => framework.name).join(", ")}</small>}
      </div>
      {removable && (
        <div className="act">
          {confirming ? (
            <>
              <button type="button" className="hc-btn danger" disabled={busy} onClick={onConfirm} aria-label={`Confirm removing ${candidate.name}`}>
                Remove it
              </button>
              <button type="button" className="hc-btn" onClick={onCancel}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="hc-btn" onClick={onAsk} aria-label={`Remove ${candidate.name} from the Comparison`}>
              Remove Candidate
            </button>
          )}
        </div>
      )}
    </li>
  );
}

const GLYPH: Record<string, string> = { FULFILLED: "✓", IN_PROGRESS: "◐", NOT_STARTED: "○", WAIVED: "~", NOT_APPLICABLE: "–" };

/** A Control's status for one Candidate: a glyph and a word (the word is the state, the colour only adds to it); null is a Control that does not apply to the Candidate. */
function StatusCell({ cell }: { cell: Cell }) {
  if (cell === null) {
    return (
      <span className="cmp-st st-X">
        <i className="g" aria-hidden="true">
          ×
        </i>
        <span className="l">Does not apply</span>
      </span>
    );
  }
  return (
    <span className={`cmp-st st-${cell}`}>
      <i className="g" aria-hidden="true">
        {GLYPH[cell]}
      </i>
      <span className="l">{STATUS_LABEL[cell]}</span>
    </span>
  );
}

function Legend() {
  return (
    <p className="cmp-legend">
      {Object.entries(GLYPH).map(([status, glyph]) => (
        <span key={status}>
          <i className={`g st-${status}`} aria-hidden="true">
            {glyph}
          </i>
          {STATUS_LABEL[status as keyof typeof STATUS_LABEL]}
        </span>
      ))}
      <span>
        <i className="g st-X" aria-hidden="true">
          ×
        </i>
        Does not apply to the Candidate
      </span>
    </p>
  );
}

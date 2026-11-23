"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { frameworkLabel } from "@/lib/framework-label";
import { formatCompliancePercentage } from "@/lib/requirement-status-rules";
import type { BoundaryStatement } from "@/lib/boundary-statement-rules";
import { ExportLinks, StatementPanel } from "./StatementPanel";
import { MEMBER_STATE_LABEL, type BoundaryDetail, type BoundaryFrameworkCompliance, type JoinPreview, type MemberState, type PreparedCandidate } from "@/lib/compliance-boundary";

type Candidate = { id: string; name: string; state: MemberState };

/**
 * A Compliance Boundary's page (#418). The members are the page's props: adding or removing a System calls the API and then
 * refreshes the page, so the list, the links and the candidates all come from the server again. A System in evaluation is
 * labelled "Not yet operating" and a closed one "Closed" (it stays listed, and can be removed, but can't be added).
 */
export function BoundaryView({
  boundary,
  compliance,
  statement,
  linkableSystemIds,
  candidates,
  prepared,
  canManageMembers,
  canCurate,
}: {
  boundary: BoundaryDetail;
  compliance: BoundaryFrameworkCompliance[];
  statement: BoundaryStatement;
  linkableSystemIds: string[];
  candidates: Candidate[];
  prepared: PreparedCandidate[];
  canManageMembers: boolean;
  canCurate: boolean;
}) {
  const router = useRouter();
  const [systemId, setSystemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ systemId: string; status: "loading" | "ready" | "error"; data?: JoinPreview; message?: string } | null>(null);
  const previewRequest = useRef(0);
  const [retiring, setRetiring] = useState(false);
  const [comment, setComment] = useState("");
  const retired = boundary.retirement !== null;
  /** Controls that change a Boundary are for an active one only: a retired Boundary is a read-only record (#424). */
  const canChangeMembers = canManageMembers && !retired;

  /** Reads what adding the System would do (read-only). A late answer for a System no longer chosen is dropped. */
  async function choose(id: string) {
    setSystemId(id);
    setError(null);
    const request = ++previewRequest.current;
    if (!id) {
      setPreview(null);
      return;
    }
    setPreview({ systemId: id, status: "loading" });
    const fail = (message: string) => request === previewRequest.current && setPreview({ systemId: id, status: "error", message });
    try {
      const response = await fetch(`/api/compliance-boundaries/${boundary.id}/systems/${id}/preview`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) return fail(body.error ?? "Failed to load the preview");
      if (request === previewRequest.current) setPreview({ systemId: id, status: "ready", data: body.preview });
    } catch {
      fail("Failed to load the preview");
    }
  }

  async function change(request: () => Promise<Response>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      const response = await request();
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? fallback);
        return;
      }
      previewRequest.current++;
      setSystemId("");
      setPreview(null);
      router.refresh();
    } catch {
      setError(fallback);
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    change(
      () =>
        fetch(`/api/compliance-boundaries/${boundary.id}/systems`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ systemId }),
        }),
      "Failed to add the System",
    );
  const remove = (id: string) => change(() => fetch(`/api/compliance-boundaries/${boundary.id}/systems/${id}`, { method: "DELETE" }), "Failed to remove the System");

  /** Retires the Boundary for good (#424): needs the comment, then the page refreshes into its read-only form. */
  async function retire() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/compliance-boundaries/${boundary.id}/retire`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Failed to retire the Compliance Boundary");
        return;
      }
      setRetiring(false);
      router.refresh();
    } catch {
      setError("Failed to retire the Compliance Boundary");
    } finally {
      setBusy(false);
    }
  }

  const linkable = new Set(linkableSystemIds);
  return (
    <div className="hc cb">
      <p className="cb-crumbs">
        <Link href="/compliance-boundaries">Compliance Boundaries</Link> / {boundary.name}
      </p>
      <section className="hc-hero" aria-labelledby="cb-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Compliance Boundary</span>
          </div>
          <h1 id="cb-title">{boundary.name}</h1>
          {boundary.description && <p className="hc-lede">{boundary.description}</p>}
          {!retired && (
            <div className="cb-actions">
              <ExportLinks boundaryId={boundary.id} csvLabel="Export whole statement (CSV)" printLabel="Print whole statement" />
            </div>
          )}
        </div>
        {(canCurate || canManageMembers) && !retired && (
          <div className="cb-actions">
            {canCurate && (
              <Link href={`/compliance-boundaries/${boundary.id}/edit`} className="hc-btn">
                Edit
              </Link>
            )}
            {canManageMembers && (
              <button type="button" className="hc-btn danger" disabled={busy || retiring} onClick={() => setRetiring(true)}>
                Retire
              </button>
            )}
          </div>
        )}
      </section>

      {boundary.retirement && (
        <section className="cb-retired-banner" role="status" aria-labelledby="cb-retired-h">
          <h2 id="cb-retired-h">Retired</h2>
          <p>
            Retired on {new Date(boundary.retirement.retiredAt).toISOString().slice(0, 10)}
            {boundary.retirement.retiredByName ? ` by ${boundary.retirement.retiredByName}` : ""}. It brings no Framework into any System&apos;s scope and is kept as a read-only record.
          </p>
          <p>
            <b>Why:</b> {boundary.retirement.comment}
          </p>
        </section>
      )}

      {retiring && !retired && (
        <section className="cb-retire" aria-labelledby="cb-retire-h">
          <h3 id="cb-retire-h">Retire {boundary.name}</h3>
          <p>
            Retiring is final: it can&apos;t be undone, and you would create a new Compliance Boundary instead. The Compliance Boundary stops bringing its Frameworks into the scope of its {boundary.members.length}{" "}
            {boundary.members.length === 1 ? "System" : "Systems"}, so their Control Assessments are recomputed: untouched Assessments of Controls that no longer apply are removed, ones already worked on are kept and show as stale. Each member System gets a Change Event. The
            Compliance Boundary stays as a read-only record of its name, Frameworks, Systems and dates.
          </p>
          <label className="cb-field">
            <span>Why is it retired? (required)</span>
            <textarea className="cb-input" value={comment} onChange={(event) => setComment(event.target.value)} maxLength={1000} required />
          </label>
          {error && (
            <p role="alert" className="cb-error">
              {error}
            </p>
          )}
          <div className="cb-actions">
            <button type="button" className="hc-btn danger" disabled={busy || comment.trim() === ""} onClick={retire}>
              Retire permanently
            </button>
            <button
              type="button"
              className="hc-btn"
              disabled={busy}
              onClick={() => {
                setRetiring(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className="hc-card" aria-labelledby="cb-about-h">
        <div className="hc-card-h">
          <h2 id="cb-about-h">About</h2>
        </div>
        <div className="hc-card-b">
          <dl className="cb-facts">
            <dt>Frameworks</dt>
            <dd>
              <span className="cb-tags">
                {boundary.frameworks.map((framework) => (
                  <span key={framework.id} className="cb-tag fw">
                    {frameworkLabel(framework)}
                  </span>
                ))}
              </span>
            </dd>
            <dt>Business Unit</dt>
            <dd>{boundary.businessUnit?.name ?? "None"}</dd>
            <dt>Boundary Owner</dt>
            <dd>{boundary.boundaryOwner?.name ?? "No Boundary Owner yet"}</dd>
          </dl>
        </div>
      </section>

      {!retired && (
      <section className="hc-card" aria-labelledby="cb-compliance-h">
        <div className="hc-card-h">
          <h2 id="cb-compliance-h">Compliance Percentage</h2>
          <p>Counted Systems only</p>
        </div>
        <div className="hc-card-b">
          <ul className="cb-members">
            {boundary.frameworks.map((framework) => {
              const figures = compliance.find((entry) => entry.frameworkId === framework.id);
              return (
                <li key={framework.id} className="cb-member" data-testid={`cb-compliance-${framework.id}`}>
                  <b>{frameworkLabel(framework)}</b>
                  <span className="cb-grow" />
                  <span>{formatCompliancePercentage(figures?.percentage ?? null)}</span>
                  {figures && figures.applicable > 0 && (
                    <span className="cb-tag">
                      {figures.met} of {figures.applicable} Requirements Met
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </section>
      )}

      <StatementPanel statement={statement} />

      <section className="hc-card" aria-labelledby="cb-members-h">
        <div className="hc-card-h">
          <h2 id="cb-members-h">Systems</h2>
          <p>{boundary.members.length}</p>
        </div>
        <div className="hc-card-b cb">
          {error && !retiring && (
            <p role="alert" className="cb-error">
              {error}
            </p>
          )}
          {boundary.members.length === 0 ? (
            <p className="cb-empty">No Systems in this Compliance Boundary yet.</p>
          ) : (
            <ul className="cb-members">
              {boundary.members.map((member) => (
                <li key={member.systemId} className={`cb-member${member.state === "CLOSED" ? " closed" : ""}`}>
                  {linkable.has(member.systemId) ? <Link href={`/systems/${member.systemId}`}>{member.name}</Link> : <b>{member.name}</b>}
                  <span className={`cb-tag${member.state === "OPERATING" ? "" : " warn"}`}>
                    {member.state === "CLOSED" ? (member.status === "NOT_SELECTED" ? "Closed: Not selected" : "Closed: Rejected") : MEMBER_STATE_LABEL[member.state]}
                  </span>
                  <span className="cb-grow" />
                  {canChangeMembers && (
                    <button type="button" className="hc-btn" disabled={busy} onClick={() => remove(member.systemId)} aria-label={`Remove ${member.name}`}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canChangeMembers && (
            <section aria-labelledby="cb-candidates-h" className="cb-candidates">
              <h3 id="cb-candidates-h">Candidates</h3>
              <p className="cb-empty">Systems prepared for (they declare) one of this Boundary&apos;s Frameworks that are not in it. Their Controls already apply, so adding one is often a small step.</p>
              {prepared.length === 0 ? (
                <p className="cb-empty">No candidates: no System outside this Compliance Boundary is prepared for its Frameworks.</p>
              ) : (
                <ul className="cb-members">
                  {prepared.map((candidate) => (
                    <li key={candidate.id} className="cb-member">
                      <b>{candidate.name}</b>
                      {candidate.state === "NOT_YET_OPERATING" && <span className="cb-tag warn">{MEMBER_STATE_LABEL.NOT_YET_OPERATING}</span>}
                      <span className="cb-tags">
                        {candidate.preparedFor.map((framework) => (
                          <span key={framework.id} className="cb-tag fw">
                            Prepared for {frameworkLabel(framework)}
                          </span>
                        ))}
                      </span>
                      <span className="cb-grow" />
                      <button type="button" className="hc-btn" disabled={busy} onClick={() => choose(candidate.id)} aria-label={`Preview adding ${candidate.name}`}>
                        Preview and add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {canChangeMembers && (
            <div className="cb-add">
              <label className="cb-field">
                <span>Add a System</span>
                <select className="cb-input" value={systemId} onChange={(event) => void choose(event.target.value)}>
                  <option value="">Choose a System</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                      {candidate.state === "NOT_YET_OPERATING" ? " (not yet operating)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="hc-btn primary" disabled={busy || !systemId || preview?.status === "loading"} onClick={add}>
                Add System
              </button>
            </div>
          )}
          {canChangeMembers && preview && <JoinPreviewPanel preview={preview} />}
        </div>
      </section>
    </div>
  );
}

const SHOWN_CONTROLS = 10;

const changeReviewSentence = (data: JoinPreview) =>
  data.startsChangeReview ? "The System is Onboarded: adding it starts a Change Review." : data.onboarded ? "The System is Onboarded, but no Change Review starts." : "No Change Review starts: the System is not Onboarded.";

/** What adding the chosen System would do (#423): the Controls that would newly apply, how many are already Fulfilled, and any Change Review. */
function JoinPreviewPanel({ preview }: { preview: { status: "loading" | "ready" | "error"; data?: JoinPreview; message?: string } }) {
  if (preview.status === "loading") return <p className="cb-empty" role="status">Checking what adding this System would bring...</p>;
  if (preview.status === "error" || !preview.data) {
    return (
      <p role="alert" className="cb-error">
        {preview.message ?? "Failed to load the preview"}
      </p>
    );
  }
  const { data } = preview;
  const fulfilled = data.newControls.filter((control) => control.fulfilled).length;
  return (
    <div className="cb-preview" role="region" aria-label={`Preview of adding ${data.systemName}`}>
      <h3>If you add {data.systemName}</h3>
      {data.newControls.length === 0 ? (
        <>
          <p>Nothing new applies.</p>
          <p>{changeReviewSentence(data)}</p>
        </>
      ) : (
        <>
          <p>
            <b>{data.newControls.length}</b> {data.newControls.length === 1 ? "Control would" : "Controls would"} newly apply, <b>{fulfilled}</b> already effectively Fulfilled (inheritance counts).{" "}
            {data.newControls.length - fulfilled > 0 && `${data.newControls.length - fulfilled} would start as work for the System's owner.`}
          </p>
          <ul className="cb-members">
            {data.newControls.slice(0, SHOWN_CONTROLS).map((control) => (
              <li key={control.id} className="cb-member">
                <b>{control.code}</b> <span>{control.title}</span>
                <span className="cb-grow" />
                {control.fulfilled && <span className="cb-tag fw">Fulfilled</span>}
              </li>
            ))}
          </ul>
          {data.newControls.length > SHOWN_CONTROLS && <p className="cb-empty">and {data.newControls.length - SHOWN_CONTROLS} more</p>}
          <p>{changeReviewSentence(data)}</p>
        </>
      )}
    </div>
  );
}

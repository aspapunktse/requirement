"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { frameworkLabel } from "@/lib/framework-label";
import { FRAMEWORKS_LATER_NOTE, MEMBER_STATE_LABEL, type BoundaryDetail, type MemberState } from "@/lib/compliance-boundary";

type Candidate = { id: string; name: string; state: MemberState };

/**
 * A Compliance Boundary's page (#418). The members are the page's props: adding or removing a System calls the API and then
 * refreshes the page, so the list, the links and the candidates all come from the server again. A System in evaluation is
 * labelled "Not yet operating" and a closed one "Closed" (it stays listed, and can be removed, but can't be added).
 */
export function BoundaryView({
  boundary,
  linkableSystemIds,
  candidates,
  canManageMembers,
  canCurate,
}: {
  boundary: BoundaryDetail;
  linkableSystemIds: string[];
  candidates: Candidate[];
  canManageMembers: boolean;
  canCurate: boolean;
}) {
  const router = useRouter();
  const [systemId, setSystemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setSystemId("");
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
        </div>
        {canCurate && (
          <div className="cb-actions">
            <Link href={`/compliance-boundaries/${boundary.id}/edit`} className="hc-btn">
              Edit
            </Link>
          </div>
        )}
      </section>

      <p className="cb-note">{FRAMEWORKS_LATER_NOTE}.</p>

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

      <section className="hc-card" aria-labelledby="cb-members-h">
        <div className="hc-card-h">
          <h2 id="cb-members-h">Systems</h2>
          <p>{boundary.members.length}</p>
        </div>
        <div className="hc-card-b cb">
          {error && (
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
                  {canManageMembers && (
                    <button type="button" className="hc-btn" disabled={busy} onClick={() => remove(member.systemId)} aria-label={`Remove ${member.name}`}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canManageMembers && (
            <div className="cb-add">
              <label className="cb-field">
                <span>Add a System</span>
                <select className="cb-input" value={systemId} onChange={(event) => setSystemId(event.target.value)}>
                  <option value="">Choose a System</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                      {candidate.state === "NOT_YET_OPERATING" ? " (not yet operating)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="hc-btn primary" disabled={busy || !systemId} onClick={add}>
                Add System
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

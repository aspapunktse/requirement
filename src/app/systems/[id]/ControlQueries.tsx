"use client";

import { useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import type { AssessmentQuery, UserRole } from "./controls-model";

/**
 * The Assessment Query thread of a Control, in the Control drawer (ported from the old
 * `ControlAssessmentList`): raise a question, reply, resolve, with the attribution the server allows the
 * viewer to see (#201). Who may do what is decided from the server's per-Control answer, else the role.
 */

// Mirrors src/lib/assessment-queries.ts's ROLES_ALLOWED_TO_MANAGE_QUERIES — duplicated here (not imported)
// because that module pulls in the Prisma client, which can't be bundled into a "use client" component.
const ROLES_ALLOWED_TO_MANAGE_QUERIES: UserRole[] = ["REVIEWER", "RISK_OWNER", "ADMIN"];

async function errorOf(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : fallback;
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
      const response = await fetch(`/api/systems/${systemId}/assessments/${controlId}/queries/${query.id}${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        setError(await errorOf(response, "Failed to update this question"));
        return;
      }
      const responseBody = await response.json();
      onUpdated(responseBody.query);
      setReply("");
    } catch {
      setError("Failed to update this question");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="sc-thread">
      <div className="sc-thread-h">
        <StatusChip tone={query.resolved ? "success" : "warn"}>{query.resolved ? "Resolved" : "Open"}</StatusChip>
        {query.resolved && (query.resolvedBy || query.resolvedAttributedTo) && (
          <span className="sc-faint">
            by {query.resolvedBy ? query.resolvedBy.name : query.resolvedAttributedTo}
            {query.resolvedBy && query.resolvedAttributedTo && <> for {query.resolvedAttributedTo}</>}
          </span>
        )}
        {canResolve && !query.resolved && (
          <button type="button" className="hc-btn" onClick={() => post("/resolve")} disabled={busy}>
            Mark Resolved
          </button>
        )}
      </div>

      <ul className="sc-msgs">
        {query.messages.map((message) => (
          <li key={message.id}>
            <div className="sc-faint">
              {message.author ? (
                <>
                  <b>{message.author.name}</b> ({message.author.role}){message.attributedTo && <> for {message.attributedTo}</>}
                </>
              ) : (
                <b>{message.attributedTo}</b>
              )}{" "}
              · {new Date(message.createdAt).toLocaleString()}
            </div>
            <p>{message.body}</p>
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="sc-err">
          {error}
        </p>
      )}

      {canReply && (
        <div className="sc-col">
          <textarea aria-label="Reply" value={reply} onChange={(event) => setReply(event.target.value)} rows={2} />
          <button type="button" className="hc-btn" onClick={() => reply.trim() && post("/messages", { body: reply })} disabled={busy}>
            Reply
          </button>
        </div>
      )}
    </li>
  );
}

export function ControlQueries({
  queries,
  systemId,
  controlId,
  userRole,
  isSystemOwner,
  readOnly,
  canManage,
  onChange,
}: {
  queries: AssessmentQuery[];
  systemId: string;
  controlId: string;
  userRole: UserRole;
  isSystemOwner: boolean;
  readOnly: boolean;
  /** The server's per-Control answer; undefined falls back to the role (a Review Group member's right comes only from the server, #201). */
  canManage?: boolean;
  onChange: (queries: AssessmentQuery[]) => void;
}) {
  const canRaise = canManage ?? (!readOnly && ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(userRole));
  const canReply = (!readOnly && isSystemOwner) || canRaise;
  const openCount = queries.filter((query) => !query.resolved).length;
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
        setError(await errorOf(response, "Failed to raise a question"));
        return;
      }
      const body = await response.json();
      onChange([...queries, body.query]);
      setDraft("");
      setShowForm(false);
    } catch {
      setError("Failed to raise a question");
    } finally {
      setBusy(false);
    }
  }

  if (!canRaise && queries.length === 0) return null;

  return (
    <section className="sc-dsec" aria-label="Questions">
      <div className="sc-dsec-h">
        <h3>Questions{openCount > 0 && ` (${openCount} open)`}</h3>
        {canRaise && (
          <button type="button" className="hc-btn" onClick={() => setShowForm((shown) => !shown)}>
            Ask a question
          </button>
        )}
      </div>

      {queries.length > 0 && (
        <ul className="sc-threads">
          {queries.map((query) => (
            <QueryThreadItem
              key={query.id}
              query={query}
              systemId={systemId}
              controlId={controlId}
              canReply={canReply}
              canResolve={canRaise}
              onUpdated={(updated) => onChange(queries.map((candidate) => (candidate.id === updated.id ? updated : candidate)))}
            />
          ))}
        </ul>
      )}

      {showForm && (
        <div className="sc-col">
          <textarea aria-label="New question" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} />
          {error && (
            <p role="alert" className="sc-err">
              {error}
            </p>
          )}
          <div className="sc-btnrow">
            <button type="button" className="hc-btn primary" onClick={handleRaise} disabled={busy}>
              Send
            </button>
            <button type="button" className="hc-btn" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

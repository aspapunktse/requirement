"use client";

import { useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import type { EvidenceItemView } from "@/lib/evidence";
import { formatDay } from "./system-page-logic";

/** The Document Requirements of the System that hold a file or a link, as `GET /api/systems/[id]/documents` lists them. */
type PickableDocument = { id: string; name: string; link: string | null; file: { fileName: string } | null };

const today = () => new Date().toISOString().slice(0, 10);

/** Date-only text from a date input as an instant: collected at the start of the day, expiring at the end of it (UTC, as shown). */
const startOfDay = (day: string) => `${day}T00:00:00.000Z`;
const endOfDay = (day: string) => `${day}T23:59:59.999Z`;

async function errorOf(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => ({}));
  return typeof body?.error === "string" ? body.error : fallback;
}

/**
 * The Evidence records of one Control Assessment (#455) in the Control drawer: each with its collected date, its effective
 * expiry and a "Stale" badge once expired; for the System's owner or an Admin also adding (a link, or one of the System's
 * documents; a collected date; an optional expiry that overrides the Control's validity period) and removing.
 * Changes go through `POST` and `DELETE /api/systems/[id]/assessments/[controlId]/evidence`.
 */
export function EvidenceSection({
  systemId,
  controlId,
  controlCode,
  validityMonths,
  items,
  canEdit,
  onChange,
}: {
  systemId: string;
  controlId: string;
  controlCode: string;
  /** The Control's validity period in months, for the hint; null = Evidence doesn't expire. */
  validityMonths: number | null;
  items: EvidenceItemView[];
  canEdit: boolean;
  onChange: (items: EvidenceItemView[], assessmentId: string | null) => void;
}) {
  const [kind, setKind] = useState<"LINK" | "DOCUMENT">("LINK");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [documents, setDocuments] = useState<PickableDocument[] | null>(null);
  const [collected, setCollected] = useState(today);
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/systems/${systemId}/assessments/${controlId}/evidence`;

  async function pickDocument() {
    setKind("DOCUMENT");
    setError(null);
    if (documents !== null) return;
    try {
      const response = await fetch(`/api/systems/${systemId}/documents`);
      if (!response.ok) {
        setError(await errorOf(response, "Couldn't load the System's documents"));
        return;
      }
      const body = await response.json();
      setDocuments(((body.documents ?? []) as PickableDocument[]).filter((document) => document.file || document.link));
    } catch {
      setError("Couldn't load the System's documents");
    }
  }

  async function add() {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(kind === "LINK" ? { kind, url: url.trim() } : { kind, documentRequirementId: documentId }),
          title: title.trim() || null,
          collectedAt: startOfDay(collected),
          expiresAt: expires ? endOfDay(expires) : null,
        }),
      });
      if (!response.ok) {
        setError(await errorOf(response, "Couldn't add the evidence"));
        return;
      }
      const body = await response.json();
      onChange(body.evidence, body.assessmentId ?? null);
      setUrl("");
      setTitle("");
      setDocumentId("");
      setExpires("");
    } catch {
      setError("Couldn't add the evidence");
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: EvidenceItemView) {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`${base}/${item.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await errorOf(response, "Couldn't remove the evidence"));
        return;
      }
      const body = await response.json();
      onChange(body.evidence, null);
    } catch {
      setError("Couldn't remove the evidence");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0 && !canEdit) return null;

  const canAdd = kind === "LINK" ? url.trim() !== "" : documentId !== "";

  return (
    <section className="sc-dsec" aria-label="Evidence records">
      <h3>Evidence</h3>
      {items.length === 0 ? (
        <p className="sc-faint">No evidence recorded yet.</p>
      ) : (
        <ul className="sc-evlist">
          {items.map((item) => (
            <li key={item.id} className="sc-evitem">
              <div className="sc-evmain">
                {item.kind === "LINK" && item.url ? (
                  <a className="sc-link" href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.title || item.url}
                  </a>
                ) : item.documentRequirementId ? (
                  <a className="sc-link" href={`/api/systems/${systemId}/documents/${item.documentRequirementId}/file`}>
                    {item.title || "Document"}
                  </a>
                ) : (
                  <span>{item.title || "Document"} (no longer available)</span>
                )}
                {item.stale && <StatusChip tone="warn">Stale</StatusChip>}
              </div>
              <span className="sc-faint">
                Collected {formatDay(item.collectedAt)} ·{" "}
                {item.effectiveExpiresAt ? `${item.stale ? "Expired" : "Expires"} ${formatDay(item.effectiveExpiresAt)}${item.expiresAt ? "" : " (Control's validity period)"}` : "Doesn't expire"}
              </span>
              {canEdit && (
                <button type="button" className="hc-btn" disabled={busy} aria-label={`Remove evidence ${item.title || item.url || "document"} from ${controlCode}`} onClick={() => void remove(item)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="sc-dform" role="group" aria-label={`Add evidence to ${controlCode}`}>
          {error && (
            <p role="alert" className="sc-err">
              {error}
            </p>
          )}
          <div className="sc-btnrow">
            <button type="button" className="hc-btn" aria-pressed={kind === "LINK"} onClick={() => setKind("LINK")}>
              Link
            </button>
            <button type="button" className="hc-btn" aria-pressed={kind === "DOCUMENT"} onClick={() => void pickDocument()}>
              Document
            </button>
          </div>
          {kind === "LINK" ? (
            <label className="sc-field">
              <span>Link (http or https)</span>
              <input aria-label={`Evidence link for ${controlCode}`} value={url} onChange={(event) => setUrl(event.target.value)} />
            </label>
          ) : (
            <label className="sc-field">
              <span>Document of this System</span>
              <select aria-label={`Evidence document for ${controlCode}`} value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
                <option value="">{documents === null ? "Loading…" : documents.length === 0 ? "No document uploaded or linked yet" : "Choose a document"}</option>
                {(documents ?? []).map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.name}
                    {document.file ? ` (${document.file.fileName})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="sc-field">
            <span>Title (optional)</span>
            <input aria-label={`Evidence title for ${controlCode}`} value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="sc-field">
            <span>Collected</span>
            <input type="date" aria-label={`Evidence collected date for ${controlCode}`} value={collected} max={today()} onChange={(event) => setCollected(event.target.value)} />
          </label>
          <label className="sc-field">
            <span>Expires (optional)</span>
            <input type="date" aria-label={`Evidence expiry date for ${controlCode}`} value={expires} onChange={(event) => setExpires(event.target.value)} />
          </label>
          <p className="sc-faint">
            {validityMonths === null
              ? "This Control has no validity period, so evidence doesn't expire unless you set a date."
              : `Evidence on this Control expires ${validityMonths} ${validityMonths === 1 ? "month" : "months"} after it was collected, unless you set a date.`}
          </p>
          <div className="sc-btnrow">
            <button type="button" className="hc-btn primary" disabled={busy || !canAdd || collected === ""} onClick={() => void add()}>
              Add evidence
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

"use client";

import { useCallback, useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { DOCUMENTATION_STAGES, STAGE_LABEL, TRACK_LABEL } from "@/lib/document-requirement";
import { checkDocumentFile, DOCUMENT_FILE_ACCEPT, DOCUMENT_FILE_TYPES_TEXT, formatFileSize, MAX_DOCUMENT_FILE_BYTES } from "@/lib/system-document-file";
import type { SystemDocumentRow } from "@/lib/system-documentation";
import { useRemote } from "./use-remote";

type Documents = { documents: SystemDocumentRow[]; canEdit: boolean };

/** One Document Requirement: read-only for everyone; for the owner or an Admin a link field, a file to upload, replace or remove, a "provided" checkbox and Save. */
function DocumentRow({ systemId, document, canEdit, onSaved }: { systemId: string; document: SystemDocumentRow; canEdit: boolean; onSaved: (row: SystemDocumentRow) => void }) {
  const [link, setLink] = useState(document.link ?? "");
  const [provided, setProvided] = useState(document.provided);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = link.trim() !== (document.link ?? "") || provided !== document.provided;

  /** Sends one request; on success hands the saved row up, on failure shows the server's message. */
  async function send(url: string, init: RequestInit, failure: string) {
    setError(null);
    setSaving(true);
    try {
      const response = await fetch(url, init);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? failure);
        return;
      }
      onSaved(body.document as SystemDocumentRow);
    } catch {
      setError(failure);
    } finally {
      setSaving(false);
    }
  }

  const documentUrl = `/api/systems/${systemId}/documents/${document.id}`;

  function save(event: React.FormEvent) {
    event.preventDefault();
    return send(
      documentUrl,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: link.trim() === "" ? null : link.trim(), provided }) },
      "Couldn't save the document",
    );
  }

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const checked = checkDocumentFile(file);
    if (!checked.ok) {
      setError(checked.error);
      input.value = "";
      return;
    }
    const body = new FormData();
    body.append("file", file);
    await send(`${documentUrl}/file`, { method: "POST", body }, "Couldn't upload the file");
    input.value = "";
  }

  const removeFile = () => send(`${documentUrl}/file`, { method: "DELETE" }, "Couldn't remove the file");

  const head = (
    <div className="sc-btnrow">
      <b>{document.name}</b>
      <StatusChip tone={document.provided ? "success" : "warn"}>{document.provided ? "Provided" : "Not provided"}</StatusChip>
      <span className="muted">Tracks: {document.tracks.map((track) => TRACK_LABEL[track]).join(", ")}</span>
    </div>
  );
  const fileLink = document.file && (
    <a className="sc-link" href={`/api/systems/${systemId}/documents/${document.id}/file`}>
      {document.file.fileName} ({formatFileSize(document.file.size)})
    </a>
  );
  const description = document.description && <p className="muted">{document.description}</p>;

  if (!canEdit) {
    return (
      <li className="sc-form" aria-label={document.name}>
        {head}
        {description}
        <p>
          {document.link ? (
            <a className="sc-link" href={document.link} target="_blank" rel="noopener noreferrer">
              {document.link}
            </a>
          ) : (
            !document.file && <span className="muted">No link or file yet</span>
          )}
        </p>
        {fileLink && <p>{fileLink}</p>}
      </li>
    );
  }

  return (
    <li>
      <form className="sc-form" aria-label={document.name} onSubmit={save}>
        {head}
        {description}
        {error && (
          <p role="alert" className="sc-err">
            {error}
          </p>
        )}
        <label className="sc-field">
          <span>Link</span>
          <input type="text" inputMode="url" aria-label={`Link to ${document.name}`} placeholder="https://" value={link} onChange={(event) => setLink(event.target.value)} />
        </label>
        <div className="sc-field">
          <span>File ({DOCUMENT_FILE_TYPES_TEXT}, up to {MAX_DOCUMENT_FILE_BYTES / (1024 * 1024)} MB)</span>
          {fileLink && (
            <div className="sc-btnrow">
              {fileLink}
              <button type="button" className="sc-link" disabled={saving} onClick={removeFile} aria-label={`Remove the file from ${document.name}`}>
                Remove
              </button>
            </div>
          )}
          <input type="file" accept={DOCUMENT_FILE_ACCEPT} aria-label={`${document.file ? "Replace" : "Upload"} file for ${document.name}`} disabled={saving} onChange={upload} />
        </div>
        <label className="sc-btnrow">
          <input type="checkbox" aria-label={`${document.name} is provided`} checked={provided} onChange={(event) => setProvided(event.target.checked)} />
          <span>Mark as provided</span>
        </label>
        <div className="sc-btnrow">
          <button type="submit" className="hc-btn primary" disabled={saving || !dirty}>
            Save
          </button>
        </div>
      </form>
    </li>
  );
}

/**
 * The Documentation tab (#324, PRD 0002 F-DOC.2): the Document Requirements that apply to this System, by stage,
 * each provided or not provided with its link. The System's owner or an Admin (`canEdit` from
 * `GET /api/systems/[id]/documents`, the rule `PUT` enforces) sets the link and marks it provided; everyone else
 * reads. A Document Requirement removed from the catalogue is simply no longer listed.
 */
export function SystemDocumentation({ systemId }: { systemId: string }) {
  const read = useCallback(async (): Promise<Documents> => {
    const response = await fetch(`/api/systems/${systemId}/documents`);
    if (!response.ok) throw new Error("Failed to load the documentation");
    const body = await response.json();
    return { documents: body.documents ?? [], canEdit: !!body.canEdit };
  }, [systemId]);
  const { data, failed, reload, setData } = useRemote(read);

  return (
    <section className="hc-card" aria-labelledby="sc-docs-h">
      <div className="hc-card-h">
        <h2 id="sc-docs-h">Documentation</h2>
        {data && data.documents.length > 0 && (
          <span className="muted">
            {data.documents.filter((document) => document.provided).length} of {data.documents.length} provided
          </span>
        )}
      </div>
      <div className="hc-card-b">
        {failed && (
          <p role="alert" className="sc-err">
            Couldn&apos;t load the documentation.{" "}
            <button type="button" className="sc-link" onClick={reload}>
              Try again
            </button>
          </p>
        )}
        {data === null ? (
          !failed && (
            <p role="status" className="hc-empty">
              Loading documentation…
            </p>
          )
        ) : data.documents.length === 0 ? (
          <p className="hc-empty">No Document Requirements apply to this System.</p>
        ) : (
          DOCUMENTATION_STAGES.map((stage) => {
            const rows = data.documents.filter((document) => document.stage === stage);
            if (rows.length === 0) return null;
            return (
              <div key={stage} className="sc-formblock">
                <h3>{STAGE_LABEL[stage]}</h3>
                <ul className="sc-formblock" aria-label={STAGE_LABEL[stage]}>
                  {rows.map((document) => (
                    <DocumentRow
                      // Remounts when the saved row changes, so the fields start from what was stored.
                      key={`${document.id}:${document.updatedAt}`}
                      systemId={systemId}
                      document={document}
                      canEdit={data.canEdit}
                      onSaved={(saved) => setData({ ...data, documents: data.documents.map((current) => (current.id === saved.id ? saved : current)) })}
                    />
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

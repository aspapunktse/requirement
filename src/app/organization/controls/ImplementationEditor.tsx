"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import type { ControlAssessmentStatus } from "@prisma/client";
import { implementationDescriptionRefusal } from "@/lib/organization-implementation-rules";
import { REASON_TEMPLATES, STATUS_LABEL, STATUS_ORDER, needsReason } from "./controls-logic";
import type { OrgControlRow } from "./controls-types";

/**
 * The status editor of an opened row (design proposal A "Implementation register", issue #284): status as
 * pills, the description, reason templates for Waived and Not Applicable, the same refusal the API gives,
 * Save, Save and next, Cancel. Ctrl+Enter saves and Escape cancels. `onSave` resolves to the API's error
 * message, or null once saved (the page then closes or moves the editor). A user who may not edit gets a
 * read-only note instead. The page keys the editor on the row and its last save, so it starts from the
 * saved values without resetting state in an effect.
 */
export function ImplementationEditor({
  row,
  roleLabel,
  userName,
  hasNext,
  autoFocus,
  onSave,
  onCancel,
}: {
  row: OrgControlRow;
  roleLabel: string;
  userName: string;
  /** Is there a later editable row in view for "Save and next". */
  hasNext: boolean;
  autoFocus: boolean;
  onSave: (input: { status: ControlAssessmentStatus; description: string }, andNext: boolean) => Promise<string | null>;
  onCancel: () => void;
}) {
  const groupId = useId();
  const [status, setStatus] = useState(row.status);
  const [description, setDescription] = useState(row.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!row.canEdit) {
    return (
      <p className="oc-readonly">
        You are viewing as {userName}, {roleLabel}: you can change the Controls you own. A Compliance Manager or an Admin can change any.
      </p>
    );
  }

  const refusal = implementationDescriptionRefusal(status, description);

  async function submit(andNext: boolean) {
    if (refusal || saving) return;
    setError(null);
    setSaving(true);
    const message = await onSave({ status, description }, andNext);
    // On success the page closes or moves this editor; on a failure it stays, with the API's error.
    if (message) {
      setError(message);
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void submit(false);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    }
  }

  return (
    <form
      className="oc-ed"
      aria-label={`Edit ${row.code}`}
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void submit(false);
      }}
      onKeyDown={onKeyDown}
      noValidate
    >
      <fieldset className="oc-spick">
        <legend>Status of {row.code}</legend>
        {STATUS_ORDER.map((option) => (
          <label key={option}>
            <input type="radio" name={`${groupId}-status`} value={option} checked={status === option} onChange={() => setStatus(option)} />
            <i className={`oc-s-${option}`} aria-hidden="true" />
            {STATUS_LABEL[option]}
          </label>
        ))}
      </fieldset>
      <label className="oc-field">
        How the Organization implements it
        <textarea
          rows={4}
          value={description}
          autoFocus={autoFocus}
          placeholder="What is in place, where the evidence is, or why it is waived"
          aria-invalid={refusal ? true : undefined}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {needsReason(status) && (
        <div className="oc-tpls" aria-label="Reason templates">
          {REASON_TEMPLATES.map((template) => (
            <button key={template} type="button" onClick={() => setDescription(template)}>
              {template.trim()}…
            </button>
          ))}
        </div>
      )}
      {refusal && (
        <p className="oc-refuse" role="status">
          {refusal}
        </p>
      )}
      {error && (
        <p className="oc-error" role="alert">
          {error}
        </p>
      )}
      <div className="oc-edrow">
        <button type="submit" className="hc-btn primary" disabled={!!refusal || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {hasNext && (
          <button type="button" className="hc-btn" disabled={!!refusal || saving} onClick={() => void submit(true)}>
            Save and next
          </button>
        )}
        <button type="button" className="hc-btn" onClick={onCancel}>
          Cancel
        </button>
        <span className="oc-kh">Ctrl+Enter saves</span>
      </div>
    </form>
  );
}

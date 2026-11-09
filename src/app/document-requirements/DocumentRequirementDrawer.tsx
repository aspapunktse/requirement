"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { DocumentationStage, EvaluationTrack } from "@prisma/client";
import {
  DOCUMENTATION_STAGES,
  EVALUATION_TRACKS,
  FIRST_DOCUMENTATION_IS_FULL,
  MAX_DOCUMENT_REQUIREMENT_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_REQUIREMENT_NAME_LENGTH,
  STAGE_LABEL,
  TRACK_LABEL,
  type DocumentRequirementRow,
} from "@/lib/document-requirement";
import "@/app/home/home.css";
import "@/app/systems/[id]/system-cockpit.css";
import "./document-requirements.css";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const STAGE_HINT: Record<DocumentationStage, string> = {
  FIRST_DOCUMENTATION: "Provided before the OAG review. A Full-track stage, so it never applies to Self.",
  SECOND_ROUND: "Provided with the second round, on either Track.",
};

/**
 * The drawer of the Document Requirement catalogue (#323): for a curator a form to add or change a requirement (name,
 * description, stage, Tracks), for everyone else the requirement read-only. First documentation is a Full-track
 * stage: choosing it leaves Self out and disabled. The route decides who may write and enforces the pairing; a
 * refusal or a duplicate name is shown here.
 */
export function DocumentRequirementDrawer({
  requirement,
  canCurate,
  onClose,
  onSaved,
}: {
  /** The requirement to show, or null to add a new one. */
  requirement: DocumentRequirementRow | null;
  canCurate: boolean;
  onClose: () => void;
  onSaved: (row: DocumentRequirementRow, created: boolean) => void;
}) {
  const titleId = useId();
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeNow = useRef(onClose);
  useEffect(() => {
    closeNow.current = onClose;
  });

  const [name, setName] = useState(requirement?.name ?? "");
  const [description, setDescription] = useState(requirement?.description ?? "");
  const [stage, setStage] = useState<DocumentationStage | null>(requirement?.stage ?? null);
  const [tracks, setTracks] = useState<EvaluationTrack[]>(requirement?.tracks ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (asideRef.current?.querySelector<HTMLElement>("input[name='name']") ?? closeRef.current)?.focus();
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

  function chooseStage(next: DocumentationStage) {
    setStage(next);
    // First documentation is Full only: choosing it drops Self.
    if (next === "FIRST_DOCUMENTATION") setTracks((current) => current.filter((track) => track !== "SELF"));
  }

  const trimmedName = name.trim();
  const tracksChanged = !requirement || tracks.length !== requirement.tracks.length || tracks.some((track) => !requirement.tracks.includes(track));
  const changed = !requirement || trimmedName !== requirement.name || description.trim() !== (requirement.description ?? "") || stage !== requirement.stage || tracksChanged;
  const canSave = canCurate && trimmedName !== "" && stage !== null && tracks.length > 0 && changed && !saving;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(requirement ? `/api/document-requirements/${requirement.id}` : "/api/document-requirements", {
        method: requirement ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, description: description.trim() || null, stage, tracks }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not save the Document Requirement.");
        return;
      }
      onSaved(body.documentRequirement as DocumentRequirementRow, !requirement);
    } catch {
      setError("Could not save the Document Requirement.");
    } finally {
      setSaving(false);
    }
  }

  const heading = requirement ? requirement.name : "Add a Document Requirement";

  return createPortal(
    <div className="sc-drawer-root dr-drawer-root">
      <div className="sc-scrim" data-testid="document-requirement-drawer-scrim" aria-hidden="true" onClick={onClose} />
      <aside ref={asideRef} className="sc-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={keepFocusInside}>
        <header>
          <button ref={closeRef} type="button" className="hc-btn ghost sc-x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
          <span className="sc-eyebrow">{requirement ? "Document Requirement" : "New"}</span>
          <h2 id={titleId}>{heading}</h2>
        </header>
        <div className="sc-dbody">
          {canCurate ? (
            <form className="sc-dform" onSubmit={save} aria-label={requirement ? "Edit Document Requirement" : "New Document Requirement"}>
              {error && (
                <p role="alert" className="sc-err">
                  {error}
                </p>
              )}
              <label className="sc-field">
                <span>Name</span>
                <input name="name" value={name} maxLength={MAX_DOCUMENT_REQUIREMENT_NAME_LENGTH} onChange={(event) => setName(event.target.value)} autoComplete="off" />
              </label>
              <label className="sc-field">
                <span>Description (optional)</span>
                <textarea
                  name="description"
                  rows={3}
                  value={description}
                  maxLength={MAX_DOCUMENT_REQUIREMENT_DESCRIPTION_LENGTH}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <div role="radiogroup" aria-labelledby={`${titleId}-stage`} className="dr-group">
                <span id={`${titleId}-stage`} className="dr-legend">
                  Needed at
                </span>
                {DOCUMENTATION_STAGES.map((item) => (
                  <label key={item} className={`dr-opt${stage === item ? " on" : ""}`}>
                    <input type="radio" name="stage" checked={stage === item} onChange={() => chooseStage(item)} aria-describedby={`${titleId}-s-${item}`} />
                    <span>{STAGE_LABEL[item]}</span>
                    <small id={`${titleId}-s-${item}`}>{STAGE_HINT[item]}</small>
                  </label>
                ))}
              </div>
              <fieldset className="dr-group">
                <legend className="dr-legend">Tracks it applies to</legend>
                {EVALUATION_TRACKS.map((track) => {
                  const unavailable = track === "SELF" && stage === "FIRST_DOCUMENTATION";
                  return (
                    <label key={track} className={`dr-opt${tracks.includes(track) ? " on" : ""}${unavailable ? " off" : ""}`}>
                      <input
                        type="checkbox"
                        name="tracks"
                        value={track}
                        checked={tracks.includes(track)}
                        disabled={unavailable}
                        onChange={(event) => setTracks((current) => (event.target.checked ? [...current, track] : current.filter((item) => item !== track)))}
                      />
                      <span>{TRACK_LABEL[track]}</span>
                      {unavailable && <small>{FIRST_DOCUMENTATION_IS_FULL}</small>}
                    </label>
                  );
                })}
              </fieldset>
              <div className="sc-btnrow">
                <button type="submit" className="hc-btn primary" disabled={!canSave}>
                  {saving ? "Saving…" : requirement ? "Save" : "Add"}
                </button>
                <button type="button" className="hc-btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            requirement && (
              <>
                <p>{requirement.description ?? "No description."}</p>
                <dl className="sc-readonly">
                  <dt>Needed at</dt>
                  <dd>{STAGE_LABEL[requirement.stage]}</dd>
                  <dt>Tracks</dt>
                  <dd>
                    <ul className="sc-tags" aria-label="Tracks">
                      {requirement.tracks.map((track) => (
                        <li key={track}>{TRACK_LABEL[track]}</li>
                      ))}
                    </ul>
                  </dd>
                </dl>
                <p className="sc-faint">Only the Compliance Manager or an Admin changes the catalogue.</p>
              </>
            )
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}

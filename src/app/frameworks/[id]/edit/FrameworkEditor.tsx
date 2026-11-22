"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { FrameworkLineage } from "@/components/FrameworkLineage";
import { StatusChip } from "@/components/ui/StatusChip";
import { frameworkLabel } from "@/lib/framework-label";
import "@/app/home/home.css";
import "../../frameworks.css";
import { PublishFrameworkDialog } from "../../PublishFrameworkDialog";
import type { CatalogRow } from "../../frameworks-types";

export type FrameworkDraft = {
  name: string;
  version: string;
  description: string;
  strictComplianceRequired: boolean;
  licensing: "PARAPHRASE_ONLY" | "QUOTABLE";
  supersedesId: string;
  onboardingQuestion: string;
  onboardingHint: string;
};

/**
 * The top of the Framework editor (issue #413): the header with the status, base and licensing chips and the
 * Draft notice, the form for the descriptive fields, Publish for a Draft and Delete. Review Group and
 * Requirements arrive as `children`, rendered below.
 *
 * A Compliance Manager or an Admin (`catalogManager`) edits every field. A Framework Owner edits only the
 * description and the onboarding question and hint, which is all `PATCH /api/frameworks/[id]` accepts from them,
 * so the rest is shown read-only. The base Framework has no onboarding question, and a blank question clears the
 * hint. Delete is for a Compliance Manager or an Admin, on a Draft only; the API refuses while Systems,
 * Requirements or Supplementary Controls still use the Framework, and that refusal is shown in place. A refused or
 * failed save shows its error and keeps what was typed.
 */
export function FrameworkEditor({
  row,
  catalogManager,
  initial,
  supersedesOptions,
  requirementCount,
  children,
}: {
  row: CatalogRow;
  catalogManager: boolean;
  initial: FrameworkDraft;
  supersedesOptions: { id: string; name: string; version: string }[];
  requirementCount: number;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<FrameworkDraft>(initial);
  const [draft, setDraft] = useState<FrameworkDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const label = frameworkLabel(row);
  const isDraft = row.status === "DRAFT";
  const changed = (Object.keys(draft) as (keyof FrameworkDraft)[]).some((key) => draft[key] !== saved[key]);
  const nameProblem = catalogManager && (!draft.name.trim() || !draft.version.trim());

  function change(patch: Partial<FrameworkDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setError(null);
    setNotice(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !changed || nameProblem) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    // The base Framework never carries an onboarding question; a blank one clears it, and its hint with it.
    const question = draft.onboardingQuestion.trim();
    const onboarding = row.isBase
      ? {}
      : { onboardingQuestion: question || null, onboardingHint: question ? draft.onboardingHint.trim() || null : null };
    const body = catalogManager
      ? {
          name: draft.name.trim(),
          version: draft.version.trim(),
          description: draft.description,
          strictComplianceRequired: draft.strictComplianceRequired,
          licensing: draft.licensing,
          supersedesId: draft.supersedesId || null,
          ...onboarding,
        }
      : { description: draft.description, ...onboarding };

    try {
      const response = await fetch(`/api/frameworks/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        setError(typeof failure.error === "string" ? failure.error : `Could not save: the server answered ${response.status}.`);
        return;
      }
    } catch {
      setError("Could not save: the request did not reach the server. Nothing was changed; try again.");
      return;
    } finally {
      setSaving(false);
    }
    setSaved(draft);
    setNotice("Saved");
    router.refresh();
  }

  async function remove() {
    if (deleting) return;
    if (!window.confirm(`Delete the Draft ${label}? This can't be undone.`)) return;
    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/frameworks/${row.id}`, { method: "DELETE" });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        setError(typeof failure.error === "string" ? failure.error : `Could not delete: the server answered ${response.status}.`);
        setDeleting(false);
        return;
      }
    } catch {
      setError("Could not delete: the request did not reach the server. Nothing was changed; try again.");
      setDeleting(false);
      return;
    }
    router.push("/frameworks");
    router.refresh();
  }

  const readOnly = !catalogManager;
  const supersededKnown = !draft.supersedesId || supersedesOptions.some((option) => option.id === draft.supersedesId);

  return (
    <div className="hc fc fc-new fc-edit">
      <p className="fc-crumbs">
        <Link href="/frameworks">Frameworks</Link> / {label} / Edit
      </p>

      <section className="hc-hero fc-new-hero" aria-labelledby="fc-edit-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Requirement database</span>
          </div>
          <h1 id="fc-edit-title">Edit {label}</h1>
          <p className="fc-chips">
            <StatusChip tone={isDraft ? "warn" : "success"}>{isDraft ? "Draft" : "Published"}</StatusChip>
            {row.isBase && <StatusChip tone="accent">Base Framework</StatusChip>}
            <span>{saved.licensing === "PARAPHRASE_ONLY" ? "Paraphrase only" : "Quotable"}</span>
            <span>· {requirementCount} Requirements</span>
            <Link href={`/frameworks/${row.id}/coverage`} aria-label={`Coverage of ${label}`}>
              Coverage →
            </Link>
          </p>
          {isDraft && (
            <p className="hc-lede">
              This Framework is a Draft: only its owner, Compliance Managers and Admins can see it, and it can&apos;t be put in a System&apos;s
              Framework Scope until it is published.
            </p>
          )}
          {row.lineage.length > 0 && <FrameworkLineage paths={row.lineage} />}
        </div>
      </section>

      <form className="hc-card fc-form" onSubmit={save} aria-label={`Edit ${label}`} noValidate>
        <div className="hc-card-h">
          <h2>Details</h2>
        </div>
        <div className="hc-card-b fc-fields">
          {readOnly && (
            <p className="fc-note wide">As this Framework&apos;s owner you edit the description and the onboarding question and hint. A Compliance Manager or an Admin changes the rest.</p>
          )}
          <label className="fc-field">
            <span>Name</span>
            <input className="fc-input" value={draft.name} disabled={readOnly} onChange={(event) => change({ name: event.target.value })} required />
          </label>
          <label className="fc-field">
            <span>Version</span>
            <input className="fc-input" value={draft.version} disabled={readOnly} onChange={(event) => change({ version: event.target.value })} required />
          </label>
          <label className="fc-field wide">
            <span>Description</span>
            <textarea className="fc-input" rows={3} value={draft.description} onChange={(event) => change({ description: event.target.value })} placeholder="Optional" />
          </label>
          <label className="fc-field">
            <span>Licensing</span>
            <select className="fc-input" value={draft.licensing} disabled={readOnly} onChange={(event) => change({ licensing: event.target.value as FrameworkDraft["licensing"] })}>
              <option value="PARAPHRASE_ONLY">Paraphrase only (licensed standard)</option>
              <option value="QUOTABLE">Quotable (public domain)</option>
            </select>
          </label>
          <label className="fc-field">
            <span>Supersedes</span>
            <select className="fc-input" value={draft.supersedesId} disabled={readOnly} onChange={(event) => change({ supersedesId: event.target.value })}>
              <option value="">Nothing (first version)</option>
              {!supersededKnown && <option value={draft.supersedesId}>Another Framework</option>}
              {supersedesOptions.map((other) => (
                <option key={other.id} value={other.id}>
                  {frameworkLabel(other)}
                </option>
              ))}
            </select>
          </label>
          {!row.isBase && (
            <>
              <label className="fc-field wide">
                <span>Onboarding question (asked as Yes/No when onboarding a System; leave blank for none)</span>
                <input
                  className="fc-input"
                  maxLength={200}
                  placeholder="Does it hold personal data about people?"
                  value={draft.onboardingQuestion}
                  onChange={(event) => change({ onboardingQuestion: event.target.value })}
                />
              </label>
              {draft.onboardingQuestion.trim() && (
                <label className="fc-field wide">
                  <span>Onboarding hint</span>
                  <input
                    className="fc-input"
                    maxLength={500}
                    placeholder="Customers, employees, patients or anyone else who can be identified."
                    value={draft.onboardingHint}
                    onChange={(event) => change({ onboardingHint: event.target.value })}
                  />
                </label>
              )}
              {isDraft && draft.onboardingQuestion.trim() && <p className="fc-note wide">Not asked until this Framework is published.</p>}
            </>
          )}
          <label className="fc-check wide">
            <input
              type="checkbox"
              checked={draft.strictComplianceRequired}
              disabled={readOnly}
              onChange={(event) => change({ strictComplianceRequired: event.target.checked })}
            />
            Requires 100% Fulfilled (no partial credit for Waived/Not Applicable)
          </label>
          {error && (
            <p role="alert" className="fc-error wide">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="fc-note wide">
              {notice}
            </p>
          )}
          <div className="fc-actions wide">
            <button type="submit" className="hc-btn primary" disabled={saving || !changed || nameProblem}>
              {saving ? "Saving…" : "Save"}
            </button>
            {isDraft && (
              <button type="button" className="hc-btn" onClick={() => setPublishing(true)}>
                Publish
              </button>
            )}
            {catalogManager && isDraft && (
              <button type="button" className="hc-btn fc-danger" onClick={remove} disabled={deleting || row.isBase} title={row.isBase ? "The base Framework can't be deleted" : undefined}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
            <Link href="/frameworks" className="hc-btn">
              Back to Frameworks
            </Link>
            {!changed && <span className="fc-muted">No changes yet.</span>}
          </div>
        </div>
      </form>

      {children}

      {publishing && (
        <PublishFrameworkDialog
          row={row}
          onClose={() => setPublishing(false)}
          onDone={() => {
            setPublishing(false);
            setNotice(`${label} published`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

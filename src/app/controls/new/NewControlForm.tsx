"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { NEW_CONTROL_DRAFT, NewControlFields, newControlBody, type NewControlDraft } from "@/components/NewControlFields";
import { RESERVED_CONTROL_CODE_ERROR, isReservedControlCode } from "@/lib/control-schema";
import "@/app/home/home.css";
import "../library.css";
import "../[code]/control-page.css";
import { controlHref } from "../[code]/control-page-logic";

/**
 * The create form for a Control (issue #412): code, title, description, category, Mandatory, applicability and,
 * for a Per-System or Both Control, the Self-Assessment Question, Intent and Examples. It posts to
 * `POST /api/controls` and, on success, opens the new Control's editor `/controls/<code>/edit`. A refusal or a
 * failure is shown in place and keeps what was typed.
 */
export function NewControlForm() {
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<NewControlDraft>(NEW_CONTROL_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function change(patch: Partial<NewControlDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    // The API answers a generic "Invalid Control" for this, so say why here.
    if (isReservedControlCode(draft.code)) {
      setError(RESERVED_CONTROL_CODE_ERROR);
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/controls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newControlBody(draft)),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : `Could not create the Control: the server answered ${response.status}.`);
        setSaving(false);
        return;
      }
      router.push(`${controlHref(body.control.code)}/edit`);
      router.refresh();
    } catch {
      setError("Could not create the Control: the request did not reach the server. Nothing was created; try again.");
      setSaving(false);
    }
  }

  return (
    <div className="hc cl cp">
      <section className="hc-card cp-head" aria-labelledby={`${id}-h`}>
        <nav className="cp-crumb" aria-label="Breadcrumb">
          <Link href="/controls">Control Library</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">New Control</span>
        </nav>
        <div className="cp-head-top">
          <h1 className="cp-title" id={`${id}-h`}>
            New Control
          </h1>
        </div>
        <p className="cp-muted cp-small">
          The code and the applicability can&apos;t be changed later. Deployment Facets, Sensitivity Level and Impact Level minimums and the Control
          Owner are set in the Control&apos;s editor, which opens next. Map the Control to a Requirement on the Framework&apos;s page.
        </p>
      </section>

      <form className="hc-card cp-form" onSubmit={submit} aria-label="New Control">
        <NewControlFields draft={draft} onChange={change} />
        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}
        <div className="cp-actions">
          <button type="submit" className="hc-btn primary" disabled={saving}>
            {saving ? "Creating…" : "Create Control"}
          </button>
          <Link href="/controls" className="hc-btn">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

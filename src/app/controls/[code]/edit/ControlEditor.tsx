"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { SensitivityLevelPicker } from "@/components/SensitivityLevelPicker";
import { APPLICABILITY_LABEL } from "@/lib/statement-of-applicability-rules";
import "@/app/home/home.css";
import "../../library.css";
import "../control-page.css";
import { controlHref } from "../control-page-logic";
import type { ControlEditView } from "./control-edit-data";
import { draftOf, draftProblems, editBody, hasChanges, type EditDraft } from "./control-edit-logic";

const IMPACT_LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
const IMPACT_LABEL = { LOW: "Low", MODERATE: "Moderate", HIGH: "High", CRITICAL: "Critical" } as const;
const IMPACT_AXES = [
  { key: "minIntegrityImpactLevel", label: "Minimum Integrity" },
  { key: "minAvailabilityImpactLevel", label: "Minimum Availability" },
] as const;

/**
 * The editor for one Control (issue #314, decision 3), reached from Edit on the Control page by a Compliance
 * Manager or an Admin: title, description, category, mandatory, Self-Assessment Question, Intent, Examples,
 * Deployment Facets, Sensitivity Level and Impact Level minimums (Per-System and Both Controls) and the Control
 * Owner. It saves through `PATCH /api/controls/[id]` and sends only the fields that changed, so a Save can't clear
 * an owner the picker never offered. The code, the applicability and the Control Mappings are not edited here.
 * Save returns to the Control's page; a refusal is shown in place and nothing is lost.
 */
export function ControlEditor({ view, returnTab }: { view: ControlEditView; returnTab: string | null }) {
  const router = useRouter();
  const { control } = view;
  const [draft, setDraft] = useState<EditDraft>(() => draftOf(control));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const reachesSystems = control.applicability !== "ORGANIZATIONAL";
  const changed = hasChanges(control, draft);
  const problems = draftProblems(control, draft);
  const backHref = controlHref(control.code, returnTab);

  function change(patch: Partial<EditDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !changed || problems.length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/controls/${control.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editBody(control, draft)),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : `Could not save: the server answered ${response.status}.`);
        setSaving(false);
        return;
      }
    } catch {
      setError("Could not save: the request did not reach the server. Nothing was changed; try again.");
      setSaving(false);
      return;
    }
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="hc cl cp">
      <section className="hc-card cp-head" aria-labelledby={`${id}-h`}>
        <nav className="cp-crumb" aria-label="Breadcrumb">
          <Link href="/controls">Control Library</Link>
          <span aria-hidden="true">/</span>
          <Link href={backHref}>{control.code}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">Edit</span>
        </nav>
        <div className="cp-head-top">
          <div>
            <span className="cp-code">{control.code}</span>
            <h1 className="cp-title" id={`${id}-h`}>
              Edit {control.title}
            </h1>
          </div>
        </div>
        <p className="cp-muted cp-small">
          {APPLICABILITY_LABEL[control.applicability]} Control. The code and the applicability can&apos;t be changed here.
          {view.mappedFrameworks.length > 0 ? (
            <>
              {" "}
              Control Mappings are edited on the Framework&apos;s page:{" "}
              {view.mappedFrameworks.map((framework, index) => (
                <span key={framework.id}>
                  {index > 0 && ", "}
                  <Link href={`/admin/frameworks/${framework.id}`}>{framework.label}</Link>
                </span>
              ))}
              .
            </>
          ) : (
            <>
              {" "}
              This Control is not mapped to a Requirement yet; <Link href="/admin/frameworks">map it on a Framework&apos;s page</Link>.
            </>
          )}
        </p>
      </section>

      <form className="hc-card cp-form" onSubmit={save} aria-label={`Edit ${control.code}`} noValidate>
        <div className="cp-field">
          <label htmlFor={`${id}-title`}>Title</label>
          <input id={`${id}-title`} className="cp-input" value={draft.title} onChange={(event) => change({ title: event.target.value })} required />
        </div>
        <div className="cp-field">
          <label htmlFor={`${id}-description`}>Description</label>
          <textarea id={`${id}-description`} className="cp-input" value={draft.description} onChange={(event) => change({ description: event.target.value })} required />
        </div>
        <div className="cp-field">
          <label htmlFor={`${id}-category`}>Category</label>
          <input id={`${id}-category`} className="cp-input" value={draft.category} onChange={(event) => change({ category: event.target.value })} required />
        </div>
        <label className="cp-check">
          <input type="checkbox" checked={draft.mandatory} onChange={(event) => change({ mandatory: event.target.checked })} />
          Mandatory
        </label>

        <div className="cp-field">
          <label htmlFor={`${id}-owner`}>Control Owner</label>
          <select id={`${id}-owner`} className="cp-input" value={draft.ownerId} onChange={(event) => change({ ownerId: event.target.value })}>
            <option value="">No Control Owner</option>
            {/* Keeps the current owner selectable even if the User list did not include them. */}
            {control.ownerId && !view.owners.some((owner) => owner.id === control.ownerId) && <option value={control.ownerId}>{control.ownerName}</option>}
            {view.owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
        </div>

        {reachesSystems ? (
          <>
            <div className="cp-field">
              <label htmlFor={`${id}-question`}>Self-Assessment Question</label>
              <input id={`${id}-question`} className="cp-input" value={draft.question} onChange={(event) => change({ question: event.target.value })} />
            </div>
            <div className="cp-field">
              <label htmlFor={`${id}-intent`}>Intent</label>
              <input id={`${id}-intent`} className="cp-input" value={draft.intent} onChange={(event) => change({ intent: event.target.value })} />
              <small>Why the question matters (optional).</small>
            </div>
            <div className="cp-field">
              <label htmlFor={`${id}-examples`}>Examples</label>
              <textarea id={`${id}-examples`} className="cp-input" value={draft.examples} onChange={(event) => change({ examples: event.target.value })} />
              <small>Ways to satisfy the Control, one per line (optional).</small>
            </div>

            <fieldset className="cp-fieldset">
              <legend>Deployment Facets (none selected = all)</legend>
              <div className="cp-checks">
                {view.deploymentFacets.map((facet) => (
                  <label key={facet.id} className="cp-check">
                    <input
                      type="checkbox"
                      checked={draft.deploymentFacetIds.includes(facet.id)}
                      onChange={(event) =>
                        change({
                          deploymentFacetIds: event.target.checked ? [...draft.deploymentFacetIds, facet.id] : draft.deploymentFacetIds.filter((facetId) => facetId !== facet.id),
                        })
                      }
                    />
                    {facet.name}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="cp-fieldset">
              <legend>Minimum Sensitivity Level and Impact Levels (none = no minimum)</legend>
              <div className="cp-field">
                <b id={`${id}-sens`} className="cp-flabel">
                  Minimum Sensitivity Level
                </b>
                <SensitivityLevelPicker
                  levels={view.sensitivityLevels}
                  value={draft.minSensitivityLevel}
                  onChange={(level) => change({ minSensitivityLevel: level })}
                  name={`${id}-sens`}
                  labelledBy={`${id}-sens`}
                  noneLabel={<span className="text-[0.85rem] font-bold">No minimum</span>}
                  noneDescription="Applies to a System at every level, including one with no level set."
                />
              </div>
              {IMPACT_AXES.map(({ key, label }) => (
                <div key={key} className="cp-field">
                  <label htmlFor={`${id}-${key}`}>{label}</label>
                  <select
                    id={`${id}-${key}`}
                    className="cp-input"
                    value={draft[key] ?? ""}
                    onChange={(event) => change({ [key]: event.target.value === "" ? null : (event.target.value as (typeof IMPACT_LEVELS)[number]) })}
                  >
                    <option value="">No minimum</option>
                    {IMPACT_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {IMPACT_LABEL[level]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </fieldset>
          </>
        ) : (
          <p className="cp-muted cp-small">An Organizational Control is implemented once by the Organization, so it has no Self-Assessment Question, Deployment Facets, Sensitivity Level or Impact Level scoping.</p>
        )}

        {problems.length > 0 && (
          <ul className="cp-error" aria-label="Problems with the form">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {error && (
          <p className="cp-error" role="alert">
            {error}
          </p>
        )}
        <div className="cp-actions">
          <button type="submit" className="hc-btn primary" disabled={saving || !changed || problems.length > 0}>
            {saving ? "Saving…" : "Save"}
          </button>
          <Link href={backHref} className="hc-btn">
            Cancel
          </Link>
          {!changed && <span className="cp-muted cp-small">No changes yet.</span>}
        </div>
      </form>
    </div>
  );
}

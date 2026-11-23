"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { frameworkLabel } from "@/lib/framework-label";
import { type BoundaryDetail } from "@/lib/compliance-boundary";
import type { BoundaryChoices } from "@/lib/compliance-boundary-data";

/**
 * The create and edit form for a Compliance Boundary (#418): name, description, Business Unit, Boundary Owner and Frameworks
 * (at least one). Creating posts to `POST /api/compliance-boundaries`, editing patches `/api/compliance-boundaries/[id]`; both then
 * open the Boundary's page. Members are added there, not here. Only a Compliance Manager or an Admin gets the page.
 */
export function BoundaryForm({ choices, boundary }: { choices: BoundaryChoices; boundary?: BoundaryDetail }) {
  const router = useRouter();
  const editing = boundary !== undefined;
  const [name, setName] = useState(boundary?.name ?? "");
  const [description, setDescription] = useState(boundary?.description ?? "");
  const [businessUnitId, setBusinessUnitId] = useState(boundary?.businessUnit?.id ?? "");
  const [boundaryOwnerId, setBoundaryOwnerId] = useState(boundary?.boundaryOwner?.id ?? "");
  const [frameworkIds, setFrameworkIds] = useState<string[]>(boundary?.frameworks.map((framework) => framework.id) ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A Framework the Boundary already holds stays on offer even if it is no longer Published, so it isn't dropped by accident.
  const offered = [...choices.frameworks];
  for (const held of boundary?.frameworks ?? []) if (!offered.some((framework) => framework.id === held.id)) offered.push(held);

  const toggle = (id: string) => setFrameworkIds((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Give the Compliance Boundary a name.");
      return;
    }
    if (frameworkIds.length === 0) {
      setError("A Compliance Boundary needs at least one Framework.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(editing ? `/api/compliance-boundaries/${boundary.id}` : "/api/compliance-boundaries", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          businessUnitId: businessUnitId || null,
          boundaryOwnerId: boundaryOwnerId || null,
          frameworkIds,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Failed to save the Compliance Boundary");
        return;
      }
      router.push(`/compliance-boundaries/${body.boundary.id}`);
      router.refresh();
    } catch {
      setError("Failed to save the Compliance Boundary");
    } finally {
      setSaving(false);
    }
  }

  const heading = editing ? "Edit Compliance Boundary" : "New Compliance Boundary";
  return (
    <div className="hc cb">
      <p className="cb-crumbs">
        <Link href="/compliance-boundaries">Compliance Boundaries</Link> / {editing ? <Link href={`/compliance-boundaries/${boundary.id}`}>{boundary.name}</Link> : heading}
        {editing && " / Edit"}
      </p>
      <section className="hc-hero" aria-labelledby="cb-form-title">
        <div>
          <h1 id="cb-form-title">{heading}</h1>
        </div>
      </section>

      <form className="hc-card cb-form" onSubmit={submit} noValidate>
        <div className="hc-card-h">
          <h2>Details</h2>
        </div>
        <div className="hc-card-b cb-form">
          <label className="cb-field">
            <span>Name</span>
            <input className="cb-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="ISMS scope (ISO 27001)" required />
          </label>
          <label className="cb-field">
            <span>Description</span>
            <textarea className="cb-input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="For example the contract it answers (optional)" />
          </label>
          <label className="cb-field">
            <span>Business Unit</span>
            <select className="cb-input" value={businessUnitId} onChange={(event) => setBusinessUnitId(event.target.value)}>
              <option value="">None</option>
              {choices.businessUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label className="cb-field">
            <span>Boundary Owner</span>
            <select className="cb-input" value={boundaryOwnerId} onChange={(event) => setBoundaryOwnerId(event.target.value)}>
              <option value="">No Boundary Owner yet</option>
              {choices.users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="cb-fieldset">
            <legend>Frameworks (at least one, Published only)</legend>
            {offered.length === 0 && <p className="cb-empty">No Published Frameworks yet.</p>}
            {offered.map((framework) => (
              <label key={framework.id} className="cb-check">
                <input type="checkbox" checked={frameworkIds.includes(framework.id)} onChange={() => toggle(framework.id)} />
                {frameworkLabel(framework)}
              </label>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="cb-error">
              {error}
            </p>
          )}
          <div className="cb-actions">
            <button type="submit" className="hc-btn primary" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create Compliance Boundary"}
            </button>
            <Link href={editing ? `/compliance-boundaries/${boundary.id}` : "/compliance-boundaries"} className="hc-btn">
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}

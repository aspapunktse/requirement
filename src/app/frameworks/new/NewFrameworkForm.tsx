"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { frameworkLabel } from "@/lib/framework-label";

type Licensing = "PARAPHRASE_ONLY" | "QUOTABLE";

/**
 * The create form for a Framework (issue #266): name, version, description, licensing, Strict compliance and
 * the Framework it supersedes. It posts to `POST /api/frameworks` and, on success, opens the new Draft's
 * authoring page `/admin/frameworks/[id]`, where its Requirements and Control Mappings are added.
 */
export function NewFrameworkForm({ frameworks }: { frameworks: { id: string; name: string; version: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [description, setDescription] = useState("");
  const [licensing, setLicensing] = useState<Licensing>("PARAPHRASE_ONLY");
  const [strict, setStrict] = useState(false);
  const [supersedesId, setSupersedesId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim() || !version.trim()) {
      setError("Name and version are required.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/frameworks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          version: version.trim(),
          description: description.trim() || undefined,
          strictComplianceRequired: strict,
          licensing,
          supersedesId: supersedesId || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Failed to create the Framework");
        return;
      }
      router.push(`/admin/frameworks/${body.framework.id}`);
    } catch {
      setError("Failed to create the Framework");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="hc fc fc-new">
      <p className="fc-crumbs">
        <Link href="/frameworks">Frameworks</Link> / New Framework
      </p>
      <section className="hc-hero fc-new-hero" aria-labelledby="fc-new-title">
        <div>
          <div className="hc-who">
            <span className="hc-eyebrow">Requirement database</span>
          </div>
          <h1 id="fc-new-title">New Framework</h1>
          <p className="hc-lede">
            A new Framework starts as a Draft, visible only to Compliance Managers and Admins. Add its Requirements and Control Mappings on the next
            page, then publish it.
          </p>
        </div>
      </section>

      <form className="hc-card fc-form" onSubmit={submit} noValidate>
        <div className="hc-card-h">
          <h2>Details</h2>
        </div>
        <div className="hc-card-b fc-fields">
          <label className="fc-field">
            <span>Name</span>
            <input className="fc-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="ISO/IEC 27001" required />
          </label>
          <label className="fc-field">
            <span>Version</span>
            <input className="fc-input" value={version} onChange={(event) => setVersion(event.target.value)} placeholder="2022" required />
          </label>
          <label className="fc-field wide">
            <span>Description</span>
            <textarea className="fc-input" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional" />
          </label>
          <label className="fc-field">
            <span>Licensing</span>
            <select className="fc-input" value={licensing} onChange={(event) => setLicensing(event.target.value as Licensing)}>
              <option value="PARAPHRASE_ONLY">Paraphrase only (licensed standard)</option>
              <option value="QUOTABLE">Quotable (public domain)</option>
            </select>
          </label>
          <label className="fc-field">
            <span>Supersedes</span>
            <select className="fc-input" value={supersedesId} onChange={(event) => setSupersedesId(event.target.value)}>
              <option value="">Nothing (first version)</option>
              {frameworks.map((other) => (
                <option key={other.id} value={other.id}>
                  {frameworkLabel(other)}
                </option>
              ))}
            </select>
          </label>
          <label className="fc-check wide">
            <input type="checkbox" checked={strict} onChange={(event) => setStrict(event.target.checked)} />
            Requires 100% Fulfilled (no partial credit for Waived/Not Applicable)
          </label>
          {error && (
            <p role="alert" className="fc-error wide">
              {error}
            </p>
          )}
          <div className="fc-actions wide">
            <button type="submit" className="hc-btn primary" disabled={saving}>
              {saving ? "Creating…" : "Create Framework"}
            </button>
            <Link href="/frameworks" className="hc-btn">
              Cancel
            </Link>
          </div>
        </div>
      </form>
    </div>
  );
}

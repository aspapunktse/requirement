"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ChoicePicker } from "@/components/ChoicePicker";
import { dueDateRefusal, validateInternalAudit } from "@/lib/internal-audit-rules";
import type { ControlChoice, InternalAuditDetail, SystemChoice } from "@/lib/internal-audits";

const INPUT_CLASSES = "rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent";

/**
 * Creates a draft Internal Audit, or edits one when `initial` is given (PRD 0001 F-IA.1,
 * #152). The Controls and Systems come from the server page as props. The form checks the
 * same rules as the API (`validateInternalAudit`, and `dueDateRefusal` for a new or changed
 * due date) and lists what is missing; the API still enforces them.
 */
export function InternalAuditForm({
  controls,
  systems,
  initial,
}: {
  controls: ControlChoice[];
  systems: SystemChoice[];
  initial?: InternalAuditDetail;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [scopeDescription, setScopeDescription] = useState(initial?.scopeDescription ?? "");
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [includeOrganization, setIncludeOrganization] = useState(initial?.includeOrganization ?? false);
  const [controlIds, setControlIds] = useState<string[]>(initial?.controls.map((control) => control.id) ?? []);
  const [systemIds, setSystemIds] = useState<string[]>(initial?.systems.map((system) => system.id) ?? []);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const found = validateInternalAudit({ title, controlIds, systemIds, includeOrganization, dueDate: dueDate || null });
    if (dueDate && dueDate !== initial?.dueDate) {
      const refusal = dueDateRefusal(dueDate);
      if (refusal) found.push(refusal);
    }
    setProblems(found);
    if (found.length > 0) return;

    setBusy(true);
    try {
      const response = await fetch(initial ? `/api/internal-audits/${initial.id}` : "/api/internal-audits", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, scopeDescription, dueDate, includeOrganization, controlIds, systemIds }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setProblems(body.problems ?? [body.error ?? "Failed to save the Internal Audit"]);
        return;
      }
      router.push(`/internal-audits/${body.internalAudit.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {problems.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-600">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Title
        <input className={INPUT_CLASSES} value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Scope (optional)
        <textarea
          className={INPUT_CLASSES}
          rows={3}
          value={scopeDescription}
          onChange={(event) => setScopeDescription(event.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Due date
        <input type="date" className={`${INPUT_CLASSES} self-start`} value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
      </label>

      <ChoicePicker
        legend="Controls to audit"
        searchLabel="Search Controls by code or title"
        items={controls.map((control) => ({ id: control.id, label: control.code, detail: control.title }))}
        selected={controlIds}
        onChange={setControlIds}
      />

      <ChoicePicker
        legend="Systems"
        searchLabel="Search Systems by name or vendor"
        items={systems.map((system) => ({ id: system.id, label: system.name, detail: system.vendor ?? undefined }))}
        selected={systemIds}
        onChange={setSystemIds}
      />

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeOrganization} onChange={(event) => setIncludeOrganization(event.target.checked)} />
        Include the Organization Control Implementations
      </label>

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {initial ? "Save" : "Create draft"}
        </Button>
        <Button onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}

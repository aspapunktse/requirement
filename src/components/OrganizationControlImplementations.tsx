"use client";

import { useState } from "react";
import type { ControlAssessmentStatus, UserRole } from "@prisma/client";
import { Button } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { canEditOrganizationImplementation, implementationDescriptionRefusal } from "@/lib/organization-implementation-rules";
import type { OrganizationControlRow } from "@/lib/organization-implementation";

const STATUSES = Object.keys(CONTROL_ASSESSMENT_STATUS_LABEL) as ControlAssessmentStatus[];

const APPLICABILITY_LABEL: Record<OrganizationControlRow["applicability"], string> = {
  ORGANIZATIONAL: "Organizational",
  BOTH: "Both",
};

type StatusFilter = "ALL" | ControlAssessmentStatus;

/** A UTC calendar date, the same on the server and in the browser (no relative "3m ago", which would not hydrate). */
function formatDate(iso: string) {
  return iso.slice(0, 10);
}

/**
 * The Organization's Controls with their Organization Control Implementation
 * (PRD 0001 F-IN.1, #120): code, title, applicability, Control Owner, status,
 * description and who last updated it. Every role reads it. A row opens an inline
 * editor (status and description) only for a user who may edit it: that Control's
 * Control Owner, a Compliance Manager or an Admin (`canEditOrganizationImplementation`,
 * the same function the API enforces). Rows come from the server page as props and
 * are updated from the PATCH response.
 */
export function OrganizationControlImplementations({
  controls,
  user,
  initialMine = false,
}: {
  controls: OrganizationControlRow[];
  user: { id: string; role: UserRole };
  initialMine?: boolean;
}) {
  const [rows, setRows] = useState(controls);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [mine, setMine] = useState(initialMine);
  const [editingId, setEditingId] = useState<string | null>(null);

  const visible = rows.filter(
    (row) =>
      (statusFilter === "ALL" || row.implementation.status === statusFilter) &&
      (!mine || row.owner?.id === user.id),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          Status
          <select
            aria-label="Status filter"
            className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="ALL">All statuses</option>
            {STATUSES.map((status) => (
              <option key={status} value={status}>
                {CONTROL_ASSESSMENT_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />
          Only Controls I own
        </label>
        <p className="ml-auto text-sm text-zinc-500">{`${visible.length} of ${rows.length} Controls`}</p>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="p-2 font-semibold">Code</th>
              <th className="p-2 font-semibold">Title</th>
              <th className="p-2 font-semibold">Applies to</th>
              <th className="p-2 font-semibold">Control Owner</th>
              <th className="p-2 font-semibold">Status</th>
              <th className="p-2 font-semibold">Description</th>
              <th className="p-2 font-semibold">Last updated</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-zinc-500">
                  No Controls match.
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const editable = canEditOrganizationImplementation(user, { ownerId: row.owner?.id ?? null });
              const editing = editable && editingId === row.id;
              return (
                <tr key={row.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  <td className="p-2 whitespace-nowrap">{row.code}</td>
                  <td className="p-2">{row.title}</td>
                  <td className="p-2 text-zinc-500">{APPLICABILITY_LABEL[row.applicability]}</td>
                  <td className="p-2 text-zinc-500">{row.owner?.name ?? "No Control Owner"}</td>
                  {editing ? (
                    <ImplementationEditor
                      row={row}
                      onCancel={() => setEditingId(null)}
                      onSaved={(saved) => {
                        setRows((previous) => previous.map((r) => (r.id === saved.id ? saved : r)));
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <>
                      <td className="p-2 whitespace-nowrap">
                        <StatusChip tone={controlAssessmentStatusTone(row.implementation.status)}>
                          {CONTROL_ASSESSMENT_STATUS_LABEL[row.implementation.status]}
                        </StatusChip>
                      </td>
                      <td className="p-2">
                        {row.implementation.description ? (
                          <p className="whitespace-pre-wrap">{row.implementation.description}</p>
                        ) : (
                          <span className="text-zinc-500">No description</span>
                        )}
                        {editable && (
                          <Button
                            className="mt-2 px-2 py-0.5 text-xs"
                            aria-label={`Edit ${row.code}`}
                            onClick={() => setEditingId(row.id)}
                          >
                            Edit
                          </Button>
                        )}
                      </td>
                      <td className="p-2 text-zinc-500">
                        <LastUpdated implementation={row.implementation} />
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LastUpdated({ implementation }: { implementation: OrganizationControlRow["implementation"] }) {
  if (!implementation.updatedAt) return <span>—</span>;
  return (
    <span title={implementation.updatedAt}>
      {formatDate(implementation.updatedAt)}
      {implementation.updatedBy ? ` by ${implementation.updatedBy.name}` : ""}
    </span>
  );
}

/** The inline editor: renders the row's Status, Description and Last-updated cells as one form. */
function ImplementationEditor({
  row,
  onCancel,
  onSaved,
}: {
  row: OrganizationControlRow;
  onCancel: () => void;
  onSaved: (saved: OrganizationControlRow) => void;
}) {
  const [status, setStatus] = useState<ControlAssessmentStatus>(row.implementation.status);
  const [description, setDescription] = useState(row.implementation.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same rule the API enforces, so the person sees why Save is off before trying.
  const refusal = implementationDescriptionRefusal(status, description);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/organization/controls/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, description }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(body.error ?? "Failed to save");
      return;
    }
    onSaved(body.control as OrganizationControlRow);
  }

  return (
    <td colSpan={3} className="p-2">
      <div className="flex flex-col gap-2">
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          {`Status of ${row.code}`}
          <select
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={status}
            onChange={(event) => setStatus(event.target.value as ControlAssessmentStatus)}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {CONTROL_ASSESSMENT_STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {`Description of ${row.code}`}
          <textarea
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {refusal && <p className="text-xs text-zinc-500">{refusal}.</p>}
        <div className="flex gap-2">
          <Button variant="primary" onClick={handleSave} disabled={saving || refusal !== null}>
            Save
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </div>
    </td>
  );
}

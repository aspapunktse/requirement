"use client";

import { useState } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import {
  APPLICABILITY_LABEL,
  countByInclusion,
  countJustificationsMissing,
  EXCLUSION_JUSTIFICATION_MAX_LENGTH,
  describeRollup,
  type InclusionFilter,
  type StatementOfApplicabilityRow,
} from "@/lib/statement-of-applicability-rules";

/**
 * The Statement of Applicability table (PRD 0001 F-OUT.4, #145): one row per
 * Control, filterable to all / included / excluded (with counts). An excluded
 * Control with no exclusion justification is flagged "justification missing".
 * Rows come from the server page as props. With `canEdit` (a Compliance Manager or an
 * Admin; the API enforces it) an excluded Control's exclusion justification can be
 * written, edited and cleared inline (#150); the row and the "justification missing"
 * count are updated from the PUT response.
 */
export function StatementOfApplicability({
  rows: initialRows,
  canEdit = false,
}: {
  rows: StatementOfApplicabilityRow[];
  canEdit?: boolean;
}) {
  const [rows, setRows] = useState(initialRows);
  const [filter, setFilter] = useState<InclusionFilter>("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);
  const counts = countByInclusion(rows);
  const missing = countJustificationsMissing(rows);

  const visible = rows.filter(
    (row) => filter === "ALL" || (filter === "INCLUDED" ? row.included : !row.included),
  );
  const options: { value: InclusionFilter; label: string; count: number }[] = [
    { value: "ALL", label: "All", count: counts.all },
    { value: "INCLUDED", label: "Included", count: counts.included },
    { value: "EXCLUDED", label: "Excluded", count: counts.excluded },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Inclusion filter" className="flex flex-wrap items-center gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={filter === option.value}
            onClick={() => setFilter(option.value)}
            className={`rounded border px-3 py-1 text-sm ${
              filter === option.value
                ? "border-rg-accent font-medium"
                : "border-zinc-200 text-zinc-500 dark:border-zinc-800"
            }`}
          >
            {`${option.label} (${option.count})`}
          </button>
        ))}
        <p className="ml-auto text-sm text-zinc-500">{`Exclusion justifications missing: ${missing}`}</p>
        <a href="/api/statement-of-applicability/export" download className={buttonClassName("outline")}>
          Download CSV
        </a>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-200 dark:border-zinc-800">
              <th className="p-2 font-semibold">Code</th>
              <th className="p-2 font-semibold">Title</th>
              <th className="p-2 font-semibold">Applies to</th>
              <th className="p-2 font-semibold">Included</th>
              <th className="p-2 font-semibold">Justification</th>
              <th className="p-2 font-semibold">Implementation status</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-zinc-500">
                  No Controls match.
                </td>
              </tr>
            )}
            {visible.map((row) => (
              <tr key={row.controlId} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                <td className="p-2 whitespace-nowrap">{row.code}</td>
                <td className="p-2">{row.title}</td>
                <td className="p-2 text-zinc-500">{APPLICABILITY_LABEL[row.applicability]}</td>
                <td className="p-2 whitespace-nowrap">
                  <StatusChip tone={row.included ? "success" : "neutral"}>{row.included ? "Included" : "Excluded"}</StatusChip>
                </td>
                <td className="p-2">
                  {row.included ? (
                    row.inclusionJustification || <span className="text-zinc-500">No mapped Requirement</span>
                  ) : canEdit && editingId === row.controlId ? (
                    <JustificationEditor
                      row={row}
                      onCancel={() => setEditingId(null)}
                      onSaved={(saved) => {
                        setRows((previous) => previous.map((r) => (r.controlId === saved.controlId ? { ...r, ...saved } : r)));
                        setEditingId(null);
                      }}
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      {row.exclusionJustification ? (
                        <p className="whitespace-pre-wrap">{row.exclusionJustification}</p>
                      ) : (
                        <StatusChip tone="warn">Justification missing</StatusChip>
                      )}
                      {canEdit && (
                        <Button className="px-2 py-0.5 text-xs" aria-label={`Edit justification of ${row.code}`} onClick={() => setEditingId(row.controlId)}>
                          {row.exclusionJustification ? "Edit" : "Add"}
                        </Button>
                      )}
                    </div>
                  )}
                </td>
                <td className="p-2">
                  <ImplementationStatus row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

type SavedJustification = Pick<StatementOfApplicabilityRow, "controlId" | "exclusionJustification" | "justificationMissing">;

/** The inline editor of an excluded Control's exclusion justification: Save, Cancel and (when one is stored) Clear. */
function JustificationEditor({
  row,
  onCancel,
  onSaved,
}: {
  row: StatementOfApplicabilityRow;
  onCancel: () => void;
  onSaved: (saved: SavedJustification) => void;
}) {
  const [text, setText] = useState(row.exclusionJustification ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(justification: string | null) {
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/statement-of-applicability/${row.controlId}/exclusion-justification`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification }),
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) {
      setError(body.error ?? "Failed to save");
      return;
    }
    onSaved(body as SavedJustification);
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <label className="flex flex-col gap-1 text-sm">
        {`Exclusion justification of ${row.code}`}
        <textarea
          className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
          rows={4}
          maxLength={EXCLUSION_JUSTIFICATION_MAX_LENGTH}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <Button variant="primary" onClick={() => save(text)} disabled={saving}>
          Save
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        {row.exclusionJustification && (
          <Button variant="outline" onClick={() => save(null)} disabled={saving}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

function ImplementationStatus({ row }: { row: StatementOfApplicabilityRow }) {
  if (!row.included) return <span className="text-zinc-500">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {row.organizationStatus && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">Organization</span>
          <StatusChip tone={controlAssessmentStatusTone(row.organizationStatus)}>
            {CONTROL_ASSESSMENT_STATUS_LABEL[row.organizationStatus]}
          </StatusChip>
        </div>
      )}
      {row.systemRollup && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-zinc-500">{`Systems (${row.systemRollup.total})`}</span>
          <span>{describeRollup(row.systemRollup)}</span>
        </div>
      )}
    </div>
  );
}

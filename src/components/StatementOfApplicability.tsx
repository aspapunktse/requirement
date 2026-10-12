"use client";

import { useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone } from "@/lib/status-tones";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import {
  countByInclusion,
  describeRollup,
  type InclusionFilter,
  type StatementOfApplicabilityRow,
} from "@/lib/statement-of-applicability-rules";

const APPLICABILITY_LABEL: Record<StatementOfApplicabilityRow["applicability"], string> = {
  ORGANIZATIONAL: "Organizational",
  PER_SYSTEM: "Per-System",
  BOTH: "Both",
};

/**
 * The Statement of Applicability table (PRD 0001 F-OUT.4, #145): one row per
 * Control, filterable to all / included / excluded (with counts). An excluded
 * Control with no exclusion justification is flagged "justification missing".
 * Rows come from the server page as props; the view is read-only.
 */
export function StatementOfApplicability({ rows }: { rows: StatementOfApplicabilityRow[] }) {
  const [filter, setFilter] = useState<InclusionFilter>("ALL");
  const counts = countByInclusion(rows);

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
                ? "border-ems-amber-hover font-medium"
                : "border-zinc-200 text-zinc-500 dark:border-zinc-800"
            }`}
          >
            {`${option.label} (${option.count})`}
          </button>
        ))}
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
                  ) : row.exclusionJustification ? (
                    row.exclusionJustification
                  ) : (
                    <StatusChip tone="warn">Justification missing</StatusChip>
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

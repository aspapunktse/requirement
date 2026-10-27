"use client";

import { useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { controlAssessmentStatusTone, requirementStatusTone } from "@/lib/status-tones";
import { frameworkLabel } from "@/lib/framework-label";
import { effectiveNote, effectiveSourceDetails, effectiveSourceLabel } from "@/lib/effective-status";
import {
  CONTROL_ASSESSMENT_STATUS_LABEL,
  DERIVED_STATUS_LABEL,
  DERIVED_STATUS_ORDER,
  matchesDerivedStatusFilter,
  type DerivationBasis,
  type DerivedStatusFilter,
} from "@/lib/requirement-status-rules";
import type { DerivedRequirementRow, SystemFrameworkRequirements } from "@/lib/requirement-status";

export type { DerivedRequirementRow, SystemFrameworkRequirements };

const BASIS_NOTE: Partial<Record<DerivationBasis, string>> = {
  NO_MAPPED_CONTROLS: "No Controls are mapped to this Requirement yet, so it counts as Not Met.",
  ACCEPTED_GAP:
    "Every applicable Control is fulfilled, but this Requirement is an accepted gap rather than fully covered, so it is not Met.",
  PARTIAL_COVERAGE:
    "Every applicable Control is fulfilled, but the Controls that apply here give only Partial coverage, so it is not Met.",
};

function groupBySection(rows: DerivedRequirementRow[]) {
  const groups = new Map<string, DerivedRequirementRow[]>();
  for (const row of rows) groups.set(row.section, [...(groups.get(row.section) ?? []), row]);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([section, items]) => ({
      section,
      items: items.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    }));
}

/**
 * One Framework's Requirements on the System page (PRD 0001 F-OUT.2, #89; the content "Show Requirements not
 * met" opens on its card in the Requirements tab, #245): the Requirements by section with their derived status
 * (Met / Partially Met / Not Met / Not Applicable) and the applicable Controls behind each with their effective
 * status and where it comes from (*System-specific*, *Inherited from Organization*, *Inherited from Provider X:
 * Full or Shared*, *Implemented by the Organization*), filterable by status. Read-only: the data is derived
 * live on the server. The filter starts on `initialFilter`.
 */
export function FrameworkRequirementsDetail({
  entry,
  id,
  initialFilter = "ALL",
}: {
  entry: SystemFrameworkRequirements;
  /** The element id, for the toggle's `aria-controls`. */
  id: string;
  initialFilter?: DerivedStatusFilter;
}) {
  const [filter, setFilter] = useState<DerivedStatusFilter>(initialFilter);

  const label = frameworkLabel(entry.framework);
  const shown = entry.rows.filter((row) => matchesDerivedStatusFilter(row.status, filter));
  const groups = groupBySection(shown);

  return (
    <div id={id} className="flex flex-col gap-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <p className="text-sm text-zinc-500">
        {entry.framework.strictComplianceRequired
          ? "Strict Framework: Waived and Not Applicable Control Assessments do not count as fulfilled."
          : "Waived and Not Applicable Control Assessments count as fulfilled."}{" "}
        A Requirement none of whose mapped Controls apply to this System is Not Applicable and is left out of the
        percentage. Partially Met counts as not Met.
      </p>

      <label className="flex items-center gap-2 text-sm">
        Show
        <select
          aria-label={`Status filter for ${label}`}
          className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={filter}
          onChange={(event) => setFilter(event.target.value as DerivedStatusFilter)}
        >
          <option value="ALL">All Requirements</option>
          {DERIVED_STATUS_ORDER.map((status) => (
            <option key={status} value={status}>
              {DERIVED_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      </label>

      {groups.length === 0 && <p className="text-sm text-zinc-500">No Requirements match this filter.</p>}

      {groups.map(({ section, items }) => (
        <section key={section} aria-label={`Section ${section}`} className="flex flex-col gap-2">
          <h3 className="border-b border-zinc-200 pb-1 text-sm font-semibold dark:border-zinc-800">{section}</h3>
          <ul className="flex flex-col gap-2">
            {items.map((row) => {
              const applicable = row.controls.filter((control) => control.applicable);
              const notApplicable = row.controls.filter((control) => !control.applicable);
              return (
                <li
                  key={row.requirementId}
                  aria-label={`Requirement ${row.code}`}
                  className="rounded border border-zinc-200 p-2 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-baseline gap-2 text-sm">
                    <span className="font-medium">{row.code}</span>
                    <span>{row.title}</span>
                    <span className="ml-auto">
                      <StatusChip tone={requirementStatusTone(row.status)}>{DERIVED_STATUS_LABEL[row.status]}</StatusChip>
                    </span>
                  </div>

                  {BASIS_NOTE[row.basis] && <p className="mt-1 text-xs text-zinc-500">{BASIS_NOTE[row.basis]}</p>}

                  {applicable.length > 0 && (
                    <ul aria-label={`Applicable Controls for ${row.code}`} className="mt-1 flex flex-col gap-0.5 text-sm">
                      {applicable.map((control) => {
                        const status = control.effective?.status ?? control.assessmentStatus ?? "NOT_STARTED";
                        const details = control.effective ? effectiveSourceDetails(control.effective) : [];
                        const override = control.effective ? effectiveNote(control.effective) : null;
                        return (
                          <li key={control.controlId} className="flex flex-col">
                            <span className="flex flex-wrap items-center gap-2">
                              <span>
                                <span className="font-medium">{control.code}</span> {control.title}
                                <span className="text-zinc-500">{` · ${control.coverage === "FULL" ? "Full" : "Partial"} coverage`}</span>
                              </span>
                              <StatusChip tone={controlAssessmentStatusTone(status)}>
                                {CONTROL_ASSESSMENT_STATUS_LABEL[status]}
                              </StatusChip>
                            </span>
                            {control.effective && (
                              <span className="text-xs text-zinc-500">
                                {[effectiveSourceLabel(control.effective), ...details].join(" · ")}
                                {override && ` ${override}`}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {notApplicable.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      {applicable.length === 0
                        ? "None of the mapped Controls apply to this System: "
                        : "Mapped but not applicable to this System: "}
                      {notApplicable.map((control) => control.code).join(", ")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Ring } from "@/app/home/HomeGraphics";
import { compliancePercentage, formatCompliancePercentage } from "@/lib/requirement-status-rules";
import { FrameworkRequirementsDetail, type SystemFrameworkRequirements } from "./FrameworkRequirementsDetail";
import { Stack } from "./Stack";
import type { FrameworkSummary } from "./system-page-types";

const PARTS = (framework: FrameworkSummary) => [
  { value: framework.met, color: "var(--rg-success)", label: "Met" },
  { value: framework.partial, color: "var(--rg-gold)", label: "Partially met" },
  { value: framework.notMet, color: "var(--rg-danger)", label: "Not met" },
  { value: framework.notApplicable, color: "var(--rg-line)", label: "Not applicable" },
];

function FrameworkCard({ summary, entry }: { summary: FrameworkSummary; entry: SystemFrameworkRequirements | undefined }) {
  const [open, setOpen] = useState(false);
  const { label } = summary;
  const total = summary.met + summary.partial + summary.notMet + summary.notApplicable;
  const percentage = compliancePercentage({ MET: summary.met, applicable: summary.applicable });
  const panelId = `sc-fwreq-${summary.id}`;
  const parts = PARTS(summary);

  return (
    <section className="hc-card sc-fwcard" aria-label={`${label} Requirements`}>
      <div className="sc-fwcard-top">
        <Ring
          segments={[
            [summary.applicable === 0 ? 0 : summary.met / summary.applicable, "var(--rg-success)"],
            [summary.applicable === 0 ? 0 : summary.partial / summary.applicable, "var(--rg-gold)"],
          ]}
          size={92}
          stroke={10}
          center={formatCompliancePercentage(percentage)}
          label={`${label}: ${summary.met} of ${summary.applicable} applicable Requirements met`}
        />
        <div>
          <h3>
            {label}
            {summary.isBase && <span className="sc-pill">Base</span>}
            {entry?.framework.strictComplianceRequired && <span className="sc-pill gold">Strict</span>}
          </h3>
          <p className="muted">
            {total === 0 ? "This Framework has no Requirements yet." : `${summary.met} of ${summary.applicable} applicable Requirements met`}
          </p>
        </div>
      </div>
      {total > 0 && (
        <>
          <Stack parts={parts} height={10} label={`${label}: ${parts.map((part) => `${part.value} ${part.label.toLowerCase()}`).join(", ")}`} />
          <div className="hc-legend" aria-label={`Status counts for ${label}`}>
            {parts.map((part) => (
              <span key={part.label}>
                <i style={{ background: part.color }} />
                {part.label} <b>{part.value}</b>
              </span>
            ))}
          </div>
          <button type="button" className="sc-link sc-fwcard-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((value) => !value)}>
            {open ? "Hide Requirements" : "Show Requirements not met →"}
          </button>
          {open && entry && <FrameworkRequirementsDetail entry={entry} id={panelId} initialFilter="NOT_MET" />}
        </>
      )}
    </section>
  );
}

/**
 * The Requirements tab (design proposal A, #245): one card per Framework in the System's effective scope with
 * its Compliance Percentage (Met ÷ applicable Requirements, the figure the Overview and the Systems list use),
 * the counts per derived status, and "Show Requirements not met" to open that Framework's Requirements. Read-only.
 */
export function SystemRequirements({ frameworks, entries }: { frameworks: FrameworkSummary[]; entries: SystemFrameworkRequirements[] }) {
  if (frameworks.length === 0) {
    return <p className="hc-card hc-card-b hc-empty">This System has no Published Framework in scope.</p>;
  }
  const entryById = new Map(entries.map((entry) => [entry.framework.id, entry]));
  return (
    <div className="sc-fwcards">
      {frameworks.map((summary) => (
        <FrameworkCard key={summary.id} summary={summary} entry={entryById.get(summary.id)} />
      ))}
    </div>
  );
}

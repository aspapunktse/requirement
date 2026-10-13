"use client";

import { useState } from "react";
import Link from "next/link";
import { StatusChip } from "@/components/ui/StatusChip";
import { APPLICABILITY_LABEL } from "@/lib/statement-of-applicability-rules";
import type { ControlLibraryRow } from "@/lib/control-library";

type OriginFilter = "ALL" | "BASE" | "SUPPLEMENTARY";
type ApplicabilityFilter = "ALL" | ControlLibraryRow["applicability"];

const IMPACT_AXES = [
  { key: "minConfidentialityImpactLevel", label: "Min. Confidentiality" },
  { key: "minIntegrityImpactLevel", label: "Min. Integrity" },
  { key: "minAvailabilityImpactLevel", label: "Min. Availability" },
] as const;

const selectClass = "rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent";

/** "Draft Framework" marks only appear for a viewer who can see Drafts (the server never sends them otherwise). */
function ControlDetail({ control }: { control: ControlLibraryRow }) {
  const thresholds = IMPACT_AXES.filter(({ key }) => control[key]).map(({ key, label }) => `${label}: ${control[key]}`);
  return (
    <div className="flex flex-col gap-3 border-t border-zinc-100 p-3 text-sm dark:border-zinc-900">
      <p>{control.description}</p>

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-zinc-500">Category</dt>
        <dd>{control.category}</dd>
        <dt className="text-zinc-500">Applicability</dt>
        <dd>{APPLICABILITY_LABEL[control.applicability]}</dd>
        <dt className="text-zinc-500">Mandatory</dt>
        <dd>{control.mandatory ? "Mandatory" : "Not mandatory"}</dd>
        <dt className="text-zinc-500">Control Owner</dt>
        <dd>{control.ownerName ?? "No Control Owner"}</dd>
        <dt className="text-zinc-500">Origin</dt>
        <dd>{control.origin ? `Supplementary, authored for ${control.origin.label}${control.origin.draft ? " (Draft Framework)" : ""}` : "Base Control"}</dd>
        {control.applicability === "ORGANIZATIONAL" ? (
          <>
            <dt className="text-zinc-500">Scoping</dt>
            <dd>Organizational Controls are not scoped to Deployment Facets or Impact Levels.</dd>
          </>
        ) : (
          <>
            <dt className="text-zinc-500">Deployment Facets</dt>
            <dd>{control.deploymentFacets.length > 0 ? control.deploymentFacets.join(", ") : "Applies regardless"}</dd>
            <dt className="text-zinc-500">Impact Levels</dt>
            <dd>{thresholds.length > 0 ? thresholds.join(", ") : "Applies regardless"}</dd>
          </>
        )}
      </dl>

      {control.question && (
        <div>
          <h3 className="font-semibold">Self-Assessment Question</h3>
          <p>{control.question}</p>
          {control.intent && <p className="mt-1 text-zinc-500">Intent: {control.intent}</p>}
          {control.examples.length > 0 && (
            <ul aria-label={`Examples for ${control.code}`} className="mt-1 list-disc pl-5 text-zinc-500">
              {control.examples.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div>
        <h3 className="font-semibold">Mapped Requirements</h3>
        {control.mappings.length === 0 ? (
          <p className="text-zinc-500">No Framework Requirement yet.</p>
        ) : (
          <ul aria-label={`Requirements mapped to ${control.code}`} className="flex flex-col gap-1">
            {control.mappings.map((mapping) => (
              <li key={mapping.id}>
                <Link href={`/frameworks/${mapping.framework.id}/coverage`} className="text-ems-blue hover:underline">
                  {mapping.framework.label} {mapping.requirementCode}
                </Link>
                <span className="text-zinc-500">
                  {` — ${mapping.requirementTitle} · ${mapping.coverage === "FULL" ? "Full" : "Partial"} Coverage`}
                  {mapping.draft ? " · Draft Framework" : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The read-only Control Library (#169): one compact, expandable row per Control with a text
 * filter on code and title and filters for origin and Applicability. Rows come from the server
 * page as props; there is nothing to edit here.
 */
export function ControlLibrary({ rows }: { rows: ControlLibraryRow[] }) {
  const [text, setText] = useState("");
  const [origin, setOrigin] = useState<OriginFilter>("ALL");
  const [applicability, setApplicability] = useState<ApplicabilityFilter>("ALL");

  const needle = text.trim().toLowerCase();
  const visible = rows.filter(
    (row) =>
      (needle === "" || row.code.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle)) &&
      (origin === "ALL" || (origin === "SUPPLEMENTARY" ? !!row.origin : !row.origin)) &&
      (applicability === "ALL" || row.applicability === applicability),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          Search
          <input
            type="search"
            aria-label="Search Controls"
            placeholder="Code or title"
            className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Show
          <select
            aria-label="Origin filter"
            className={selectClass}
            value={origin}
            onChange={(event) => setOrigin(event.target.value as OriginFilter)}
          >
            <option value="ALL">All Controls</option>
            <option value="BASE">Base Controls</option>
            <option value="SUPPLEMENTARY">Supplementary Controls</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          Applicability
          <select
            aria-label="Applicability filter"
            className={selectClass}
            value={applicability}
            onChange={(event) => setApplicability(event.target.value as ApplicabilityFilter)}
          >
            <option value="ALL">Any Applicability</option>
            <option value="ORGANIZATIONAL">{APPLICABILITY_LABEL.ORGANIZATIONAL}</option>
            <option value="PER_SYSTEM">{APPLICABILITY_LABEL.PER_SYSTEM}</option>
            <option value="BOTH">{APPLICABILITY_LABEL.BOTH}</option>
          </select>
        </label>
      </div>

      <p className="text-sm text-zinc-500" aria-live="polite">
        Showing {visible.length} of {rows.length} Controls
      </p>

      {visible.length === 0 ? (
        <p className="text-sm text-zinc-500">No Controls match.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((control) => (
            <li key={control.id} className="rounded border border-zinc-200 dark:border-zinc-800">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-2 text-sm">
                  <span className="whitespace-nowrap font-medium">{control.code}</span>
                  <span className="flex-1">{control.title}</span>
                  <StatusChip tone="neutral">{APPLICABILITY_LABEL[control.applicability]}</StatusChip>
                  {control.origin && <StatusChip tone="accent">Supplementary</StatusChip>}
                  {!control.mandatory && <StatusChip tone="warn">Not mandatory</StatusChip>}
                </summary>
                <ControlDetail control={control} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

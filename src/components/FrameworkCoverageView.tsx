"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { StatusChip, type ChipTone } from "@/components/ui/StatusChip";
import { NEW_CONTROL_DRAFT, NewControlFields, newControlBody, type NewControlDraft } from "@/components/NewControlFields";
import {
  COVERAGE_STATE_LABEL,
  matchesCoverageFilter,
  type CoverageFilter,
  type CoverageState,
  type CoverageSummary,
} from "@/lib/coverage-state";
import { frameworkLabel } from "@/lib/framework-label";
import type { CoverageRequirement } from "@/lib/framework-coverage";

export type { CoverageRequirement };

const STATE_TONE: Record<CoverageState, ChipTone> = { COVERED: "success", GAP: "danger", ACCEPTED_GAP: "warn" };

type Action = { requirementId: string; kind: "accept" | "create" };

function groupBySection(requirements: CoverageRequirement[]) {
  const groups = new Map<string, CoverageRequirement[]>();
  for (const requirement of requirements) {
    groups.set(requirement.section, [...(groups.get(requirement.section) ?? []), requirement]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([section, items]) => ({
      section,
      items: items.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    }));
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    return (await response.json()).error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * The Framework Coverage view (the gap-analysis tool): every Requirement grouped
 * by section with its mapped Controls, each mapping's Coverage and its derived
 * state (covered / Coverage Gap / accepted gap), header counts and a "gaps
 * only" filter. Everyone who can see the Framework gets this read-only view;
 * Compliance Managers and Admins (`canCurate`) can also accept / un-accept a
 * gap (with a justification) and close a gap by creating a Supplementary
 * Control. The server page hands in the initial data; every change reloads it
 * from `GET /api/frameworks/[id]/coverage`. See #74, PRD 0001 F-OUT.1, F-CL.2, F-CL.5.
 */
export function FrameworkCoverageView({
  framework,
  initialSummary,
  initialRequirements,
  canCurate,
}: {
  framework: { id: string; name: string; version: string };
  initialSummary: CoverageSummary;
  initialRequirements: CoverageRequirement[];
  canCurate: boolean;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [requirements, setRequirements] = useState(initialRequirements);
  const [filter, setFilter] = useState<CoverageFilter>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [justification, setJustification] = useState("");
  const [controlDraft, setControlDraft] = useState<NewControlDraft>(NEW_CONTROL_DRAFT);

  const label = frameworkLabel(framework);
  const requirementsPath = `/api/frameworks/${framework.id}/requirements`;

  async function reload() {
    const response = await fetch(`/api/frameworks/${framework.id}/coverage`);
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to reload the Coverage view"));
      return;
    }
    const body = await response.json();
    setSummary(body.summary);
    setRequirements(body.requirements);
  }

  function open(requirementId: string, kind: Action["kind"], existingJustification = "") {
    setAction({ requirementId, kind });
    setJustification(existingJustification);
    setControlDraft(NEW_CONTROL_DRAFT);
    setError(null);
  }

  async function handleAccept(event: React.FormEvent, requirement: CoverageRequirement) {
    event.preventDefault();
    setError(null);
    const response = await fetch(`${requirementsPath}/${requirement.id}/gap-acceptance`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification }),
    });
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to accept the gap"));
      return;
    }
    setAction(null);
    await reload();
  }

  async function handleUnaccept(requirement: CoverageRequirement) {
    setError(null);
    const response = await fetch(`${requirementsPath}/${requirement.id}/gap-acceptance`, { method: "DELETE" });
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to un-accept the gap"));
      return;
    }
    await reload();
  }

  async function handleCreateControl(event: React.FormEvent, requirement: CoverageRequirement) {
    event.preventDefault();
    setError(null);
    const response = await fetch(`${requirementsPath}/${requirement.id}/supplementary-control`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newControlBody(controlDraft)),
    });
    if (!response.ok) {
      setError(await errorMessage(response, "Failed to create the Supplementary Control"));
      return;
    }
    setAction(null);
    await reload();
  }

  const shown = requirements.filter((requirement) => matchesCoverageFilter(requirement.state, filter));
  const groups = groupBySection(shown);

  const stats: { label: string; value: number }[] = [
    { label: "Requirements", value: summary.total },
    { label: "Covered", value: summary.covered },
    { label: "Gaps", value: summary.gaps },
    { label: "Accepted", value: summary.accepted },
  ];

  return (
    <div className="flex flex-col gap-6">
      <dl aria-label={`Coverage of ${label}`} className="flex flex-wrap gap-x-10 gap-y-3">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="ems-mono-label text-ems-ink-4">{stat.label}</dt>
            <dd className="text-lg text-ems-ink-1">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-zinc-500">
        A Requirement is covered when at least one mapped Control gives Full coverage; Partial mappings alone leave it a
        Coverage Gap. An accepted gap counts as resolved.
      </p>

      <label className="flex items-center gap-2 text-sm">
        Show
        <select
          aria-label="Coverage filter"
          className="rounded border border-zinc-200 p-1 text-sm dark:border-zinc-800 dark:bg-transparent"
          value={filter}
          onChange={(event) => setFilter(event.target.value as CoverageFilter)}
        >
          <option value="ALL">All Requirements</option>
          <option value="GAPS">Gaps only</option>
          <option value="ACCEPTED">Accepted gaps only</option>
        </select>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {groups.length === 0 && (
        <p className="text-sm text-zinc-500">
          {requirements.length === 0 ? "This Framework has no Requirements yet." : "No Requirements match this filter."}
        </p>
      )}

      {groups.map(({ section, items }) => (
        <section key={section} aria-label={`Section ${section}`} className="flex flex-col gap-3">
          <h2 className="border-b border-zinc-200 pb-1 text-base dark:border-zinc-800">{section}</h2>
          <ul className="flex flex-col gap-3">
            {items.map((requirement) => (
              <li
                key={requirement.id}
                aria-label={`Requirement ${requirement.code}`}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{requirement.code}</span>
                  <span>{requirement.title}</span>
                  <span className="ml-auto">
                    <StatusChip tone={STATE_TONE[requirement.state]}>{COVERAGE_STATE_LABEL[requirement.state]}</StatusChip>
                  </span>
                </div>

                {requirement.mappings.length === 0 ? (
                  <p className="mt-1 text-sm text-zinc-500">No mapped Controls.</p>
                ) : (
                  <ul aria-label={`Controls mapped to ${requirement.code}`} className="mt-1 flex flex-col gap-0.5 text-sm">
                    {requirement.mappings.map((mapping) => (
                      <li key={mapping.id}>
                        <span className="font-medium">{mapping.control.code}</span> {mapping.control.title}
                        <span className="text-zinc-500">
                          {` · ${mapping.coverage === "FULL" ? "Full" : "Partial"} coverage`}
                          {mapping.control.originFramework
                            ? ` · Supplementary (${frameworkLabel(mapping.control.originFramework)})`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {requirement.state === "ACCEPTED_GAP" && (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {`Accepted${requirement.gapAcceptedBy ? ` by ${requirement.gapAcceptedBy.name}` : ""}${
                      requirement.gapAcceptedAt ? ` on ${new Date(requirement.gapAcceptedAt).toLocaleDateString()}` : ""
                    }: ${requirement.gapJustification ?? ""}`}
                  </p>
                )}

                {canCurate && requirement.state !== "COVERED" && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      className="px-2 py-0.5 text-xs"
                      aria-label={`Create Supplementary Control for ${requirement.code}`}
                      onClick={() => open(requirement.id, "create")}
                    >
                      Create Supplementary Control
                    </Button>
                    <Button
                      className="px-2 py-0.5 text-xs"
                      aria-label={
                        requirement.state === "ACCEPTED_GAP"
                          ? `Edit justification for ${requirement.code}`
                          : `Accept gap ${requirement.code}`
                      }
                      onClick={() => open(requirement.id, "accept", requirement.gapJustification ?? "")}
                    >
                      {requirement.state === "ACCEPTED_GAP" ? "Edit justification" : "Accept gap"}
                    </Button>
                    {requirement.state === "ACCEPTED_GAP" && (
                      <Button
                        className="px-2 py-0.5 text-xs"
                        aria-label={`Un-accept gap ${requirement.code}`}
                        onClick={() => handleUnaccept(requirement)}
                      >
                        Un-accept
                      </Button>
                    )}
                  </div>
                )}

                {canCurate && action?.requirementId === requirement.id && action.kind === "accept" && (
                  <form
                    onSubmit={(event) => handleAccept(event, requirement)}
                    aria-label={`Accept gap ${requirement.code}`}
                    className="mt-2 flex flex-col gap-2"
                  >
                    <textarea
                      aria-label="Justification"
                      placeholder="Why is it acceptable that this Requirement has no Full coverage?"
                      className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800 dark:bg-transparent"
                      value={justification}
                      onChange={(event) => setJustification(event.target.value)}
                      required
                    />
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary">
                        Save acceptance
                      </Button>
                      <Button onClick={() => setAction(null)}>Cancel</Button>
                    </div>
                  </form>
                )}

                {canCurate && action?.requirementId === requirement.id && action.kind === "create" && (
                  <form
                    onSubmit={(event) => handleCreateControl(event, requirement)}
                    aria-label={`New Supplementary Control for ${requirement.code}`}
                    className="mt-2 flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <h3 className="text-sm font-semibold">New Supplementary Control</h3>
                    <p className="text-xs text-zinc-500">
                      {`Origin Framework: ${label}. Saving also maps it to ${requirement.code} with Full coverage, which closes this gap.`}
                    </p>
                    <NewControlFields
                      draft={controlDraft}
                      onChange={(patch) => setControlDraft((prev) => ({ ...prev, ...patch }))}
                    />
                    <div className="flex gap-2">
                      <Button type="submit" variant="primary">
                        Create Control
                      </Button>
                      <Button onClick={() => setAction(null)}>Cancel</Button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {canCurate && (
        <p className="text-sm">
          <Link href={`/admin/frameworks/${framework.id}`} className="text-ems-blue hover:underline">
            Edit Requirements &amp; mappings &rarr;
          </Link>
        </p>
      )}
    </div>
  );
}

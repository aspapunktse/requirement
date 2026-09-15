"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { riskStatusTone } from "@/lib/status-tones";

type CatalogItem = { id: string; name: string };

type Risk = {
  id: string;
  title: string;
  description: string;
  severity: string;
  likelihood: string;
  status: string;
  system: { id: string; name: string };
  requirementAssessment: { requirement: { code: string; title: string } } | null;
};

type SystemCompliance = {
  systemId: string;
  systemName: string;
  resolved: number;
  total: number;
  percentage: number | null;
};

type Compliance = {
  resolved: number;
  total: number;
  percentage: number | null;
  bySystem: SystemCompliance[];
};

function buildQuery(businessUnitId: string, frameworkId: string) {
  const params = new URLSearchParams();
  if (businessUnitId) params.set("businessUnitId", businessUnitId);
  if (frameworkId) params.set("frameworkId", frameworkId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/**
 * The Business Risk Owner's two views: a Risk queue and a compliance-%
 * breakdown, both scoped to the acting user's assigned Business Unit(s)/
 * Framework(s) server-side, and both filterable together by an explicit
 * Business Unit and/or Framework picked from the assigned portfolio (the
 * `businessUnits`/`frameworks` props — passed down from the server
 * component, since this app has no general "who am I" client endpoint
 * outside the dev-only acting-user stub). See #55.
 */
export function BusinessRiskOwnerDashboard({
  businessUnits,
  frameworks,
}: {
  businessUnits: CatalogItem[];
  frameworks: CatalogItem[];
}) {
  const [businessUnitId, setBusinessUnitId] = useState("");
  const [frameworkId, setFrameworkId] = useState("");
  const [risks, setRisks] = useState<Risk[] | null>(null);
  const [compliance, setCompliance] = useState<Compliance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => buildQuery(businessUnitId, frameworkId), [businessUnitId, frameworkId]);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    Promise.all([
      fetch(`/api/business-risk-owner/risks${query}`),
      fetch(`/api/business-risk-owner/compliance${query}`),
    ]).then(async ([risksRes, complianceRes]) => {
      if (cancelled) return;
      if (!risksRes.ok || !complianceRes.ok) {
        const body = await (risksRes.ok ? complianceRes : risksRes).json();
        setError(body.error ?? "Failed to load Business Risk Owner data");
        setRisks([]);
        setCompliance(null);
        return;
      }
      const risksBody = await risksRes.json();
      const complianceBody = await complianceRes.json();
      setRisks(risksBody.risks ?? []);
      setCompliance(complianceBody.compliance ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Business Unit
          <select
            aria-label="Filter by Business Unit"
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={businessUnitId}
            onChange={(event) => setBusinessUnitId(event.target.value)}
          >
            <option value="">All assigned</option>
            {businessUnits.map((bu) => (
              <option key={bu.id} value={bu.id}>
                {bu.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Framework
          <select
            aria-label="Filter by Framework"
            className="rounded border border-zinc-200 p-2 dark:border-zinc-800 dark:bg-transparent"
            value={frameworkId}
            onChange={(event) => setFrameworkId(event.target.value)}
          >
            <option value="">All assigned</option>
            {frameworks.map((framework) => (
              <option key={framework.id} value={framework.id}>
                {framework.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section>
        <h2 className="mb-2 text-lg">Compliance</h2>
        {compliance === null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (
          <>
            <p className="text-2xl">
              {compliance.percentage === null ? "—" : `${compliance.percentage}%`}{" "}
              <span className="text-sm font-normal text-zinc-500">
                ({compliance.resolved}/{compliance.total} mandatory Requirements resolved, pooled across
                Systems)
              </span>
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {compliance.bySystem.map((s) => (
                <li
                  key={s.systemId}
                  className="flex items-center justify-between rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800"
                >
                  <span>{s.systemName}</span>
                  <span className="text-zinc-500">
                    {s.percentage === null ? "—" : `${s.percentage}%`} ({s.resolved}/{s.total})
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg">Risks</h2>
        {risks === null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : risks.length === 0 ? (
          <p className="text-sm text-zinc-500">No Risks in scope.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {risks.map((risk) => (
              <li key={risk.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <span>{risk.title}</span>
                  <StatusChip tone={riskStatusTone(risk.status as Parameters<typeof riskStatusTone>[0])}>
                    {risk.status}
                  </StatusChip>
                </div>
                <p className="text-xs text-zinc-500">System: {risk.system.name}</p>
                <p className="text-sm text-zinc-500">{risk.description}</p>
                <p className="text-xs text-zinc-500">
                  Severity: {risk.severity} · Likelihood: {risk.likelihood}
                </p>
                {risk.requirementAssessment && (
                  <p className="text-xs text-zinc-500">
                    Originated from {risk.requirementAssessment.requirement.code} —{" "}
                    {risk.requirementAssessment.requirement.title}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

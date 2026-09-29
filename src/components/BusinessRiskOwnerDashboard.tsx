"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { frameworkLabel } from "@/lib/framework-label";
import { onboardingStatusTone, riskStatusTone } from "@/lib/status-tones";

type CatalogItem = { id: string; name: string; version?: string };

type PortfolioSystem = {
  id: string;
  name: string;
  vendor: string | null;
  status: string;
  compliancePercentage: number | null;
  openRiskCount: number;
};

/** Display order for grouping the System Portfolio by onboarding status. */
const PORTFOLIO_STATUS_ORDER = ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED", "ONBOARDED"];

type Risk = {
  id: string;
  title: string;
  description: string;
  severity: string;
  likelihood: string;
  status: string;
  system: { id: string; name: string };
  controlAssessment: { control: { code: string; title: string } } | null;
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
 * The Business Risk Owner's three views: a compliance-% breakdown, a System
 * Portfolio grouped by onboarding status (see #62), and a Risk queue — all
 * scoped to the acting user's assigned Business Unit(s)/Framework(s)
 * server-side, and all filterable together by an explicit Business Unit
 * and/or Framework picked from the assigned portfolio (the
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
  const [portfolio, setPortfolio] = useState<PortfolioSystem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => buildQuery(businessUnitId, frameworkId), [businessUnitId, frameworkId]);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    Promise.all([
      fetch(`/api/business-risk-owner/risks${query}`),
      fetch(`/api/business-risk-owner/compliance${query}`),
      fetch(`/api/business-risk-owner/portfolio${query}`),
    ]).then(async ([risksRes, complianceRes, portfolioRes]) => {
      if (cancelled) return;
      if (!risksRes.ok || !complianceRes.ok || !portfolioRes.ok) {
        const failed = [risksRes, complianceRes, portfolioRes].find((res) => !res.ok);
        const body = await failed!.json();
        setError(body.error ?? "Failed to load Business Risk Owner data");
        setRisks([]);
        setCompliance(null);
        setPortfolio([]);
        return;
      }
      const risksBody = await risksRes.json();
      const complianceBody = await complianceRes.json();
      const portfolioBody = await portfolioRes.json();
      setRisks(risksBody.risks ?? []);
      setCompliance(complianceBody.compliance ?? null);
      setPortfolio(portfolioBody.portfolio ?? []);
    });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const portfolioByStatus = useMemo(() => {
    if (!portfolio) return null;
    const groups = new Map<string, PortfolioSystem[]>();
    for (const system of portfolio) {
      const group = groups.get(system.status) ?? [];
      group.push(system);
      groups.set(system.status, group);
    }
    return PORTFOLIO_STATUS_ORDER.map((status) => ({ status, systems: groups.get(status) ?? [] })).filter(
      (group) => group.systems.length > 0,
    );
  }, [portfolio]);

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
                {frameworkLabel(framework)}
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
                ({compliance.resolved}/{compliance.total} mandatory Controls resolved, pooled across
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
        <h2 className="mb-2 text-lg">System Portfolio</h2>
        {portfolioByStatus === null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : portfolioByStatus.length === 0 ? (
          <p className="text-sm text-zinc-500">No Systems are currently associated with this Business Unit.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {portfolioByStatus.map((group) => (
              <div key={group.status}>
                <h3 className="mb-2 text-sm text-zinc-500">
                  {group.status} ({group.systems.length})
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {group.systems.map((system) => (
                    <Link
                      key={system.id}
                      href={`/systems/${system.id}`}
                      className="flex flex-col gap-1 rounded border border-zinc-200 p-2 text-sm hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                    >
                      <StatusChip tone={onboardingStatusTone(system.status)}>{system.status}</StatusChip>
                      <span className="font-medium">{system.name}</span>
                      {system.vendor && <span className="text-xs text-zinc-500">{system.vendor}</span>}
                      <span className="text-xs text-zinc-500">
                        {system.compliancePercentage === null ? "—" : `${system.compliancePercentage}%`} compliant ·{" "}
                        {system.openRiskCount} open Risk{system.openRiskCount === 1 ? "" : "s"}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
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
                {risk.controlAssessment && (
                  <p className="text-xs text-zinc-500">
                    Originated from {risk.controlAssessment.control.code} —{" "}
                    {risk.controlAssessment.control.title}
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

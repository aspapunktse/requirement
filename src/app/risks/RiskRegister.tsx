"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { StatusChip } from "@/components/ui/StatusChip";
import { riskSeverityTone, riskStatusTone } from "@/lib/status-tones";
import { RISK_SOURCES, RISK_SOURCE_LABELS, type RiskSourceValue } from "@/lib/risk-source";
import { ORGANIZATION_RISK_LABEL, ORGANIZATION_RISKS_HREF } from "@/lib/risk-roles";
import type { RiskRegisterRow } from "@/lib/risk-register";
import "@/app/home/home.css";
import "./risk-register.css";

const STATUSES = ["OPEN", "MITIGATED", "ACCEPTED", "TRANSFERRED", "CLOSED"] as const;
const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const WORD = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

type Filters = { source: string; status: string; severity: string };

/** A filter value from the URL only counts if it is one of the known values. */
function known(value: string, allowed: readonly string[]) {
  return allowed.includes(value) ? value : "";
}

/** Where the Risk is managed: its System's Risks tab, or the Organization Risks page. */
function whereManaged(risk: RiskRegisterRow) {
  return risk.system ? `/systems/${risk.system.id}#risks` : ORGANIZATION_RISKS_HREF;
}

/**
 * The Risk register (#322): read-only. The stat cards (open Risks by Risk Source) and the three selects
 * filter the table; the filters are kept in the URL (`?source=&status=&severity=`) so a view can be linked.
 */
export function RiskRegister({
  rows,
  canReadOrganizationRisks,
  initialFilters,
}: {
  rows: RiskRegisterRow[];
  canReadOrganizationRisks: boolean;
  initialFilters: Filters;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>({
    source: known(initialFilters.source, RISK_SOURCES),
    status: known(initialFilters.status, STATUSES),
    severity: known(initialFilters.severity, SEVERITIES),
  });

  function update(next: Partial<Filters>) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) params.set(key, value);
    const query = params.toString();
    router.replace(query ? `/risks?${query}` : "/risks", { scroll: false });
  }

  const shown = useMemo(
    () =>
      rows.filter(
        (risk) =>
          (!filters.source || risk.source === filters.source) &&
          (!filters.status || risk.status === filters.status) &&
          (!filters.severity || risk.severity === filters.severity),
      ),
    [rows, filters],
  );
  const openBySource = (source: RiskSourceValue) => rows.filter((risk) => risk.status === "OPEN" && risk.source === source).length;
  const openTotal = rows.filter((risk) => risk.status === "OPEN").length;

  return (
    <div className="hc rr">
      <section className="hc-hero" aria-labelledby="rr-title">
        <div>
          <span className="hc-eyebrow">Risks</span>
          <h1 id="rr-title">Risk register</h1>
          <p className="hc-lede">
            {rows.length} {rows.length === 1 ? "Risk" : "Risks"} you can see, {openTotal} open. Open a row to manage the Risk where it lives.
          </p>
          {canReadOrganizationRisks && (
            <p className="rr-links">
              Risks that belong to no System are managed on <Link href={ORGANIZATION_RISKS_HREF}>Organization Risks</Link>.
            </p>
          )}
        </div>
      </section>

      <section className="hc-stats" aria-label="Open Risks by Risk Source">
        {RISK_SOURCES.map((source) => (
          <button
            key={source}
            type="button"
            className="hc-card hc-stat"
            aria-pressed={filters.source === source}
            onClick={() => update(filters.source === source ? { source: "" } : { source, status: "OPEN" })}
          >
            <span className="k">
              {RISK_SOURCE_LABELS[source]}
              <em>Filter</em>
            </span>
            <span className="v">{openBySource(source)}</span>
          </button>
        ))}
      </section>

      <section className="hc-card" aria-labelledby="rr-list-h">
        <div className="hc-card-h">
          <h2 id="rr-list-h">Risks</h2>
          <p aria-live="polite">
            {shown.length} of {rows.length} shown
          </p>
        </div>
        <div className="hc-card-b">
          <div className="hc-toolbar">
            <label className="rr-field">
              Risk Source
              <select aria-label="Filter by Risk Source" value={filters.source} onChange={(event) => update({ source: event.target.value })}>
                <option value="">All sources</option>
                {RISK_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {RISK_SOURCE_LABELS[source]}
                  </option>
                ))}
              </select>
            </label>
            <label className="rr-field">
              Status
              <select aria-label="Filter by status" value={filters.status} onChange={(event) => update({ status: event.target.value })}>
                <option value="">Any status</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {WORD(status)}
                  </option>
                ))}
              </select>
            </label>
            <label className="rr-field">
              Severity
              <select aria-label="Filter by severity" value={filters.severity} onChange={(event) => update({ severity: event.target.value })}>
                <option value="">Any severity</option>
                {SEVERITIES.map((severity) => (
                  <option key={severity} value={severity}>
                    {WORD(severity)}
                  </option>
                ))}
              </select>
            </label>
            {(filters.source || filters.status || filters.severity) && (
              <button type="button" className="hc-btn" onClick={() => update({ source: "", status: "", severity: "" })}>
                Clear filters
              </button>
            )}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="hc-empty hc-card-b">{rows.length === 0 ? "No Risks to show." : "No Risks match these filters."}</p>
        ) : (
          <div className="rr-tablewrap">
            <table className="rr-table">
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>System</th>
                  <th>Risk Source</th>
                  <th>Severity</th>
                  <th>Likelihood</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Opened</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((risk) => (
                  <tr key={risk.id}>
                    <td>
                      <Link href={whereManaged(risk)}>{risk.title}</Link>
                    </td>
                    <td>{risk.system ? risk.system.name : ORGANIZATION_RISK_LABEL}</td>
                    <td>{RISK_SOURCE_LABELS[risk.source]}</td>
                    <td>
                      <StatusChip tone={riskSeverityTone(risk.severity)}>{WORD(risk.severity)}</StatusChip>
                    </td>
                    <td>{WORD(risk.likelihood)}</td>
                    <td>
                      <StatusChip tone={riskStatusTone(risk.status)}>{WORD(risk.status)}</StatusChip>
                    </td>
                    <td>{risk.owner ? risk.owner.name : <span className="muted">Unassigned</span>}</td>
                    <td className="muted">{risk.createdAt.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

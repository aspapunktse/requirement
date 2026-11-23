"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { frameworkLabel } from "@/lib/framework-label";
import { formatCompliancePercentage, DERIVED_STATUS_LABEL } from "@/lib/requirement-status-rules";
import {
  countStatementRows,
  describeMetOn,
  JUSTIFICATION_MAX_LENGTH,
  matchesStatementFilter,
  STATEMENT_STATUS_LABEL,
  type BoundaryStatement,
  type BoundaryStatementRow,
  type StatementFilter,
} from "@/lib/boundary-statement-rules";

const FILTERS: { id: StatementFilter; label: string; key: "all" | "included" | "excluded" | "notMet" | "missing" }[] = [
  { id: "ALL", label: "All", key: "all" },
  { id: "INCLUDED", label: "Included", key: "included" },
  { id: "EXCLUDED", label: "Excluded", key: "excluded" },
  { id: "NOT_MET", label: "Not met", key: "notMet" },
  { id: "MISSING", label: "Missing justification", key: "missing" },
];

const STATUS_CLASS = { MET: "ok", PARTIALLY_MET: "warn", NOT_MET: "bad" } as const;

/**
 * The Statement of Applicability of one Compliance Boundary (#420, design proposal C): one section per Framework, each Requirement a
 * row that is included or excluded (derived, never chosen). Filter chips, a search, and a drill-down per row with the status on each
 * counted System; an excluded row carries its justification, which the Boundary Owner, a Compliance Manager or an Admin edit here.
 * A saved text is written through the API and the page refreshes, so the rows come from the server again.
 */
export function StatementPanel({ statement, headingId = "cb-statement-h" }: { statement: BoundaryStatement; headingId?: string }) {
  const [filter, setFilter] = useState<StatementFilter>("ALL");
  const [query, setQuery] = useState("");
  const counts = useMemo(() => countStatementRows(statement.sections.flatMap((section) => section.rows)), [statement]);
  const needle = query.trim().toLowerCase();
  const { boundary } = statement;

  return (
    <section className="hc-card cb-st" id="statement" aria-labelledby={headingId}>
      <div className="hc-card-h">
        <h2 id={headingId}>Statement of Applicability</h2>
        <p>Derived from the counted Systems</p>
      </div>
      <div className="hc-card-b cb">
        {boundary.retired ? (
          <p className="cb-empty">A retired Compliance Boundary has no Statement of Applicability. It is a read-only record.</p>
        ) : (
          <>
            <p className="cb-st-note">
              A Requirement is included when it applies to at least one counted System (one with an ATO, or Onboarded) or is met by Organizational Controls. Its status is
              the worst across those Systems. Inclusion is derived, not chosen: only an excluded Requirement carries a justification, and it never changes a status.
            </p>
            <div className="cb-st-systems" data-testid="cb-st-systems">
              <span className="cb-tag fw">{statement.countedSystems.length} counted {statement.countedSystems.length === 1 ? "System" : "Systems"}</span>
              {statement.notYetOperating.length > 0 && (
                <span className="cb-tag warn" title={statement.notYetOperating.map((s) => s.name).join(", ")}>
                  {statement.notYetOperating.length} not yet operating, not counted: {statement.notYetOperating.map((s) => s.name).join(", ")}
                </span>
              )}
              {statement.closed.length > 0 && (
                <span className="cb-tag" title={statement.closed.map((s) => s.name).join(", ")}>
                  {statement.closed.length} closed, not counted: {statement.closed.map((s) => s.name).join(", ")}
                </span>
              )}
            </div>
            <div className="cb-st-tools">
              <div className="cb-st-chips" role="group" aria-label="Filter the statement">
                {FILTERS.map((chip) => (
                  <button key={chip.id} type="button" className="cb-st-chip" aria-pressed={filter === chip.id} onClick={() => setFilter(chip.id)}>
                    {chip.label} <span className="n">{counts[chip.key]}</span>
                  </button>
                ))}
              </div>
              <input
                type="search"
                className="cb-input cb-st-search"
                placeholder="Search Requirements"
                aria-label="Search Requirements"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {statement.sections.map((section) => {
              const rows = section.rows.filter(
                (row) => matchesStatementFilter(row, filter) && (needle === "" || `${row.code} ${row.title}`.toLowerCase().includes(needle)),
              );
              const included = section.rows.filter((row) => row.included).length;
              return (
                <section key={section.framework.id} className="cb-st-fw" aria-label={frameworkLabel(section.framework)} data-testid={`cb-st-fw-${section.framework.id}`}>
                  <header className="cb-st-fw-h">
                    <h3>{frameworkLabel(section.framework)}</h3>
                    <span className="cb-tag">
                      {included} included, {section.rows.length - included} excluded
                    </span>
                    <span className="cb-tag fw">{formatCompliancePercentage(section.percentage)}</span>
                  </header>
                  {rows.length === 0 ? (
                    <p className="cb-empty">{section.rows.length === 0 ? "This Framework has no Requirements." : "No Requirements match."}</p>
                  ) : (
                    <table className="cb-st-table">
                      <thead>
                        <tr>
                          <th scope="col">Requirement</th>
                          <th scope="col">In the statement</th>
                          <th scope="col">Worst status</th>
                          <th scope="col">Justification</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <StatementRowView key={row.requirementId} row={row} statement={statement} />
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
}

function StatementRowView({ row, statement }: { row: BoundaryStatementRow; statement: BoundaryStatement }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="cb-st-row" data-testid={`cb-st-row-${row.requirementId}`}>
        <td>
          <button type="button" className="cb-st-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            <b>{row.code}</b> <span>{row.title}</span>
          </button>
        </td>
        <td>
          <span className={`cb-tag ${row.included ? "fw" : ""}`}>{row.included ? "Included" : "Excluded"}</span>
        </td>
        <td>
          {row.worstStatus ? (
            <>
              <span className={`cb-st-status ${STATUS_CLASS[row.worstStatus]}`}>{STATEMENT_STATUS_LABEL[row.worstStatus]}</span>{" "}
              <small>{describeMetOn(row)}</small>
            </>
          ) : (
            <span className="cb-st-dash">-</span>
          )}
        </td>
        <td>
          {row.included ? (
            <span className="cb-st-dash">-</span>
          ) : row.justification ? (
            <span className="cb-st-just">{row.justification}</span>
          ) : (
            <span className="cb-tag warn">Missing</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="cb-st-drill">
          <td colSpan={4}>
            <Drilldown row={row} statement={statement} />
          </td>
        </tr>
      )}
    </>
  );
}

function Drilldown({ row, statement }: { row: BoundaryStatementRow; statement: BoundaryStatement }) {
  const router = useRouter();
  const [text, setText] = useState(row.justification ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(next: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/compliance-boundaries/${statement.boundary.id}/statement/justifications/${row.requirementId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: next }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "Failed to save the justification");
        return;
      }
      setText(body.justification ?? "");
      router.refresh();
    } catch {
      setError("Failed to save the justification");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cb-st-detail">
      {row.included ? (
        <>
          {row.systemStatuses.length > 0 && (
            <ul className="cb-members">
              {row.systemStatuses.map(([index, status]) => {
                const system = statement.systems[index];
                return (
                  <li key={system.id} className="cb-member">
                    <Link href={`/systems/${system.id}`}>{system.name}</Link>
                    <span className="cb-grow" />
                    <span className="cb-tag">{DERIVED_STATUS_LABEL[status]}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {row.hiddenSystemCount > 0 && (
            <p className="cb-empty">
              {row.hiddenSystemCount} more counted {row.hiddenSystemCount === 1 ? "System is" : "Systems are"} not visible to you; {row.hiddenSystemCount === 1 ? "it counts" : "they count"} in the figures.
            </p>
          )}
          {row.organizationStatus && <p className="cb-empty">Organizational Controls: {STATEMENT_STATUS_LABEL[row.organizationStatus]}.</p>}
        </>
      ) : (
        <>
          <p className="cb-empty">
            Excluded: no counted System in this Compliance Boundary has a Control for this Requirement that applies, and no Organizational Control meets it.
          </p>
          {statement.canEdit ? (
            <div className="cb-form">
              <label className="cb-field">
                Exclusion justification
                <textarea className="cb-input" rows={3} maxLength={JUSTIFICATION_MAX_LENGTH} value={text} onChange={(event) => setText(event.target.value)} />
              </label>
              <div className="cb-actions">
                <button type="button" className="hc-btn primary" disabled={busy} onClick={() => save(text)}>
                  Save justification
                </button>
                {row.justification && (
                  <button type="button" className="hc-btn" disabled={busy} onClick={() => save("")}>
                    Clear
                  </button>
                )}
              </div>
              {error && (
                <p role="alert" className="cb-error">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <p className="cb-empty">Only the Boundary Owner, a Compliance Manager or an Admin can write the justification.</p>
          )}
        </>
      )}
    </div>
  );
}

import type { ControlAssessmentStatus } from "@prisma/client";
import { CONTROL_ASSESSMENT_STATUS_LABEL } from "@/lib/requirement-status-rules";
import { APPLICABILITY_LABEL, type StatementOfApplicabilityRow } from "@/lib/statement-of-applicability-rules";
import type { AuditCover } from "@/lib/soa-audit-export";
import { AutoPrint } from "./AutoPrint";
import "./print.css";

const STATUSES = Object.keys(CONTROL_ASSESSMENT_STATUS_LABEL) as ControlAssessmentStatus[];

/** "2026-10-31 14:05 UTC": fixed zone, so the document reads the same wherever it is opened. */
export function formatGenerated(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The implementation status cell: the Organization's status and/or the System rollup counts; nothing for an excluded Control. */
function StatusCell({ row }: { row: StatementOfApplicabilityRow }) {
  if (!row.included) return <span className="soa-faint">Not applicable (excluded)</span>;
  return (
    <>
      {row.organizationStatus && <div>Organization: {CONTROL_ASSESSMENT_STATUS_LABEL[row.organizationStatus]}</div>}
      {row.systemRollup && (
        <div>
          {row.systemRollup.total === 0
            ? "Systems: none yet"
            : `${plural(row.systemRollup.total, "System")}: ${STATUSES.filter((status) => row.systemRollup!.counts[status] > 0)
                .map((status) => `${row.systemRollup!.counts[status]} ${CONTROL_ASSESSMENT_STATUS_LABEL[status]}`)
                .join(", ")}`}
        </div>
      )}
    </>
  );
}

/**
 * The Statement of Applicability as a document for the print dialog (#273): a cover, then every Control in the
 * page's order. Plain black on white, A4 (`print.css`).
 */
export function PrintStatement({ cover, rows }: { cover: AuditCover; rows: StatementOfApplicabilityRow[] }) {
  return (
    <main className="soa-print">
      <AutoPrint />
      <header className="soa-cover">
        <h1>Statement of Applicability</h1>
        <p className="soa-faint">ISO/IEC 27001:2022 · Clause 6.1.3 d</p>
        <dl>
          {cover.organizationName && (
            <>
              <dt>Organization</dt>
              <dd>{cover.organizationName}</dd>
            </>
          )}
          <dt>Generated</dt>
          <dd>
            {formatGenerated(cover.generatedAt)} by {cover.generatedByName}
          </dd>
          <dt>Frameworks</dt>
          <dd>{cover.frameworks.length > 0 ? cover.frameworks.join("; ") : "None published with mapped Controls"}</dd>
          <dt>Controls</dt>
          <dd>
            {cover.total} in total: {cover.included} included, {cover.excluded} excluded
            {cover.excludedWithoutJustification > 0
              ? `, of which ${cover.excludedWithoutJustification} without a justification`
              : ""}
          </dd>
        </dl>
        <p className="soa-note">
          Generated from live data on {formatGenerated(cover.generatedAt)}. Not an approved or versioned document.
        </p>
      </header>

      <table className="soa-table">
        <thead>
          <tr>
            <th scope="col">Control</th>
            <th scope="col">Included</th>
            <th scope="col">Justification</th>
            <th scope="col">Implementation status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.controlId}>
              <td>
                <strong>{row.code}</strong> {row.title}
                <div className="soa-faint">{APPLICABILITY_LABEL[row.applicability]}</div>
              </td>
              <td>{row.included ? "Included" : "Excluded"}</td>
              <td>
                {row.included ? (
                  row.inclusionJustification || <span className="soa-faint">None</span>
                ) : row.exclusionJustification ? (
                  row.exclusionJustification
                ) : (
                  <strong>Justification missing</strong>
                )}
              </td>
              <td>
                <StatusCell row={row} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4}>The Control Library has no Controls.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}

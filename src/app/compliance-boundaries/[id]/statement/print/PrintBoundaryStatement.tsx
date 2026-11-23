import { frameworkLabel } from "@/lib/framework-label";
import { describeMetOn, STATEMENT_STATUS_LABEL, type BoundaryStatementSection } from "@/lib/boundary-statement-rules";
import type { ExportHeader } from "@/lib/boundary-statement-export";
import { formatCompliancePercentage } from "@/lib/requirement-status-rules";
import { AutoPrint } from "./AutoPrint";
import "./print.css";

/**
 * A Compliance Boundary's Statement of Applicability as a document for the print dialog (#421): a cover with the Boundary, its Owner,
 * the Frameworks, the counted Systems and the date, then one table per Framework. Plain black on white, A4 (`print.css`). Server
 * rendered; the print dialog opens on load.
 */
export function PrintBoundaryStatement({
  header,
  sections,
  organizationName,
  generatedByName,
}: {
  header: ExportHeader;
  sections: BoundaryStatementSection[];
  organizationName: string | null;
  generatedByName: string;
}) {
  const counted = header.countedSystems;
  return (
    <main className="soa-print">
      <AutoPrint />
      <header className="soa-cover">
        <h1>Statement of Applicability</h1>
        <p className="soa-faint">{header.boundaryName}</p>
        <dl>
          {organizationName && (
            <>
              <dt>Organization</dt>
              <dd>{organizationName}</dd>
            </>
          )}
          <dt>Compliance Boundary</dt>
          <dd>{header.boundaryName}</dd>
          <dt>Boundary Owner</dt>
          <dd>{header.ownerName ?? "None"}</dd>
          <dt>{header.scope === "WHOLE" ? "Frameworks" : "Framework"}</dt>
          <dd>{header.frameworks.length > 0 ? header.frameworks.join("; ") : "None"}</dd>
          <dt>Counted Systems</dt>
          <dd>{counted.length > 0 ? `${counted.length}: ${counted.join(", ")}` : "None yet"}</dd>
          {header.notYetOperating.length > 0 && (
            <>
              <dt>Not yet operating</dt>
              <dd>{header.notYetOperating.join(", ")} (not counted)</dd>
            </>
          )}
          <dt>Exported</dt>
          <dd>
            {header.exportedOn} by {generatedByName}
          </dd>
        </dl>
        <p className="soa-note">Generated from live data on {header.exportedOn}. Not an approved or versioned document.</p>
      </header>

      {sections.map((section) => {
        const included = section.rows.filter((row) => row.included).length;
        return (
          <section key={section.framework.id} className="soa-section" aria-label={frameworkLabel(section.framework)}>
            <h2>{frameworkLabel(section.framework)}</h2>
            <p className="soa-faint">
              {included} included, {section.rows.length - included} excluded · {formatCompliancePercentage(section.percentage)}
            </p>
            <table className="soa-table">
              <thead>
                <tr>
                  <th scope="col">Requirement</th>
                  <th scope="col">In the statement</th>
                  <th scope="col">Worst status</th>
                  <th scope="col">Exclusion justification</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.requirementId}>
                    <td>
                      <strong>{row.code}</strong> {row.title}
                    </td>
                    <td>{row.included ? "Included" : "Excluded"}</td>
                    <td>
                      {row.worstStatus ? (
                        <>
                          {STATEMENT_STATUS_LABEL[row.worstStatus]}
                          <div className="soa-faint">{describeMetOn(row)}</div>
                        </>
                      ) : (
                        <span className="soa-faint">-</span>
                      )}
                    </td>
                    <td>{row.included ? <span className="soa-faint">-</span> : row.justification ? row.justification : <strong>Justification missing</strong>}</td>
                  </tr>
                ))}
                {section.rows.length === 0 && (
                  <tr>
                    <td colSpan={4}>This Framework has no Requirements.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}

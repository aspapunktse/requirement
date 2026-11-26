import Link from "next/link";
import type { OscalPackage } from "@/lib/oscal/package-builder";
import { PrintButton } from "./PrintButton";
import { buildReviewModel } from "./review-model";
import "./oscal-review.css";

const dash = "None";

/**
 * A System's OSCAL Package as a document to read and print (#445, PRD #440): one block per implemented requirement with the Control's
 * code, OSCAL id and UUID, the OSCAL implementation status, the app's status, who does the work and the description. Presentational:
 * it renders the package object it is given (from `loadOscalPackage`), nothing else.
 */
export function OscalPackageReview({ pkg, systemId, appNs }: { pkg: OscalPackage; systemId: string; appNs: string }) {
  const model = buildReviewModel(pkg, appNs);
  return (
    <main className="oscal-print">
      <header className="oscal-cover">
        <h1>OSCAL Package review</h1>
        <p className="oscal-faint">{model.systemName}</p>
        <dl>
          <dt>System</dt>
          <dd>{model.systemName}</dd>
          <dt>System state</dt>
          <dd>{model.state}</dd>
          <dt>Generated</dt>
          <dd>
            <time dateTime={model.generatedAt}>{model.generatedAt}</time>
          </dd>
          <dt>Document version</dt>
          <dd>{model.documentVersion}</dd>
          {model.documentId && (
            <>
              <dt>Document id</dt>
              <dd>{model.documentId}</dd>
            </>
          )}
          <dt>Implemented requirements</dt>
          <dd>{model.rows.length}</dd>
        </dl>
        <p className="oscal-screen-only">
          <a className="oscal-link" href={`/api/systems/${systemId}/oscal-package`} download>
            Download this OSCAL Package
          </a>{" "}
          <PrintButton />
        </p>
        <p className="oscal-note">
          Generated from live data, the same package as the download. Framework Requirements that no Control covers are not in it: see the{" "}
          <Link className="oscal-link" href={`/systems/${systemId}#requirements`}>
            System&apos;s Requirements
          </Link>
          .
        </p>
      </header>

      <table className="oscal-table">
        <thead>
          <tr>
            <th scope="col">Control</th>
            <th scope="col">OSCAL identifiers</th>
            <th scope="col">Who does the work, and status</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <tr key={row.requirementUuid}>
              <td>
                <strong>{row.code}</strong>
                {row.title && <div>{row.title}</div>}
              </td>
              <td className="oscal-ids">
                <div>
                  Control id: <code>{row.controlId}</code>
                </div>
                <div>
                  UUID: <code>{row.requirementUuid}</code>
                </div>
                {(row.implementationStatus || row.appStatus) && (
                  <div>
                    OSCAL status: {row.implementationStatus ?? dash}; app status: {row.appStatus ?? dash}
                  </div>
                )}
                {row.effectiveStatus && (
                  <div>
                    Effective status: {row.effectiveStatus}; source: {row.effectiveSource ?? dash}
                    {row.overridesInherited && "; overrides an inherited status"}
                  </div>
                )}
              </td>
              <td>
                {row.entries.length === 0 && <p className="oscal-faint">No component entry.</p>}
                {row.entries.map((entry) => (
                  <div key={entry.componentUuid} className="oscal-entry">
                    <div>
                      <strong>{entry.componentTitle}</strong>
                    </div>
                    <div>
                      OSCAL status: {entry.implementationStatus ?? dash}; app status: {entry.appStatus ?? dash}
                    </div>
                    {entry.customerHalf && <div>Customer half: {entry.customerHalf}</div>}
                    {entry.risk && (
                      <div>
                        Risk: <code>{entry.risk}</code>
                      </div>
                    )}
                    <p>{entry.description}</p>
                    {entry.remarks && <p className="oscal-faint">{entry.remarks}</p>}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

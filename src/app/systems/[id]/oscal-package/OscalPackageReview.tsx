import Link from "next/link";
import type { OscalPackage } from "@/lib/oscal/package-builder";
import { PrintButton } from "./PrintButton";
import { buildReviewModel, type ReviewFinding, type ReviewObservation, type ReviewResult } from "./review-model";
import "./oscal-review.css";

const dash = "None";

const STATE_LABEL: Record<string, string> = { satisfied: "Satisfied", "not-satisfied": "Not satisfied" };

function Observation({ o }: { o: ReviewObservation }) {
  return (
    <div className="oscal-entry">
      <div>
        <strong>{o.title}</strong> <span className="oscal-faint">({o.methods.join(", ")}; collected <time dateTime={o.collected}>{o.collected}</time>{o.origins.length > 0 && `; by ${o.origins.join(", ")}`})</span>
      </div>
      <p>{o.description}</p>
      {o.evidence.length > 0 && (
        <div className="oscal-ids">
          Evidence links: {o.evidence.map((href, i) => (
            <span key={href}>
              {i > 0 && ", "}
              <code>{href}</code>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Finding({ f }: { f: ReviewFinding }) {
  return (
    <tr>
      <td>
        <strong>{f.control?.code ?? f.statementId}</strong>
        {f.control?.title && <div>{f.control.title}</div>}
      </td>
      <td>
        <div>
          <strong>{STATE_LABEL[f.state] ?? f.state}</strong>
          {f.outcome && <> (Check-up outcome: {f.outcome})</>}
        </div>
        <div className="oscal-ids">
          Statement: <code>{f.statementId}</code>
        </div>
        {f.origins.length > 0 && <div className="oscal-faint">Evaluated by {f.origins.join(", ")}</div>}
        <p>{f.description}</p>
        {f.risks.length > 0 && (
          <div className="oscal-ids">
            Related risks: {f.risks.map((u) => <code key={u}>{u}</code>)}
          </div>
        )}
      </td>
      <td>
        {f.observations.length === 0 && <p className="oscal-faint">No observation.</p>}
        {f.observations.map((o) => (
          <Observation key={o.uuid} o={o} />
        ))}
      </td>
    </tr>
  );
}

function ResultSection({ r }: { r: ReviewResult }) {
  return (
    <section className="oscal-assessment-result">
      <h3>{r.title}</h3>
      <p className="oscal-faint">
        <time dateTime={r.start}>{r.start}</time>
        {r.end && (
          <>
            {" to "}
            <time dateTime={r.end}>{r.end}</time>
          </>
        )}
        ; {r.controls.length} Controls reviewed.
      </p>
      <p>{r.description}</p>
      {r.findings.length > 0 && (
        <table className="oscal-table oscal-findings">
          <thead>
            <tr>
              <th scope="col">Control</th>
              <th scope="col">Finding</th>
              <th scope="col">Observations</th>
            </tr>
          </thead>
          <tbody>
            {r.findings.map((f) => (
              <Finding key={f.uuid} f={f} />
            ))}
          </tbody>
        </table>
      )}
      {r.otherObservations.length > 0 && (
        <>
          <h4>{r.findings.length > 0 ? "Other observations" : "Observations"}</h4>
          {r.otherObservations.map((o) => (
            <Observation key={o.uuid} o={o} />
          ))}
        </>
      )}
      {r.risks.length > 0 && (
        <>
          <h4>Risks</h4>
          <ul>
            {r.risks.map((k) => (
              <li key={k.uuid}>
                <strong>{k.title}</strong>: {k.state}
                {k.appStatus && ` (app status ${k.appStatus}${k.source ? `, source ${k.source}` : ""})`}. <code className="oscal-ids">{k.uuid}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

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
          <dt>Internal Audit</dt>
          <dd>{model.assessment ? "Assessment Plan and Assessment Results included" : "No closed Internal Audit: no Assessment Plan or Assessment Results"}</dd>
          <dt>Plan of Action and Milestones</dt>
          <dd>{model.poam ? `${model.poam.items.length} item${model.poam.items.length === 1 ? "" : "s"} (open and accepted Risks)` : "No open or accepted Risk: no Plan of Action and Milestones"}</dd>
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

      {model.assessment?.plan && (
        <section className="oscal-assessment" aria-labelledby="oscal-plan-heading">
          <h2 id="oscal-plan-heading">Assessment Plan</h2>
          <p className="oscal-faint">
            {model.assessment.plan.title}. Imports the System Security Plan <code>{model.assessment.plan.importSsp}</code> of this package; version {model.assessment.plan.version}.
          </p>
          {model.assessment.plan.tasks.map((t) => (
            <p key={t.title}>
              <strong>{t.title}</strong>
              {t.start && t.end && (
                <>
                  : <time dateTime={t.start}>{t.start}</time> to <time dateTime={t.end}>{t.end}</time>
                </>
              )}
              . {t.description}
            </p>
          ))}
          <p>
            Subjects: {model.assessment.plan.subjects.join(", ") || dash}. Controls reviewed: {model.assessment.plan.controls.map((c) => c.code).join(", ") || dash}.
          </p>
          {model.assessment.plan.activities.map((a) => (
            <div key={a.title} className="oscal-entry">
              <strong>{a.title}</strong>
              <ol>
                {a.steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      )}

      {model.assessment?.results && (
        <section className="oscal-assessment" aria-labelledby="oscal-results-heading">
          <h2 id="oscal-results-heading">Assessment Results</h2>
          <p className="oscal-faint">
            {model.assessment.results.title}. Imports the Assessment Plan <code>{model.assessment.results.importAp}</code>; version {model.assessment.results.version}.
          </p>
          {model.assessment.results.results.map((r) => (
            <ResultSection key={r.uuid} r={r} />
          ))}
        </section>
      )}

      {model.poam && (
        <section className="oscal-assessment" aria-labelledby="oscal-poam-heading">
          <h2 id="oscal-poam-heading">Plan of Action and Milestones</h2>
          <p className="oscal-faint">
            {model.poam.title}. Imports the System Security Plan <code>{model.poam.importSsp}</code> of this package; version {model.poam.version}. Items are the System&apos;s open and accepted Risks.
          </p>
          {model.poam.items.map((item) => (
            <div key={item.uuid} className="oscal-entry">
              <div>
                <strong>{item.title}</strong>{" "}
                <span className="oscal-faint">
                  ({item.appStatus ?? item.state}; deadline {item.deadline ?? "not set"}
                  {item.lifecycle ? `; remediation ${item.lifecycle}` : ""})
                </span>
              </div>
              <p>{item.description}</p>
              {item.findings.length > 0 && <div className="oscal-ids">Check-up findings: {item.findings.join(", ")}</div>}
              {item.milestones.length > 0 && (
                <ul>
                  {item.milestones.map((m, i) => (
                    <li key={i}>
                      {m.title}: planned {m.planned}
                      {m.completed ? `, completed ${m.completed}` : ", not completed"}
                    </li>
                  ))}
                </ul>
              )}
              {item.log.length > 0 && (
                <ol aria-label={`Status history of ${item.title}`}>
                  {item.log.map((e, i) => (
                    <li key={i}>
                      <time dateTime={e.start}>{e.start}</time>: {e.title}
                      {e.by ? ` (by ${e.by})` : ""}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

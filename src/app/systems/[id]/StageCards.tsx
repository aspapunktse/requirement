"use client";

import { useCallback } from "react";
import type { DocumentationStage, EvaluationTrack } from "@prisma/client";
import { StatusChip } from "@/components/ui/StatusChip";
import type { Risk } from "@/components/RiskList";
import { STAGE_LABEL } from "@/lib/document-requirement";
import { appliesToTrack, type SystemDocumentRow } from "@/lib/system-documentation";
import type { RiskAnalysisView } from "@/lib/risk-analysis";
import { RISK_SOURCES, RISK_SOURCE_LABELS } from "@/lib/risk-source";
import { formatFileSize } from "@/lib/system-document-file";
import { riskSeverityTone } from "@/lib/status-tones";
import { SEVERITY_TEXT } from "./RiskGrid";
import { formatDay } from "./system-page-logic";
import { writeHash } from "./system-hash";
import { useRemote } from "./use-remote";

/**
 * Read-only parts of a System's stage cards on the Evaluation tab (#348, design proposal A): a stage's Document Requirements
 * with their status, the recorded Risk Analysis and the Risk summary. They read the same routes as the Documentation and Risks
 * tabs and change nothing, so a stage card (the second round, Qualification, OG2, OG3) can drop one in by its stage key.
 */

const SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const SEVERITY_COLOUR: Record<(typeof SEVERITIES)[number], string> = {
  CRITICAL: "var(--rg-danger)",
  HIGH: "var(--rg-gold)",
  MEDIUM: "var(--rg-accent)",
  LOW: "var(--rg-line)",
};

/** A link to another tab of the System page (the card says what is there; the editing stays on that tab). */
function TabLink({ tab, children }: { tab: "documentation" | "risks"; children: React.ReactNode }) {
  return (
    <button type="button" className="sc-link" onClick={() => writeHash(`#${tab}`)}>
      {children}
    </button>
  );
}

/**
 * The Document Requirements of one stage that apply to the System's Track (all of them while it has none), each Provided or
 * Missing with its link or file. The owner or an Admin sets them on the Documentation tab, which this points to.
 */
export function StageDocumentation({ systemId, stage, track }: { systemId: string; stage: DocumentationStage; track: EvaluationTrack | null }) {
  const read = useCallback(async () => {
    const response = await fetch(`/api/systems/${systemId}/documents`);
    if (!response.ok) throw new Error("Failed to load the documentation");
    const body = await response.json();
    return { documents: (body.documents ?? []) as SystemDocumentRow[], canEdit: !!body.canEdit };
  }, [systemId]);
  const { data, failed, reload } = useRemote(read);
  const rows = data ? data.documents.filter((document) => document.stage === stage && appliesToTrack(document, track)) : [];
  const provided = rows.filter((document) => document.provided).length;

  return (
    <div className="ev-part" aria-label={`${STAGE_LABEL[stage]} documentation`} role="group">
      <div className="ev-part-h">
        <h3>{stage === "SECOND_ROUND" ? "Second-round documentation" : "Document Requirements"}</h3>
        {rows.length > 0 && (
          <span className="ev-hint">
            {provided} of {rows.length} provided
          </span>
        )}
      </div>
      {failed && (
        <p role="alert" className="sc-err">
          Couldn&apos;t load the documentation.{" "}
          <button type="button" className="sc-link" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {data === null ? (
        !failed && (
          <p role="status" className="hc-empty">
            Loading documentation…
          </p>
        )
      ) : rows.length === 0 ? (
        <p className="hc-empty">No Document Requirements apply at this stage.</p>
      ) : (
        <ul className="ev-docs" aria-label={`${STAGE_LABEL[stage]} Document Requirements`}>
          {rows.map((document) => (
            <li key={document.id} className={document.provided ? "ok" : "miss"}>
              <span className="mark" aria-hidden="true">
                {document.provided ? "✓" : "○"}
              </span>
              <div className="ev-doc-text">
                <b>{document.name}</b>
                {document.link && (
                  <a className="sc-link" href={document.link} target="_blank" rel="noopener noreferrer">
                    {document.link}
                  </a>
                )}
                {document.file && (
                  <a className="sc-link" href={`/api/systems/${systemId}/documents/${document.id}/file`}>
                    {document.file.fileName} ({formatFileSize(document.file.size)})
                  </a>
                )}
                {document.provided ? (
                  <small>
                    Provided{document.updatedBy ? ` by ${document.updatedBy.name}` : ""}
                    {document.updatedAt ? `, ${formatDay(document.updatedAt)}` : ""}
                  </small>
                ) : (
                  <small>Not provided yet.</small>
                )}
              </div>
              <StatusChip tone={document.provided ? "success" : "warn"}>{document.provided ? "Provided" : "Missing"}</StatusChip>
            </li>
          ))}
        </ul>
      )}
      {data?.canEdit && rows.length > 0 && (
        <p className="ev-hint">
          Add a link or a file on the <TabLink tab="documentation">Documentation tab</TabLink>.
        </p>
      )}
    </div>
  );
}

/**
 * The System's latest recorded Risk Analysis, read-only: date, who took part, notes, the Risks reviewed and raised, and whether
 * every open Risk has a Risk owner. Recording one stays on the Risks tab, which the empty state points to.
 */
export function RiskAnalysisRecord({ systemId }: { systemId: string }) {
  const read = useCallback(async (): Promise<RiskAnalysisView[]> => {
    const response = await fetch(`/api/systems/${systemId}/risk-analyses`);
    if (!response.ok) throw new Error("Failed to load the Risk Analyses");
    return (await response.json()).riskAnalyses ?? [];
  }, [systemId]);
  const { data, failed, reload } = useRemote(read);
  const latest = data?.[0] ?? null;

  return (
    <div className="ev-part" role="group" aria-label="Risk Analysis record">
      {failed && (
        <p role="alert" className="sc-err">
          Couldn&apos;t load the Risk Analysis.{" "}
          <button type="button" className="sc-link" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {data === null ? (
        !failed && (
          <p role="status" className="hc-empty">
            Loading the Risk Analysis…
          </p>
        )
      ) : !latest ? (
        <div className="hc-empty">
          <p>
            <b>No Risk Analysis recorded yet.</b>
          </p>
          <p>
            A Risk Owner, or an Admin who isn&apos;t the System&apos;s owner, records the meeting on the <TabLink tab="risks">Risks tab</TabLink>.
          </p>
        </div>
      ) : (
        <RecordBody analysis={latest} earlier={data.length - 1} />
      )}
    </div>
  );
}

function RecordBody({ analysis, earlier }: { analysis: RiskAnalysisView; earlier: number }) {
  const completed = analysis.completedAt !== null;
  const people = [...analysis.participants.map((person) => person.name), ...analysis.outsiders];
  const risks = [...analysis.reviewedRisks.map((risk) => ({ risk, how: "Reviewed" })), ...analysis.raisedRisks.map((risk) => ({ risk, how: "Raised" }))];
  const withoutOwner = risks.filter(({ risk }) => risk.status === "OPEN" && risk.ownerId === null).length;
  return (
    <div className="ev-ra">
      <div className="ev-vrow">
        <b>{formatDay(analysis.heldOn)}</b>
        <StatusChip tone={completed ? "success" : "warn"}>{completed ? "Completed" : "In progress"}</StatusChip>
      </div>
      <dl className="ev-kv">
        <dt>Participants</dt>
        <dd>{people.length > 0 ? people.join(", ") : "None recorded"}</dd>
        <dt>Recorded by</dt>
        <dd>{analysis.recordedBy?.name ?? "Unknown"}</dd>
        {analysis.notes !== "" && (
          <>
            <dt>Notes</dt>
            <dd>{analysis.notes}</dd>
          </>
        )}
      </dl>
      {risks.length === 0 ? (
        <p className="ev-hint">No Risks were reviewed or raised.</p>
      ) : (
        <ul className="ev-ra-risks" aria-label="Risks in this analysis">
          {risks.map(({ risk, how }) => (
            <li key={`${how}-${risk.id}`}>
              <b>{risk.title}</b>
              <StatusChip tone={riskSeverityTone(risk.severity)}>{SEVERITY_TEXT[risk.severity] ?? risk.severity}</StatusChip>
              <span className="ev-hint">{how}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={`ev-ra-done ${withoutOwner > 0 ? "warn" : "ok"}`}>
        {withoutOwner > 0 ? `Not done: ${withoutOwner} open ${withoutOwner === 1 ? "Risk" : "Risks"} without a Risk owner.` : "✓ Every open Risk here has a Risk owner."}
      </p>
      {earlier > 0 && (
        <p className="ev-hint">
          {earlier} earlier {earlier === 1 ? "analysis is" : "analyses are"} on the <TabLink tab="risks">Risks tab</TabLink>.
        </p>
      )}
    </div>
  );
}

/** Open Risks by severity (a bar and a key) and by Risk Source and severity (a table), as the Business System Owner weighs them. */
export function RiskSummary({ systemId }: { systemId: string }) {
  const read = useCallback(async (): Promise<Risk[]> => {
    const response = await fetch(`/api/systems/${systemId}/risks`);
    if (!response.ok) throw new Error("Failed to load the Risks");
    return (await response.json()).risks ?? [];
  }, [systemId]);
  const { data, failed, reload } = useRemote(read);
  const open = (data ?? []).filter((risk) => risk.status === "OPEN");
  const count = (severity?: string, source?: string) => open.filter((risk) => (!severity || risk.severity === severity) && (!source || risk.source === source)).length;
  const withoutOwner = open.filter((risk) => !risk.ownerId && !risk.owner).length;

  return (
    <section className="hc-card ev-card" aria-labelledby="ev-rsum-h">
      <div className="hc-card-h">
        <h2 id="ev-rsum-h">Risk summary</h2>
        {data && (
          <p>
            {open.length} open {open.length === 1 ? "Risk" : "Risks"}
            {withoutOwner > 0 ? ` · ${withoutOwner} without a Risk owner` : ""}
          </p>
        )}
      </div>
      <div className="hc-card-b">
        {failed && (
          <p role="alert" className="sc-err">
            Couldn&apos;t load the Risks.{" "}
            <button type="button" className="sc-link" onClick={reload}>
              Try again
            </button>
          </p>
        )}
        {data === null ? (
          !failed && (
            <p role="status" className="hc-empty">
              Loading the Risks…
            </p>
          )
        ) : open.length === 0 ? (
          <p className="hc-empty">No open Risks.</p>
        ) : (
          <div className="ev-rsum">
            <div className="ev-sevbar" role="img" aria-label="Open Risks by severity">
              {SEVERITIES.map((severity) => {
                const n = count(severity);
                return n > 0 ? <i key={severity} style={{ flex: n, background: SEVERITY_COLOUR[severity] }} title={`${SEVERITY_TEXT[severity]}: ${n}`} /> : null;
              })}
            </div>
            <ul className="ev-sevkey" aria-label="Open Risks by severity">
              {SEVERITIES.map((severity) => (
                <li key={severity}>
                  <i style={{ background: SEVERITY_COLOUR[severity] }} aria-hidden="true" />
                  {SEVERITY_TEXT[severity]} <b>{count(severity)}</b>
                </li>
              ))}
            </ul>
            <div className="ev-tscroll">
              <table className="ev-rmat">
                <caption className="sr-only">Open Risks by Risk Source and severity</caption>
                <thead>
                  <tr>
                    <th scope="col">Risk Source</th>
                    {SEVERITIES.map((severity) => (
                      <th key={severity} scope="col">
                        {SEVERITY_TEXT[severity]}
                      </th>
                    ))}
                    <th scope="col">All</th>
                  </tr>
                </thead>
                <tbody>
                  {RISK_SOURCES.map((source) => (
                    <tr key={source}>
                      <th scope="row">{RISK_SOURCE_LABELS[source]}</th>
                      {SEVERITIES.map((severity) => (
                        <td key={severity} className={count(severity, source) > 0 ? "has" : ""}>
                          {count(severity, source) || "·"}
                        </td>
                      ))}
                      <td className="tot">{count(undefined, source)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="ev-hint">Open Risks never block a gate. The Business System Owner weighs them.</p>
      </div>
    </section>
  );
}

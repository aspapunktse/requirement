import Link from "next/link";
import "@/app/home/home.css";
import "../audits-list.css";
import "./audit-detail.css";
import { Ring } from "@/app/home/HomeGraphics";
import { DeleteInternalAuditButton } from "@/components/DeleteInternalAuditButton";
import { DraftQuestionsEditor } from "@/components/DraftQuestionsEditor";
import { internalAuditNotes } from "@/lib/internal-audit-rules";
import type { InternalAuditPage } from "@/lib/internal-audit-detail";
import { plural } from "../check-up-state-view";
import { AuditHero } from "./AuditHero";
import { LaunchAuditButton } from "./AuditActions";

const APPLICABILITY_LABEL = { PER_SYSTEM: "Per System", BOTH: "Both", ORGANIZATIONAL: "Organizational" } as const;
const MAX_RECIPIENTS = 6;

/**
 * A draft Internal Audit's read view (#399): its Controls with their questions and where they are checked (Systems and
 * the Organization), beside "If launched now", which is the server's launch preview (`previewAuditPlanOn`, the same
 * `planLaunch` the launch runs): the Check-ups it would send, what blocks it and who would receive them. An Internal
 * Auditor can Edit (the planner), Delete and Launch (disabled while anything blocks it) and write each Control's
 * questions here. Nothing in it is a client copy of the launch rules.
 */
export function DraftAudit({ page, canWrite }: { page: InternalAuditPage; canWrite: boolean }) {
  const { audit, plan } = page;
  const total = (plan?.systemCheckUpCount ?? 0) + (plan?.organizationCheckUpCount ?? 0);
  const ringTotal = Math.max(1, total + (plan?.skippedCount ?? 0));
  const blockers = plan?.blockers ?? [];
  const recipients = plan?.recipients ?? [];
  const notes = internalAuditNotes({ includeOrganization: audit.includeOrganization, systemCount: audit.systems.length, controls: audit.controls });

  return (
    <div className="hc ad" data-page-id="INTERNAL AUDIT">
      <AuditHero
        audit={audit}
        daysUntilDue={page.daysUntilDue}
        actions={
          canWrite && plan ? (
            <>
              <Link href={`/internal-audits/${audit.id}/edit`} className="hc-btn">
                Edit
              </Link>
              <DeleteInternalAuditButton id={audit.id} title={audit.title} />
              <LaunchAuditButton internalAuditId={audit.id} title={audit.title} summary={plan.summary} blockers={blockers.map((blocker) => blocker.message)} />
            </>
          ) : undefined
        }
      />

      {notes.length > 0 && (
        <ul role="note" className="ad-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <div className="ad-grid">
        <div className="ad-stack">
          <section className="hc-card" aria-label="Controls and questions">
            <div className="hc-card-h">
              <h2>Controls and questions</h2>
              <p>{plural(audit.controls.length, "Control")} · each Check-up carries a copy of its Control&apos;s questions</p>
            </div>
            <div className="hc-card-b ad-controls">
              {audit.controls.length === 0 && <p className="hc-empty">No Controls. Edit the draft to pick some.</p>}
              {audit.controls.map((control) => (
                <div key={control.id} className="ad-control">
                  <span className="ad-code">{control.code}</span>
                  <div>
                    <b>{control.title}</b>
                    {canWrite ? (
                      <DraftQuestionsEditor
                        internalAuditId={audit.id}
                        control={control}
                        initialQuestions={control.questions}
                        bank={page.auditQuestions[control.id] ?? []}
                      />
                    ) : control.questions.length === 0 ? (
                      <small className="bad">No question yet: one must be written before launch</small>
                    ) : (
                      <ol className="ad-questions">
                        {control.questions.map((question, index) => (
                          <li key={index}>{question}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <span className="ad-appl">{APPLICABILITY_LABEL[control.applicability]}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="hc-card" aria-label="Where">
            <div className="hc-card-h">
              <h2>Where</h2>
              <p>
                {plural(audit.systems.length, "System")}
                {audit.includeOrganization ? " and the Organization" : ""}
              </p>
            </div>
            <div className="hc-card-b ad-where">
              {audit.systems.length === 0 && !audit.includeOrganization && <span className="hc-empty">No Systems picked.</span>}
              {audit.systems.map((system) => (
                <Link key={system.id} href={`/systems/${system.id}`} className="ad-chip">
                  {system.name}
                </Link>
              ))}
              {audit.includeOrganization && <span className="ad-chip org">Organization Control Implementations</span>}
            </div>
          </section>
        </div>

        <aside className="hc-card ad-aside" aria-label="If launched now">
          <div className="hc-card-h">
            <h2>If launched now</h2>
            <p>read from the server</p>
          </div>
          <div className="hc-card-b ad-preview">
            <div className="ad-prevring">
              <Ring
                segments={[
                  [(plan?.systemCheckUpCount ?? 0) / ringTotal, "var(--rg-accent)"],
                  [(plan?.organizationCheckUpCount ?? 0) / ringTotal, "var(--rg-gold)"],
                  [(plan?.skippedCount ?? 0) / ringTotal, "var(--rg-line)"],
                ]}
                size={108}
                stroke={11}
                center={String(total)}
                sub="Check-ups"
                label={`Launching sends ${plural(total, "Check-up")}`}
              />
              <ul aria-label="Check-ups it would send">
                <li>
                  <i style={{ background: "var(--rg-accent)" }} aria-hidden="true" />
                  <b>{plan?.systemCheckUpCount ?? 0}</b> System-level
                </li>
                <li>
                  <i style={{ background: "var(--rg-gold)" }} aria-hidden="true" />
                  <b>{plan?.organizationCheckUpCount ?? 0}</b> Organization-level
                </li>
                <li>
                  <i style={{ background: "var(--rg-line)" }} aria-hidden="true" />
                  <b>{plan?.skippedCount ?? 0}</b> skipped {plan?.skippedCount === 1 ? "pair" : "pairs"}
                </li>
              </ul>
            </div>

            <div>
              <div className="ad-label">Before it can launch</div>
              <ul className="ad-ready" aria-label="Launch blockers">
                {blockers.length > 0 ? (
                  blockers.map((blocker) => (
                    <li key={blocker.message} className="warn">
                      {blocker.message}
                    </li>
                  ))
                ) : (
                  <li className="ok">Nothing blocks the launch{plan ? `: launching sends ${plan.summary}` : ""}</li>
                )}
              </ul>
            </div>

            <div>
              <div className="ad-label">Who receives Check-ups · {recipients.length}</div>
              {recipients.length === 0 ? (
                <p className="ad-sub">Nobody yet.</p>
              ) : (
                <ul className="ad-recipients" aria-label="Recipients">
                  {recipients.slice(0, MAX_RECIPIENTS).map((recipient) => (
                    <li key={recipient.id}>
                      <span className="nm">
                        {recipient.name}
                        <small>
                          {recipient.roles.join(" · ")}
                          {recipient.alreadyOpen > 0 ? ` · ${recipient.alreadyOpen} open already` : ""}
                        </small>
                      </span>
                      <b>{recipient.fromThisAudit}</b>
                    </li>
                  ))}
                  {recipients.length > MAX_RECIPIENTS && <li className="more">and {recipients.length - MAX_RECIPIENTS} more</li>}
                </ul>
              )}
            </div>
            {plan && plan.skipped.length > 0 && (
              <details className="ad-sub">
                <summary>{plan.skippedCount} skipped: the Control doesn&apos;t apply to the System</summary>
                <ul>
                  {plan.skipped.map(({ control, systems }) => (
                    <li key={control.id}>
                      <b>{control.code}</b> is skipped for {systems.map((system) => system.name).join(", ")}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

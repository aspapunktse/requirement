import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import {
  canReadInternalAudits,
  canWriteInternalAudits,
  INTERNAL_AUDIT_STATUS_LABEL,
  internalAuditEditRefusal,
  internalAuditNotes,
} from "@/lib/internal-audit-rules";
import { getInternalAudit } from "@/lib/internal-audits";
import { getLaunchPreview, listCheckUps } from "@/lib/check-ups";
import { checkUpProgress } from "@/lib/check-up-response-rules";
import { CHECK_UP_OUTCOME_LABEL, canEvaluateCheckUps } from "@/lib/check-up-evaluation-rules";
import { canWithdrawCheckUps } from "@/lib/check-up-withdrawal-rules";
import { canCloseInternalAudits, describeUnfinishedCheckUp, unfinishedCheckUps } from "@/lib/internal-audit-close-rules";
import { checkUpOutcomeTone, internalAuditStatusTone } from "@/lib/status-tones";
import { buttonClassName } from "@/components/ui/Button";
import { StatusChip } from "@/components/ui/StatusChip";
import { DeleteInternalAuditButton } from "@/components/DeleteInternalAuditButton";
import { DraftQuestionsEditor } from "@/components/DraftQuestionsEditor";
import { LaunchInternalAuditPanel } from "@/components/LaunchInternalAuditPanel";
import { CloseInternalAuditPanel } from "@/components/CloseInternalAuditPanel";
import { WithdrawCheckUpControl } from "@/components/WithdrawCheckUpControl";

/**
 * One Internal Audit (PRD 0001 F-IA.1-F-IA.3, #152, #154): everything on it, with notes where a half
 * of it would audit nothing. While it is a draft, an Internal Auditor can edit it, write each
 * Control's questions, delete it and launch it, with a preview of what launching creates and
 * what blocks it. Once launched it is read-only and lists the Check-ups it generated, with
 * their current recipient (derived on every read: it follows a change of owner), with the audit's
 * progress (sent, answered, evaluated, overdue; #155, #156) and each Check-up's state, linked to its
 * response and, for an Internal Auditor, to the evaluation form, with a shortcut to the next answered
 * Check-up that still awaits one. A launched audit also shows, to its readers, which Check-ups are still
 * neither evaluated nor withdrawn, and an Internal Auditor can withdraw each of them (with a reason) and
 * close the audit once none is left (#158). A closed audit is read-only: it shows who closed it and when,
 * and offers no action at all.
 */
export default async function InternalAuditPage({ params }: PageProps<"/internal-audits/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  if (!canReadInternalAudits(user)) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Internal Audits are not available to your role.</p>;
  }

  const audit = await getInternalAudit(id);

  if (!audit) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Internal Audit not found.</p>;
  }

  const canEdit = canWriteInternalAudits(user) && internalAuditEditRefusal(audit.status) === null;
  const isDraft = audit.status === "DRAFT";
  const [preview, checkUps] = await Promise.all([isDraft ? getLaunchPreview(audit.id) : null, isDraft ? [] : listCheckUps(audit.id)]);
  const progress = checkUpProgress(checkUps);
  const nextToEvaluate =
    canEvaluateCheckUps(user) && audit.status === "LAUNCHED" ? checkUps.find((c) => c.answered && !c.evaluated && !c.withdrawn) : undefined;
  const isLaunched = audit.status === "LAUNCHED";
  const canWithdraw = isLaunched && canWithdrawCheckUps(user);
  const unfinished = unfinishedCheckUps(
    checkUps.map((c) => ({
      id: c.id,
      controlCode: c.control.code,
      systemName: c.target.kind === "system" ? c.target.name : null,
      evaluated: c.evaluated,
      withdrawn: c.withdrawn,
    })),
  ).map(describeUnfinishedCheckUp);
  const notes = internalAuditNotes({
    includeOrganization: audit.includeOrganization,
    systemCount: audit.systems.length,
    controls: audit.controls,
  });

  return (
    <div className="mx-auto max-w-4xl p-6">
      <p className="mb-2 text-sm">
        <Link className="underline" href="/internal-audits">
          Internal Audits
        </Link>
      </p>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 text-2xl">{audit.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
            <StatusChip tone={internalAuditStatusTone(audit.status)}>{INTERNAL_AUDIT_STATUS_LABEL[audit.status]}</StatusChip>
            <span>Due {audit.dueDate}</span>
            <span>Created by {audit.createdBy.name}</span>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-start gap-2">
            <Link href={`/internal-audits/${audit.id}/edit`} className={buttonClassName("secondary")}>
              Edit
            </Link>
            <DeleteInternalAuditButton id={audit.id} title={audit.title} />
          </div>
        )}
      </div>

      {isDraft && (
        <p className="mb-4 text-sm text-zinc-500">This is a draft: nothing has been sent to anyone, and no Check-up exists.</p>
      )}
      {audit.launchedAt && (
        <p className="mb-4 text-sm text-zinc-500">
          Launched {audit.launchedAt.slice(0, 10)}
          {audit.launchedBy ? ` by ${audit.launchedBy.name}` : ""}. Its Controls, Systems and questions can no longer be changed.
        </p>
      )}

      {audit.closedAt && (
        <p className="mb-4 text-sm text-zinc-500">
          Closed {audit.closedAt.slice(0, 10)}
          {audit.closedBy ? ` by ${audit.closedBy.name}` : ""}. The audit, its Check-ups, responses, evaluations and withdrawals are read-only for everyone.
        </p>
      )}

      {(isDraft || isLaunched) && (
        <LaunchInternalAuditPanel internalAuditId={audit.id} title={audit.title} preview={preview} canLaunch={canEdit} />
      )}

      {isLaunched && (
        <CloseInternalAuditPanel internalAuditId={audit.id} title={audit.title} unfinished={unfinished} canClose={canCloseInternalAudits(user)} />
      )}

      {notes.length > 0 && (
        <ul role="note" className="mb-4 list-disc rounded border border-ems-warn pl-8 pr-3 py-2 text-sm">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <section className="mb-6">
        <h2 className="mb-1 text-lg">Scope</h2>
        <p className="text-sm">{audit.scopeDescription || <span className="text-zinc-500">No scope description.</span>}</p>
      </section>

      <section className="mb-6">
        <h2 className="mb-1 text-lg">Controls ({audit.controls.length})</h2>
        {audit.controls.length === 0 ? (
          <p className="text-sm text-zinc-500">No Controls. Edit the draft to pick some.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {audit.controls.map((control) => (
              <li key={control.id}>
                <span className="font-medium">{control.code}</span> {control.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      {isDraft && audit.controls.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-1 text-lg">Questions</h2>
          <p className="mb-2 text-sm text-zinc-500">
            Each Check-up carries a copy of its Control&apos;s questions. A Control starts with its Self-Assessment Question as it was
            when the Control was added to this draft (later edits to the Control don&apos;t change it); a Control without one needs a question
            written before launch.
          </p>
          <ul className="flex flex-col gap-4">
            {audit.controls.map((control) => (
              <li key={control.id}>
                <h3 className="mb-1 text-sm font-medium">
                  {control.code} {control.title}
                </h3>
                {canEdit ? (
                  <DraftQuestionsEditor internalAuditId={audit.id} control={control} initialQuestions={control.questions} />
                ) : control.questions.length === 0 ? (
                  <p className="text-sm text-zinc-500">No question yet.</p>
                ) : (
                  <ol className="list-decimal pl-6 text-sm">
                    {control.questions.map((question, index) => (
                      <li key={index}>{question}</li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!isDraft && (
        <section className="mb-6">
          <h2 className="mb-1 text-lg">Check-ups ({checkUps.length} sent)</h2>
          <p className="mb-2 text-sm text-zinc-500" data-testid="check-up-progress">
            {progress.sent} sent, {progress.answered} answered, {progress.evaluated} evaluated, {progress.withdrawn} withdrawn, {progress.overdue} overdue
          </p>
          {progress.awaitingEvaluation > 0 && (
            <p className="mb-2 text-sm text-zinc-500" data-testid="check-up-awaiting-evaluation">
              {progress.awaitingEvaluation} awaiting evaluation.{" "}
              {nextToEvaluate && (
                <Link className="underline" href={`/check-ups/${nextToEvaluate.id}`}>
                  Evaluate the next one
                </Link>
              )}
            </p>
          )}
          {checkUps.length === 0 ? (
            <p className="text-sm text-zinc-500">No Check-ups.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4 font-medium">Control</th>
                  <th className="py-2 pr-4 font-medium">Target</th>
                  <th className="py-2 pr-4 font-medium">Recipient</th>
                  <th className="py-2 pr-4 font-medium">Response</th>
                  <th className="py-2 pr-4 font-medium">Evaluation</th>
                  <th className="py-2 font-medium">Questions</th>
                </tr>
              </thead>
              <tbody>
                {checkUps.map((checkUp) => (
                  <tr key={checkUp.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                    <td className="py-2 pr-4">
                      <span className="font-medium">{checkUp.control.code}</span> {checkUp.control.title}
                    </td>
                    <td className="py-2 pr-4">
                      {checkUp.target.kind === "system" ? (
                        <Link className="underline" href={`/systems/${checkUp.target.id}`}>
                          {checkUp.target.name}
                        </Link>
                      ) : (
                        "Organization"
                      )}
                    </td>
                    <td className="py-2 pr-4">{checkUp.recipient ? checkUp.recipient.name : <span className="text-zinc-500">No Control Owner</span>}</td>
                    <td className="py-2 pr-4">
                      <Link className="underline" href={`/check-ups/${checkUp.id}`}>
                        {checkUp.answered ? "Answered: read the response" : "Not answered"}
                      </Link>
                      {checkUp.response && (
                        <p className="text-zinc-500">
                          {checkUp.response.respondedByName}, {checkUp.response.respondedAt.slice(0, 10)}
                        </p>
                      )}
                      {checkUp.overdue && <StatusChip tone="danger">Overdue</StatusChip>}
                    </td>
                    <td className="py-2 pr-4">
                      {checkUp.withdrawal ? (
                        <>
                          <StatusChip tone="neutral">Withdrawn</StatusChip>
                          <p className="text-zinc-500">
                            {checkUp.withdrawal.withdrawnByName}, {checkUp.withdrawal.withdrawnAt.slice(0, 10)}
                          </p>
                          <p className="whitespace-pre-wrap">{checkUp.withdrawal.reason}</p>
                        </>
                      ) : checkUp.evaluation ? (
                        <>
                          <StatusChip tone={checkUpOutcomeTone(checkUp.evaluation.outcome)}>{CHECK_UP_OUTCOME_LABEL[checkUp.evaluation.outcome]}</StatusChip>
                          <p className="text-zinc-500">
                            {checkUp.evaluation.evaluatedByName}, {checkUp.evaluation.evaluatedAt.slice(0, 10)}
                          </p>
                        </>
                      ) : checkUp.answered ? (
                        <Link className="underline" href={`/check-ups/${checkUp.id}`}>
                          Awaiting evaluation
                        </Link>
                      ) : (
                        <span className="text-zinc-500">-</span>
                      )}
                      {canWithdraw && !checkUp.evaluated && !checkUp.withdrawn && (
                        <div className="mt-1">
                          <WithdrawCheckUpControl checkUpId={checkUp.id} />
                        </div>
                      )}
                    </td>
                    <td className="py-2">
                      <details>
                        <summary className="cursor-pointer">{checkUp.questions.length === 1 ? "1 question" : `${checkUp.questions.length} questions`}</summary>
                        <ol className="list-decimal pl-5">
                          {checkUp.questions.map((question, index) => (
                            <li key={index}>{question}</li>
                          ))}
                        </ol>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-1 text-lg">Systems ({audit.systems.length})</h2>
        {audit.systems.length === 0 ? (
          <p className="text-sm text-zinc-500">No Systems picked.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {audit.systems.map((system) => (
              <li key={system.id}>
                <Link className="underline" href={`/systems/${system.id}`}>
                  {system.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg">Organization</h2>
        <p className="text-sm">
          {audit.includeOrganization
            ? "The Organization Control Implementations of the target Controls are included."
            : "The Organization Control Implementations are not included."}
        </p>
      </section>
    </div>
  );
}

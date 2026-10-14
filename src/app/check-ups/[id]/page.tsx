import Link from "next/link";
import { getActingUser } from "@/lib/acting-user";
import { checkUpAccess, getCheckUpDetail } from "@/lib/check-up-responses";
import { CHECK_UP_ANSWER_LABEL, checkUpResponseRefusal, safeHttpUrl } from "@/lib/check-up-response-rules";
import { CHECK_UP_OUTCOME_LABEL } from "@/lib/check-up-evaluation-rules";
import { canReadInternalAudits, INTERNAL_AUDIT_STATUS_LABEL } from "@/lib/internal-audit-rules";
import { canReadOrganizationRisks, ORGANIZATION_RISKS_HREF } from "@/lib/risks";
import { checkUpOutcomeTone, riskStatusTone } from "@/lib/status-tones";
import { StatusChip } from "@/components/ui/StatusChip";
import { CheckUpResponseForm } from "@/components/CheckUpResponseForm";
import { CheckUpEvaluationForm } from "@/components/CheckUpEvaluationForm";
import { WithdrawCheckUpControl } from "@/components/WithdrawCheckUpControl";

/**
 * One Check-up (PRD 0001 F-IA.4, F-IA.5, #155): the Control, the target, the audit's title and due
 * date and the questions. Its recipient (whoever owns the target now) answers here, and changes
 * the answer until the Check-up can no longer be changed; the roles that read Internal Audits see
 * the same page read-only, with the response. An Internal Auditor evaluates an answered Check-up
 * here, beneath the response (#156); once evaluated, everyone who can read the Check-up sees the
 * outcome, the comment, who evaluated and when, and the response is read-only for its recipient too.
 * A Nonconformity's Risk (#157) is shown beneath it to the roles that read Internal Audits, with what
 * the evaluation did to the target (set back, or why not), linked to where the Risk is managed.
 * Anyone else sees nothing, and not whether the
 * Check-up exists. A Check-up an Internal Auditor withdrew (#158) shows the reason, who withdrew it and when,
 * and is read-only for everyone; an Internal Auditor can withdraw an unevaluated one from here, with a reason.
 * The recipient needs no right to read Internal Audits: this page shows their
 * Check-up, not the audit.
 */
export default async function CheckUpPage({ params }: PageProps<"/check-ups/[id]">) {
  const { id } = await params;
  const user = await getActingUser();

  if (!user) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">Pick a user to act as first.</p>;
  }

  const checkUp = await getCheckUpDetail(id);
  const access = checkUp ? checkUpAccess(user, checkUp) : null;
  if (!checkUp || !access?.canRead) {
    return <p className="p-6 text-zinc-600 dark:text-zinc-400">This Check-up is not available to you.</p>;
  }

  const isRecipient = checkUp.recipient?.id === user.id;
  const lockedReason = checkUpResponseRefusal({ auditStatus: checkUp.audit.status, evaluated: checkUp.evaluated, withdrawn: checkUp.withdrawn });
  const changedLater = checkUp.response !== null && checkUp.response.updatedAt !== checkUp.response.respondedAt;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <p className="mb-2 flex gap-4 text-sm">
        {isRecipient && (
          <Link className="underline" href="/check-ups">
            Your Check-ups
          </Link>
        )}
        {canReadInternalAudits(user) && (
          <Link className="underline" href={`/internal-audits/${checkUp.audit.id}`}>
            {checkUp.audit.title}
          </Link>
        )}
      </p>

      <h1 className="mb-2 text-2xl">
        {checkUp.control.code} {checkUp.control.title}
      </h1>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
        {checkUp.withdrawal ? (
          <StatusChip tone="neutral">Withdrawn</StatusChip>
        ) : checkUp.evaluation ? (
          <StatusChip tone={checkUpOutcomeTone(checkUp.evaluation.outcome)}>{CHECK_UP_OUTCOME_LABEL[checkUp.evaluation.outcome]}</StatusChip>
        ) : checkUp.answered ? (
          <StatusChip tone="success">Answered</StatusChip>
        ) : checkUp.overdue ? (
          <StatusChip tone="danger">Overdue</StatusChip>
        ) : (
          <StatusChip tone="accent">{checkUp.open ? "Open" : "Not answered"}</StatusChip>
        )}
        <span>Target: {checkUp.target.kind === "system" ? checkUp.target.name : "Organization"}</span>
        <span>
          Audit: {checkUp.audit.title} ({INTERNAL_AUDIT_STATUS_LABEL[checkUp.audit.status].toLowerCase()})
        </span>
        <span>Due {checkUp.audit.dueDate}</span>
        <span>Recipient: {checkUp.recipient ? checkUp.recipient.name : "No Control Owner"}</span>
      </div>

      {!checkUp.recipient && (
        <p className="mb-4 text-sm text-zinc-500">
          This Check-up has no recipient: its Control has no Control Owner. Nobody can answer it until one is assigned.
        </p>
      )}
      {lockedReason && <p className="mb-4 text-sm text-zinc-500">{lockedReason}.</p>}
      {isRecipient && !access.canAnswer && !lockedReason && (
        <p className="mb-4 text-sm text-zinc-500">An Internal Auditor can&apos;t answer a Check-up: the role is read-only.</p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-lg">{access.canAnswer ? (checkUp.response ? "Your response" : "Answer the questions") : checkUp.response ? "Response" : "Questions"}</h2>
        {checkUp.response && (
          <p className="mb-2 text-sm text-zinc-500">
            Submitted by {checkUp.response.respondedBy.name} on {checkUp.response.respondedAt.slice(0, 10)}
            {changedLater ? `, last changed by ${checkUp.response.lastChangedBy.name} on ${checkUp.response.updatedAt.slice(0, 10)}` : ""}.
            {access.canAnswer ? " You can change it until the Internal Auditor evaluates it. Submitting changes no status anywhere." : ""}
          </p>
        )}
        {!checkUp.response && !access.canAnswer && <p className="mb-2 text-sm text-zinc-500">Not answered yet.</p>}

        {access.canAnswer ? (
          <CheckUpResponseForm
            checkUpId={checkUp.id}
            questions={checkUp.questions}
            initialEvidenceLinks={checkUp.response?.evidenceLinks ?? []}
            changing={checkUp.response !== null}
          />
        ) : (
          <ol className="flex flex-col gap-3 text-sm">
            {checkUp.questions.map((question) => (
              <li key={question.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="font-medium">
                  {question.position}. {question.text}
                </p>
                {question.answer && (
                  <>
                    <p>
                      <span className="text-zinc-500">Answer: </span>
                      {CHECK_UP_ANSWER_LABEL[question.answer.answer]}
                    </p>
                    {question.answer.description && (
                      <p className="whitespace-pre-wrap">
                        <span className="text-zinc-500">Description: </span>
                        {question.answer.description}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {checkUp.response && !access.canAnswer && (
        <section className="mb-6">
          <h2 className="mb-1 text-lg">Evidence links</h2>
          {checkUp.response.evidenceLinks.length === 0 ? (
            <p className="text-sm text-zinc-500">No evidence links.</p>
          ) : (
            <ul className="list-disc pl-6 text-sm">
              {checkUp.response.evidenceLinks.map((link) =>
                safeHttpUrl(link) ? (
                  <li key={link}>
                    <a className="underline" href={link} target="_blank" rel="noopener noreferrer">
                      {link}
                    </a>
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </section>
      )}

      {checkUp.withdrawal && (
        <section aria-label="Withdrawal" className="mb-6">
          <h2 className="mb-1 text-lg">Withdrawn</h2>
          <p className="mb-1 text-sm text-zinc-500">
            Withdrawn by {checkUp.withdrawal.withdrawnBy.name} on {checkUp.withdrawal.withdrawnAt.slice(0, 10)}. A withdrawal is final.
          </p>
          <p className="whitespace-pre-wrap text-sm">{checkUp.withdrawal.reason}</p>
        </section>
      )}

      {checkUp.evaluation ? (
        <section aria-label="Evaluation">
          <h2 className="mb-1 text-lg">Evaluation</h2>
          <p className="mb-1 flex items-center gap-2 text-sm">
            <StatusChip tone={checkUpOutcomeTone(checkUp.evaluation.outcome)}>{CHECK_UP_OUTCOME_LABEL[checkUp.evaluation.outcome]}</StatusChip>
            <span className="text-zinc-500">
              Evaluated by {checkUp.evaluation.evaluatedBy.name} on {checkUp.evaluation.evaluatedAt.slice(0, 10)}. An evaluation is final.
            </span>
          </p>
          {checkUp.evaluation.comment ? (
            <p className="whitespace-pre-wrap text-sm">{checkUp.evaluation.comment}</p>
          ) : (
            <p className="text-sm text-zinc-500">No comment.</p>
          )}
        </section>
      ) : access.canEvaluate ? (
        <section aria-label="Evaluate this Check-up">
          <h2 className="mb-2 text-lg">Evaluate this Check-up</h2>
          <CheckUpEvaluationForm checkUpId={checkUp.id} />
        </section>
      ) : (
        checkUp.answered && !checkUp.withdrawn && <p className="text-sm text-zinc-500">Not evaluated yet.</p>
      )}

      {access.canWithdraw && (
        <section aria-label="Withdraw this Check-up" className="mt-6">
          <h2 className="mb-2 text-lg">Withdraw this Check-up</h2>
          <p className="mb-2 text-sm text-zinc-500">
            Withdraw a Check-up that should not be answered or evaluated after all. It leaves the recipient&apos;s tasks; any response stays on record. A withdrawal is final.
          </p>
          <WithdrawCheckUpControl checkUpId={checkUp.id} />
        </section>
      )}

      {checkUp.risk && access.canReadRisk && (
        <section aria-label="Risk opened" className="mt-6">
          <h2 className="mb-1 text-lg">Risk opened</h2>
          <p className="mb-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{checkUp.risk.title}</span>
            <StatusChip tone={riskStatusTone(checkUp.risk.status)}>{checkUp.risk.status}</StatusChip>
            {checkUp.risk.systemId ? (
              <Link className="underline" href={`/systems/${checkUp.risk.systemId}`}>
                On {checkUp.target.kind === "system" ? checkUp.target.name : "the System"}
              </Link>
            ) : canReadOrganizationRisks(user) ? (
              <Link className="underline" href={ORGANIZATION_RISKS_HREF}>
                Organization Risks
              </Link>
            ) : (
              <span className="text-zinc-500">Organization Risk (belongs to no System)</span>
            )}
          </p>
          <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{checkUp.risk.description}</p>
        </section>
      )}
    </div>
  );
}

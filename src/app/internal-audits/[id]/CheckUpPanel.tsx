"use client";

import Link from "next/link";
import type { InternalAuditStatus } from "@prisma/client";
import { CheckUpEvaluationForm } from "@/components/CheckUpEvaluationForm";
import { WithdrawCheckUpControl } from "@/components/WithdrawCheckUpControl";
import { StatusChip } from "@/components/ui/StatusChip";
import { CHECK_UP_ANSWER_LABEL } from "@/lib/check-up-response-rules";
import { CHECK_UP_OUTCOME_LABEL } from "@/lib/check-up-evaluation-rules";
import type { AuditCheckUp } from "@/lib/internal-audit-detail";
import { checkUpStateChip } from "./check-up-state-chip";
import { checkUpOutcomeTone, riskStatusTone } from "@/lib/status-tones";

const day = (iso: string) => iso.slice(0, 10);

/**
 * The picked Check-up in full, beside the list (#399): its questions with the recipient's answers, the response, and
 * the evaluation or withdrawal. On a launched audit a role that may evaluate sees the evaluation form while the Check-up
 * is answered and not yet evaluated, and a role that may withdraw sees Withdraw while it is open; both forms post to the
 * existing routes and refresh the page. Closed audits and other roles get it read-only.
 */
export function CheckUpPanel({
  checkUp,
  auditStatus,
  canEvaluate,
  canWithdraw,
}: {
  checkUp: AuditCheckUp;
  auditStatus: InternalAuditStatus;
  canEvaluate: boolean;
  canWithdraw: boolean;
}) {
  const launched = auditStatus === "LAUNCHED";
  const chip = checkUpStateChip(checkUp);
  const open = checkUp.state !== "evaluated" && checkUp.state !== "withdrawn";
  const showEvaluate = launched && canEvaluate && checkUp.state === "awaiting";
  const showWithdraw = launched && canWithdraw && open;

  return (
    <div className="ad-panel" data-testid="check-up-panel">
      <div>
        <h3>
          <span className="ad-code">{checkUp.control.code}</span> {checkUp.control.title}
        </h3>
        <p className="ad-sub">
          {checkUp.target.kind === "system" ? <Link href={`/systems/${checkUp.target.id}`}>{checkUp.target.name}</Link> : "Organization"}
          {" · "}
          {checkUp.recipient ? checkUp.recipient.name : <span className="bad">No Control Owner</span>}
          {" · "}
          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
        </p>
      </div>

      <div>
        <div className="ad-label">{checkUp.questions.length === 1 ? "Question" : "Questions"}</div>
        <ol className="ad-questions">
          {checkUp.questions.map((question) => (
            <li key={question.id}>
              {question.text}
              {question.guidance && <small>Guidance: {question.guidance}</small>}
              {question.answer && (
                <small>
                  <b>{CHECK_UP_ANSWER_LABEL[question.answer.answer]}</b>
                  {question.answer.description ? ` · ${question.answer.description}` : ""}
                </small>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <div className="ad-label">Response</div>
        {checkUp.response ? (
          <>
            <p className="ad-sub">
              {checkUp.response.respondedByName}, {day(checkUp.response.respondedAt)}
            </p>
            {checkUp.response.evidenceLinks.length > 0 && (
              <ul className="ad-links" aria-label="Evidence links">
                {checkUp.response.evidenceLinks.map((link) => (
                  <li key={link}>
                    <a href={link} target="_blank" rel="noopener noreferrer">
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="ad-sub">
            {checkUp.state === "overdue" && <b className="bad">Overdue: </b>}
            Not answered yet{checkUp.recipient ? ` by ${checkUp.recipient.name}` : ""}.
          </p>
        )}
      </div>

      {checkUp.withdrawal && (
        <div className="ad-note">
          <div className="ad-label">Withdrawn</div>
          <p>
            {checkUp.withdrawal.withdrawnByName}, {day(checkUp.withdrawal.withdrawnAt)}: {checkUp.withdrawal.reason}
          </p>
        </div>
      )}

      {checkUp.evaluation && (
        <div>
          <div className="ad-label">Evaluation</div>
          <p className="ad-sub">
            <StatusChip tone={checkUpOutcomeTone(checkUp.evaluation.outcome)}>{CHECK_UP_OUTCOME_LABEL[checkUp.evaluation.outcome]}</StatusChip>{" "}
            {checkUp.evaluation.evaluatedByName}, {day(checkUp.evaluation.evaluatedAt)}
          </p>
          <p className="ad-comment">{checkUp.evaluation.comment || <span className="ad-sub">No comment.</span>}</p>
        </div>
      )}

      {checkUp.risk && (
        <p className="ad-sub" aria-label="Risk opened">
          Opened Risk <b>{checkUp.risk.title}</b> <StatusChip tone={riskStatusTone(checkUp.risk.status)}>{checkUp.risk.status}</StatusChip>
          {checkUp.risk.systemId && (
            <>
              {" "}
              <Link href={`/systems/${checkUp.risk.systemId}`}>On the System</Link>
            </>
          )}
        </p>
      )}

      {showEvaluate && (
        <section aria-label="Evaluate this Check-up">
          <div className="ad-label">Evaluate</div>
          <CheckUpEvaluationForm key={checkUp.id} checkUpId={checkUp.id} />
          <p className="ad-sub">A Nonconformity opens a Risk and sets a Fulfilled assessment back to In Progress.</p>
        </section>
      )}
      {launched && canEvaluate && open && checkUp.state !== "awaiting" && <p className="ad-sub">It can be evaluated once the recipient has answered it.</p>}

      {showWithdraw && (
        <div>
          <WithdrawCheckUpControl key={checkUp.id} checkUpId={checkUp.id} label="Withdraw…" />
        </div>
      )}

      <p className="ad-sub">
        <Link href={`/check-ups/${checkUp.id}`}>Open the full Check-up</Link>
      </p>
    </div>
  );
}

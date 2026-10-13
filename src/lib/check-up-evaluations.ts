import type { CheckUpOutcome, Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import {
  canEvaluateCheckUps,
  checkUpEvaluationRefusal,
  describeCheckUpEvaluation,
  validateEvaluation,
  type EvaluationInput,
  type ValidEvaluation,
} from "@/lib/check-up-evaluation-rules";
import { CheckUpResponseError, lockCheckUp } from "@/lib/check-up-responses";
import { applyNonconformity } from "@/lib/check-up-nonconformity";
import { ORGANIZATION_TRANSACTION_TIMEOUT_MS } from "@/lib/organization-inheritance";

/**
 * An Internal Auditor's evaluation of an answered Check-up (PRD 0001 F-IA.6, F-CE.1, #156).
 *
 * One transaction writes the evaluation and exactly one System-less CHECK_UP_EVALUATED Change
 * Event, actor the auditor. It takes the Check-up's row lock first (`lockCheckUp`) and checks every
 * precondition after it, so it can't interleave with the recipient changing the response or with a
 * second evaluation; every read uses the transaction client. A Nonconformity opens a Risk and sets
 * a Fulfilled target back (`applyNonconformity`, #157) at `onEvaluated` below, in the same
 * transaction: if a side effect fails the evaluation, its Change Event and the Risk all roll back.
 * The transaction has the generous timeout of an Organization implementation change, since an
 * Organization-level set-back can write an event for every inheriting System.
 */

/** What an evaluation hands to the side effects of an outcome (#157), inside its transaction. */
export type EvaluatedCheckUp = {
  tx: Prisma.TransactionClient;
  checkUpId: string;
  evaluationId: string;
  outcome: CheckUpOutcome;
  /** The Check-up's target: a System id, or null for the Organization. */
  systemId: string | null;
  controlId: string;
  actorId: string;
  /** The auditor's comment (required for a Nonconformity). */
  comment: string;
};

/**
 * What an outcome triggers (#157): a Nonconformity opens a Risk linked to the Check-up and sets a
 * Fulfilled target back to In Progress; Conforming and Observation do nothing. It runs inside
 * the evaluation's transaction, after the evaluation and its Change Event are written, with the
 * transaction client: whatever it writes commits or rolls back with the evaluation.
 * Exported as the seam tests use to make a side effect fail (`vi.spyOn`).
 */
export const sideEffects = {
  async onEvaluated(evaluated: EvaluatedCheckUp): Promise<void> {
    if (evaluated.outcome === "NONCONFORMITY") {
      await applyNonconformity({ tx: evaluated.tx, checkUpId: evaluated.checkUpId, comment: evaluated.comment, actorId: evaluated.actorId });
    }
  },
};

/**
 * Evaluates `checkUpId` as `input.outcome` with `input.comment`. Throws `CheckUpResponseError`:
 * 403 unless `user` is an Internal Auditor (the Admin and the Compliance Manager included; checked
 * before anything is read), 404 if there is no such Check-up, 409 if `checkUpEvaluationRefusal`
 * says so (already evaluated, its audit isn't launched, not answered yet), 400 naming each problem
 * if the evaluation is invalid. A refusal changes nothing.
 */
export async function evaluateCheckUp(
  checkUpId: string,
  user: { id: string; role: UserRole },
  input: EvaluationInput | null,
  now?: Date,
): Promise<{ evaluationId: string }> {
  if (!canEvaluateCheckUps(user)) throw new CheckUpResponseError(403, "Only an Internal Auditor can evaluate a Check-up");

  return prisma.$transaction(async (tx) => {
    if (!(await lockCheckUp(tx, checkUpId))) throw new CheckUpResponseError(404, "Check-up not found");
    const checkUp = await tx.checkUp.findUnique({
      where: { id: checkUpId },
      select: {
        controlId: true,
        systemId: true,
        internalAudit: { select: { title: true, status: true } },
        control: { select: { code: true } },
        system: { select: { name: true } },
        response: { select: { id: true } },
        evaluation: { select: { id: true } },
      },
    });
    if (!checkUp) throw new CheckUpResponseError(404, "Check-up not found");

    const refusal = checkUpEvaluationRefusal({
      auditStatus: checkUp.internalAudit.status,
      answered: checkUp.response !== null,
      evaluated: checkUp.evaluation !== null,
    });
    if (refusal) throw new CheckUpResponseError(409, refusal);

    // `null` is a body of the wrong shape; the refusals above come first.
    if (input === null) throw new CheckUpResponseError(400, "Invalid Check-up evaluation");
    const { evaluation, problems } = validateEvaluation(input);
    if (!evaluation) throw new CheckUpResponseError(400, problems.join("; "), problems);
    return record(tx, checkUpId, checkUp, evaluation, user.id, now);
  }, { timeout: ORGANIZATION_TRANSACTION_TIMEOUT_MS });
}

async function record(
  tx: Prisma.TransactionClient,
  checkUpId: string,
  checkUp: {
    controlId: string;
    systemId: string | null;
    internalAudit: { title: string };
    control: { code: string };
    system: { name: string } | null;
  },
  evaluation: ValidEvaluation,
  actorId: string,
  now: Date | undefined,
): Promise<{ evaluationId: string }> {
  const created = await tx.checkUpEvaluation.create({
    data: { checkUpId, outcome: evaluation.outcome, comment: evaluation.comment, evaluatedById: actorId, evaluatedAt: now ?? new Date() },
    select: { id: true },
  });
  // System-less even for a System-level Check-up: it is evidence about the audit, not a change to the System.
  await logChangeEvent(
    null,
    "CHECK_UP_EVALUATED",
    describeCheckUpEvaluation({
      outcome: evaluation.outcome,
      auditTitle: checkUp.internalAudit.title,
      controlCode: checkUp.control.code,
      systemName: checkUp.system?.name ?? null,
    }),
    actorId,
    tx,
  );
  await sideEffects.onEvaluated({
    tx,
    checkUpId,
    evaluationId: created.id,
    outcome: evaluation.outcome,
    systemId: checkUp.systemId,
    controlId: checkUp.controlId,
    actorId,
    comment: evaluation.comment,
  });
  return { evaluationId: created.id };
}

/** The body of POST /api/check-ups/[id]/evaluation. The shape only; the outcome and the comment are `validateEvaluation`'s. */
export const checkUpEvaluationBodySchema = z.object({
  outcome: z.string(),
  comment: z.string().optional(),
});

/**
 * How many answered Check-ups of launched audits still await an evaluation: the Internal Auditor's
 * "N awaiting evaluation" on /home. Spans every audit (audits are a small team's shared work).
 */
export async function countAwaitingEvaluation(): Promise<number> {
  return prisma.checkUp.count({
    where: { internalAudit: { status: "LAUNCHED" }, response: { isNot: null }, evaluation: { is: null } },
  });
}

import { z } from "zod";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  canWithdrawCheckUps,
  checkUpWithdrawalRefusal,
  validateWithdrawal,
  type WithdrawalInput,
} from "@/lib/check-up-withdrawal-rules";
import { CheckUpResponseError, lockCheckUp } from "@/lib/check-up-responses";

/**
 * An Internal Auditor's withdrawal of a Check-up that has not been evaluated (PRD 0001 F-IA.8,
 * #158), with a required reason. One transaction writes the `CheckUpWithdrawal` and nothing else:
 * no Change Event (F-CE.1 logs only evaluations), no status, no Risk. A response the Check-up
 * already had stays as part of the record, read-only. A withdrawal is final.
 *
 * It takes the Check-up's row lock first (`lockCheckUp`) and reads every precondition after it, like
 * the response and the evaluation, so withdraw, evaluate and respond run one after the other: the
 * loser reads the winner's committed work and is refused with a 409. Every read uses the
 * transaction client.
 */

/**
 * Withdraws `checkUpId`. Throws `CheckUpResponseError`: 403 unless `user` is an Internal Auditor
 * (checked before anything is read), 404 if there is no such Check-up, 409 if
 * `checkUpWithdrawalRefusal` says so (already withdrawn, evaluated, or its audit isn't launched),
 * 400 naming each problem if the reason is missing or too long. A refusal changes nothing.
 */
export async function withdrawCheckUp(
  checkUpId: string,
  user: { id: string; role: UserRole },
  input: WithdrawalInput | null,
  now?: Date,
): Promise<{ withdrawalId: string }> {
  if (!canWithdrawCheckUps(user)) throw new CheckUpResponseError(403, "Only an Internal Auditor can withdraw a Check-up");

  return prisma.$transaction(async (tx) => {
    if (!(await lockCheckUp(tx, checkUpId))) throw new CheckUpResponseError(404, "Check-up not found");
    const checkUp = await tx.checkUp.findUnique({
      where: { id: checkUpId },
      select: {
        internalAudit: { select: { status: true } },
        evaluation: { select: { id: true } },
        withdrawal: { select: { id: true } },
      },
    });
    if (!checkUp) throw new CheckUpResponseError(404, "Check-up not found");

    const refusal = checkUpWithdrawalRefusal({
      auditStatus: checkUp.internalAudit.status,
      evaluated: checkUp.evaluation !== null,
      withdrawn: checkUp.withdrawal !== null,
    });
    if (refusal) throw new CheckUpResponseError(409, refusal);

    // `null` is a body of the wrong shape; the refusals above come first.
    if (input === null) throw new CheckUpResponseError(400, "Invalid Check-up withdrawal");
    const { reason, problems } = validateWithdrawal(input);
    if (reason === null) throw new CheckUpResponseError(400, problems.join("; "), problems);

    const created = await tx.checkUpWithdrawal.create({
      data: { checkUpId, reason, withdrawnById: user.id, withdrawnAt: now ?? new Date() },
      select: { id: true },
    });
    return { withdrawalId: created.id };
  });
}

/** The body of POST /api/check-ups/[id]/withdrawal. The shape only; the reason is `validateWithdrawal`'s. */
export const checkUpWithdrawalBodySchema = z.object({
  reason: z.string().optional(),
});

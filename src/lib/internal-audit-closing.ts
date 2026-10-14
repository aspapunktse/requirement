import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { InternalAuditError } from "@/lib/internal-audits";
import {
  closeBlockedMessage,
  describeUnfinishedCheckUp,
  internalAuditCloseRefusal,
  unfinishedCheckUps,
} from "@/lib/internal-audit-close-rules";

/**
 * Closing an Internal Audit (PRD 0001 F-IA.8, #158): the audit becomes a finished record, read-only
 * for every role. It writes the status, `closedAt` and `closedById` and nothing else: no Change
 * Event (F-CE.1 logs only evaluations), and a Risk a Nonconformity opened stays an ordinary Risk.
 *
 * The transaction (READ COMMITTED, the default) locks the audit row, then every Check-up row of the
 * audit, and only then reads whether each is evaluated or withdrawn. The Check-up locks are the same
 * `FOR UPDATE` a response, an evaluation and a withdrawal take (`lockCheckUp`), so closing waits for
 * a write in flight and sees its committed result, and a write that starts afterwards finds the
 * audit closed and is refused. Nothing can slip in between the check and the status change. Locks
 * are always taken audit first, then Check-ups by id; no Check-up write takes the audit's lock, so
 * they can't deadlock. Every query uses the transaction client.
 */

/** Locks the audit row and says whether it exists. */
async function lockAudit(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "InternalAudit" WHERE "id" = ${id} FOR UPDATE`;
  return rows.length > 0;
}

/**
 * Closes the launched Internal Audit `internalAuditId`, recording `closedById`. Throws `InternalAuditError`: 404 if
 * there is no such audit, 409 if it isn't launched (a draft is deleted, not closed; a closed audit
 * stays closed) or if any Check-up is neither evaluated nor withdrawn, in which case `problems`
 * names each one (Control code and target System, or the Organization). A refusal changes nothing.
 * Who may close is the route's (403 for every role but the Internal Auditor).
 */
export async function closeInternalAudit(internalAuditId: string, closedById: string, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (!(await lockAudit(tx, internalAuditId))) throw new InternalAuditError(404, "Internal Audit not found");
    const audit = await tx.internalAudit.findUnique({ where: { id: internalAuditId }, select: { status: true } });
    if (!audit) throw new InternalAuditError(404, "Internal Audit not found");
    const refusal = internalAuditCloseRefusal(audit.status);
    if (refusal) throw new InternalAuditError(409, refusal);

    await tx.$queryRaw`SELECT "id" FROM "CheckUp" WHERE "internalAuditId" = ${internalAuditId} ORDER BY "id" FOR UPDATE`;
    const checkUps = await tx.checkUp.findMany({
      where: { internalAuditId },
      select: {
        id: true,
        control: { select: { code: true } },
        system: { select: { name: true } },
        evaluation: { select: { id: true } },
        withdrawal: { select: { id: true } },
      },
    });
    const unfinished = unfinishedCheckUps(
      checkUps.map((checkUp) => ({
        id: checkUp.id,
        controlCode: checkUp.control.code,
        systemName: checkUp.system?.name ?? null,
        evaluated: checkUp.evaluation !== null,
        withdrawn: checkUp.withdrawal !== null,
      })),
    );
    if (unfinished.length > 0) {
      throw new InternalAuditError(409, closeBlockedMessage(unfinished.length), unfinished.map(describeUnfinishedCheckUp));
    }

    // The status guard inside the write, though the lock above already makes it redundant.
    const closed = await tx.internalAudit.updateMany({
      where: { id: internalAuditId, status: "LAUNCHED" },
      data: { status: "CLOSED", closedAt: now, closedById },
    });
    if (closed.count === 0) throw new InternalAuditError(409, "Only a launched Internal Audit can be closed");
  });
}

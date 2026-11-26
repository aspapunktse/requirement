import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createOscalRelease } from "@/lib/oscal/releases";
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

/** What `makeReleasesAfterClose` did for each System of the audit: made, skipped (a closed System) or failed (logged, not thrown). */
export type AuditCloseReleaseOutcome = { systemId: string; result: "made" | "skipped" | "failed" };

/**
 * After an Internal Audit has closed (#454): makes one OSCAL Release for each System in it, trigger `INTERNAL_AUDIT_CLOSE`,
 * `internalAuditId` set and the closing user as the actor. Called after `closeInternalAudit` has committed, and each release runs
 * in its own transaction (`createOscalRelease` without `tx`), so a slow or failing build can never block or undo the close. A
 * System whose release fails is logged and left without one (its owner or an Admin can still make one by hand); a closed System
 * (Rejected or Not selected) is skipped. Never throws. Systems are done one after another, in id order.
 */
export async function makeReleasesAfterClose(internalAuditId: string, actorId: string): Promise<AuditCloseReleaseOutcome[]> {
  const systems = await prisma.internalAuditSystem
    .findMany({ where: { internalAuditId }, select: { systemId: true }, orderBy: { systemId: "asc" } })
    .catch((error) => {
      console.error(`Listing the Systems of Internal Audit ${internalAuditId} for its OSCAL Releases failed`, error);
      return [];
    });
  const outcomes: AuditCloseReleaseOutcome[] = [];
  for (const { systemId } of systems) {
    try {
      const made = await createOscalRelease({ systemId, actorId, trigger: "INTERNAL_AUDIT_CLOSE", internalAuditId });
      outcomes.push({ systemId, result: made.kind === "ok" ? "made" : "skipped" });
    } catch (error) {
      console.error(`OSCAL Release for System ${systemId} after closing Internal Audit ${internalAuditId} failed`, error);
      outcomes.push({ systemId, result: "failed" });
    }
  }
  return outcomes;
}

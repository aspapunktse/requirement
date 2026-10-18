import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runProviderAssessmentWrite } from "@/lib/provider-inheritance";
import { editReopensSteps, lockSystem, reopenStepsForEdit } from "@/lib/review-steps";

type Tx = Prisma.TransactionClient;

/**
 * `runProviderAssessmentWrite` for a person's edit of a Control Assessment, which on a System In
 * Review can reopen approved Review Steps (#200). The write, the reopening and its Change Events are
 * then one transaction that takes the System's row lock first (`lockSystem`), so the edit serialises with
 * step decisions and with `settleReviewSteps`, and `write` gets `locked = true` and the transaction
 * client: it re-reads whatever it compares against inside, and uses only `db`.
 *
 * Lock order: a Provider's advisory locks (`lockProvider`, then the Control's) come before the System
 * row lock, and nothing that holds the row lock takes an advisory lock, so the two orders can't cross.
 * Any other System, or one not In Review, is exactly `runProviderAssessmentWrite`.
 */
export function runAssessmentEdit<T>(
  system: { id: string; isProvider: boolean; status: string },
  controlId: string,
  write: (db: Tx | typeof prisma, locked: boolean) => Promise<T>,
): Promise<T> {
  if (system.status !== "IN_REVIEW") return runProviderAssessmentWrite(system, controlId, write);
  const underRowLock = async (tx: Tx) => {
    await lockSystem(tx, system.id);
    return write(tx, true);
  };
  if (!system.isProvider) return prisma.$transaction(underRowLock);
  // A Provider's write always runs on the transaction (`locked`), so `db` is a Tx.
  return runProviderAssessmentWrite(system, controlId, (db) => underRowLock(db as Tx));
}

/**
 * Inside `runAssessmentEdit`'s `write`: reopens the approved steps whose remit contains `control`, when
 * the edit really changed the Assessment (`changed`) and `editReopensSteps` allows this person. Does
 * nothing when `db` isn't the locked transaction (the System isn't In Review).
 */
export async function reopenStepsAfterEdit(
  db: Tx | typeof prisma,
  locked: boolean,
  system: { id: string; status: string; ownerId: string },
  control: { id: string; code: string },
  actor: { id: string; role: UserRole },
  changed: boolean,
) {
  if (!changed || !locked || system.status !== "IN_REVIEW" || !editReopensSteps(actor, system)) return;
  await reopenStepsForEdit(db as Tx, system.id, control, actor.id);
}

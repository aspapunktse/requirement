import type { Prisma } from "@prisma/client";

/**
 * Takes a row lock on the System, so decisions and reconciliations on it run one after another.
 * Call it first in a READ COMMITTED transaction (a REPEATABLE READ snapshot would be taken before
 * the wait and miss what the previous holder committed).
 *
 * `FOR NO KEY UPDATE`, not `FOR UPDATE`: lockers still exclude each other, but the holder doesn't
 * block other transactions' inserts that reference the System (Change Events on a dependent of a
 * Provider), which would let two Provider transactions wait on each other's System rows (#200).
 *
 * It lives here, not in `review-steps.ts`, because the Review Steps and the OG1 verdicts (#328) both
 * take it and neither module may import the other.
 */
export async function lockSystem(tx: Prisma.TransactionClient, systemId: string) {
  await tx.$queryRaw`SELECT "id" FROM "System" WHERE "id" = ${systemId} FOR NO KEY UPDATE`;
}

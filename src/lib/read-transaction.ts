/**
 * The options of a page loader's read-only transaction: one RepeatableRead snapshot, with a timeout that
 * leaves room for a production-sized estate. Prisma's default is 5 s (and 2 s to get a connection), and a
 * loader on ~100 Systems running a few dozen round trips to a database in another region went past it, so
 * the page threw "Transaction already closed" (#387). Spread it into `prisma.$transaction(fn, READ_SNAPSHOT)`.
 * Fewer round trips is the real fix; this keeps normal variance from turning into a 500.
 */
export const READ_SNAPSHOT = {
  isolationLevel: "RepeatableRead",
  timeout: 20_000,
  maxWait: 10_000,
} as const;

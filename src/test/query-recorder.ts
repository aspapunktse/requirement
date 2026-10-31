import type { PrismaClient } from "@prisma/client";

/**
 * Records the SQL a Prisma client sends, for the "constant number of queries" tests (#145, #169).
 *
 * Prisma delivers `query` events asynchronously, so an event for a statement sent just before a
 * measurement (the last fixture write, a transaction's COMMIT) can arrive after a plain counter was
 * reset, and one for the loader's last statement can arrive after the loader returned. A raw counter
 * then reads one too many or too few (#276). `record` brackets the measured call with two marker
 * statements and keeps only the events between them; events are delivered in the order the engine
 * logged them, so seeing a marker means everything sent before it has been delivered.
 */
export type QueryRecorder = {
  /** Called by the mocked client's `query` event. */
  push: (sql: string) => void;
  /** Runs `fn` and returns the statements it sent, in order. */
  record: (client: PrismaClient, fn: () => Promise<unknown>) => Promise<string[]>;
};

export function createQueryRecorder(): QueryRecorder {
  let events: string[] = [];
  const waiters: Array<() => void> = [];

  async function mark(client: PrismaClient, name: string) {
    const marker = `/* ${name} ${Math.random().toString(36).slice(2)} */`;
    await client.$queryRawUnsafe(`SELECT 1 ${marker}`);
    const deadline = Date.now() + 5000;
    while (!events.some((sql) => sql.includes(marker))) {
      if (Date.now() > deadline) throw new Error(`The query event for ${marker} never arrived`);
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
        setTimeout(resolve, 20);
      });
    }
    return marker;
  }

  return {
    push(sql) {
      events.push(sql);
      for (const wake of waiters.splice(0)) wake();
    },
    async record(client, fn) {
      const start = await mark(client, "start");
      events = events.slice(events.findIndex((sql) => sql.includes(start)) + 1);
      await fn();
      const end = await mark(client, "end");
      const recorded = events.slice(0, events.findIndex((sql) => sql.includes(end)));
      events = [];
      return recorded;
    },
  };
}

/** The failure message for two runs that sent different statements: both lists, in full. */
export function describeQueries(before: string[], after: string[]) {
  const list = (queries: string[]) => queries.map((sql, index) => `  ${index + 1}. ${sql}`).join("\n");
  return `Expected the same statements before and after adding rows.\nBefore (${before.length}):\n${list(before)}\nAfter (${after.length}):\n${list(after)}`;
}

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * The Internal Audits list loader sends the same number of SQL queries however many audits there are (#398):
 * grouped reads, not one per audit or Check-up. `@/lib/prisma` is replaced by a client that counts the queries
 * it sends (see `statement-of-applicability-queries.test.ts`); the test adds drafts, launched and closed audits
 * and checks the count did not move.
 */
const recorder = vi.hoisted(() => ({ current: null as null | import("@/test/query-recorder").QueryRecorder }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  const { createQueryRecorder } = await import("@/test/query-recorder");
  recorder.current = createQueryRecorder();
  (client as unknown as { $on: (event: "query", cb: (e: { query: string }) => void) => void }).$on("query", (event) => {
    recorder.current?.push(event.query);
  });
  return { prisma: client };
});

import { prisma } from "@/lib/prisma";
import { describeQueries } from "@/test/query-recorder";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { addAudit } from "@/test/internal-audit-list-fixtures";
import { loadInternalAuditList } from "../internal-audit-list";

describe("loadInternalAuditList: constant number of queries (#398)", () => {
  const db = prisma as PrismaClient;
  let scenario: Awaited<ReturnType<typeof createCheckUpScenario>>;

  const record = () => recorder.current!.record(db, () => loadInternalAuditList());

  beforeAll(async () => {
    scenario = await createCheckUpScenario("398Q", { systemControls: 3, organizationControls: 1 });
    // One audit of each kind to start from (the scenario's own is launched).
    await addAudit(scenario, { title: "Test #398Q draft", state: "draft" });
    await addAudit(scenario, { title: "Test #398Q closed", state: "closed" });
  }, 60_000);

  afterAll(async () => {
    await scenario.cleanup();
    await db.$disconnect();
  });

  it("sends the same queries for 3 audits and for 12", async () => {
    const before = await record();
    expect(before.length).toBeGreaterThan(0);
    const countBefore = (await db.internalAudit.count({ where: { createdById: scenario.roleUser.INTERNAL_AUDITOR } })) ;
    expect(countBefore).toBe(3);

    for (let index = 1; index <= 3; index += 1) {
      await addAudit(scenario, { title: `Test #398Q draft ${index}`, state: "draft", dueInDays: 10 + index });
      await addAudit(scenario, { title: `Test #398Q launched ${index}`, state: "launched", dueInDays: 20 + index });
      await addAudit(scenario, { title: `Test #398Q closed ${index}`, state: "closed" });
    }
    const after = await record();
    expect(await db.internalAudit.count({ where: { createdById: scenario.roleUser.INTERNAL_AUDITOR } })).toBe(12);
    expect(after.length, describeQueries(before, after)).toBe(before.length);
  }, 60_000);
});

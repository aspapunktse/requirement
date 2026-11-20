import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * The single Internal Audit loader sends the same number of SQL queries however many Check-ups the audit has (#399):
 * nested selects and grouped reads, not one per Check-up. `@/lib/prisma` is replaced by a client that counts the queries
 * it sends (see `internal-audit-list-queries.test.ts`); the test reads an audit of 2 Check-ups and one of 14, launched and
 * as a draft, and checks the count did not move.
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
import { loadInternalAuditPage } from "../internal-audit-detail";

describe("loadInternalAuditPage: constant number of queries (#399)", () => {
  const db = prisma as PrismaClient;
  let few: Awaited<ReturnType<typeof createCheckUpScenario>>;
  let many: Awaited<ReturnType<typeof createCheckUpScenario>>;

  const record = (id: string) => recorder.current!.record(db, () => loadInternalAuditPage(id));

  beforeAll(async () => {
    few = await createCheckUpScenario("399Qa", { systemControls: 1, organizationControls: 1 });
    many = await createCheckUpScenario("399Qb", { systemControls: 10, organizationControls: 4 });
    // Give the larger audit one of each kind of Check-up so every nested relation has rows.
    const [first, second] = many.checkUps;
    await many.answer(first.id, many.systemOwner);
    await prisma.checkUpWithdrawal.create({ data: { checkUpId: second.id, reason: "Test #399Q withdrawn", withdrawnById: many.roleUser.INTERNAL_AUDITOR } });
  }, 120_000);

  afterAll(async () => {
    await few.cleanup();
    await many.cleanup();
    await db.$disconnect();
  });

  it("sends the same queries for 2 Check-ups and for 14", async () => {
    expect(few.checkUps).toHaveLength(2);
    expect(many.checkUps).toHaveLength(14);
    const small = await record(few.auditId);
    const large = await record(many.auditId);
    expect(small.length).toBeGreaterThan(0);
    expect(large.length, describeQueries(small, large)).toBe(small.length);
  }, 60_000);

  it("sends the same queries for a draft with few and many Controls", async () => {
    const smallDraft = await addAudit(few, { title: "Test #399Q small draft", state: "draft", includeOrganization: true });
    const largeDraft = await addAudit(many, { title: "Test #399Q large draft", state: "draft", includeOrganization: true });
    const small = await record(smallDraft);
    const large = await record(largeDraft);
    expect(small.length).toBeGreaterThan(0);
    expect(large.length, describeQueries(small, large)).toBe(small.length);
  }, 60_000);
});

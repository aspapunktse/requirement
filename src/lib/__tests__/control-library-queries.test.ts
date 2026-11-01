import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/** The Control Library loader sends the same SQL however many Controls there are (#169). */
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
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { loadControlLibrary } from "../control-library";

describe("loadControlLibrary: constant number of queries (#169)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const db = prisma as PrismaClient;
  const controlIds: string[] = [];
  let frameworkId: string;
  let ownerId: string;
  let facetId: string;
  let next = 0;

  async function addControl(related: Record<string, unknown> = {}) {
    const index = next++;
    const control = await db.control.create({
      data: {
        code: `TEST-169-Q-${suffix}-${index}`,
        title: `Test 169 queries ${index}`,
        description: "d",
        category: "Test",
        applicability: "ORGANIZATIONAL",
        ...related,
      },
    });
    controlIds.push(control.id);
    await mapControlsToFramework(frameworkId, [control.id]);
  }

  async function recordQueries(role: "VIEWER" | "ADMIN") {
    // The statements the loader sent, between two markers (see query-recorder.ts); the SQL is kept so a
    // mismatch can be read from the failure message.
    return recorder.current!.record(db, () => loadControlLibrary({ role }));
  }

  beforeAll(async () => {
    frameworkId = (await createFixtureFramework("169 queries")).id;
    ownerId = (await db.user.create({ data: { email: `test-169-q-${suffix}@example.com`, name: "Test 169 owner", role: "ADMIN" } })).id;
    facetId = (await db.deploymentFacet.create({ data: { name: `Test 169 queries Facet ${suffix}` } })).id;
    // Prisma skips a nested relation's query when no Control in the table has a related row, so on an unseeded
    // database the count would follow other files' fixtures. One Control with every relation keeps it fixed.
    await addControl({
      ownerId,
      originFrameworkId: frameworkId,
      deploymentFacets: { connect: [{ id: facetId }] },
    });
  });

  afterAll(async () => {
    await db.control.deleteMany({ where: { id: { in: controlIds } } });
    await db.deploymentFacet.deleteMany({ where: { id: facetId } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
  });

  it.each(["VIEWER", "ADMIN"] as const)("sends the same queries for more Controls and mappings (%s)", async (role) => {
    const before = await recordQueries(role);
    expect(before.length).toBeGreaterThan(0);
    for (let count = 0; count < 8; count += 1) await addControl();
    const after = await recordQueries(role);
    expect(after.length, describeQueries(before, after)).toBe(before.length);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/** The Control Library loader sends the same SQL however many Controls there are (#169). */
const counter = vi.hoisted(() => ({ queries: 0 }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  (client as unknown as { $on: (event: "query", cb: () => void) => void }).$on("query", () => {
    counter.queries += 1;
  });
  return { prisma: client };
});

import { prisma } from "@/lib/prisma";
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

  async function countQueries(role: "VIEWER" | "ADMIN") {
    counter.queries = 0;
    await loadControlLibrary({ role });
    return counter.queries;
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
    const before = await countQueries(role);
    expect(before).toBeGreaterThan(0);
    for (let count = 0; count < 8; count += 1) await addControl();
    expect(await countQueries(role)).toBe(before);
  });
});

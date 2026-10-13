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
  let next = 0;

  async function addControl() {
    const index = next++;
    const control = await db.control.create({
      data: {
        code: `TEST-169-Q-${suffix}-${index}`,
        title: `Test 169 queries ${index}`,
        description: "d",
        category: "Test",
        applicability: "ORGANIZATIONAL",
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
    await addControl();
  });

  afterAll(async () => {
    await db.control.deleteMany({ where: { id: { in: controlIds } } });
    await db.$disconnect();
  });

  it.each(["VIEWER", "ADMIN"] as const)("sends the same queries for more Controls and mappings (%s)", async (role) => {
    const before = await countQueries(role);
    expect(before).toBeGreaterThan(0);
    for (let count = 0; count < 8; count += 1) await addControl();
    expect(await countQueries(role)).toBe(before);
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * The Statement of Applicability loader issues the same number of SQL queries
 * however many Controls and Systems there are (#145: bulk queries, not one per
 * Control). `@/lib/prisma` is replaced by a client that counts the queries it
 * sends; the test grows the data (Controls, Systems, a Provider with Offerings)
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
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { loadStatementOfApplicability } from "../statement-of-applicability";

describe("loadStatementOfApplicability: constant number of queries (#145)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const db = prisma as PrismaClient;
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  let frameworkId: string;
  let ownerId: string;
  let providerId: string;

  async function addControl(applicability: "PER_SYSTEM" | "BOTH" | "ORGANIZATIONAL", index: number) {
    const control = await db.control.create({
      data: {
        code: `TEST-SOAQ-${suffix}-${applicability}-${index}`,
        title: `Test SOA queries ${index}`,
        description: "d",
        category: "Test",
        applicability,
        question: applicability === "ORGANIZATIONAL" ? null : "Does it?",
      },
    });
    controlIds.push(control.id);
    await mapControlsToFramework(frameworkId, [control.id]);
    return control.id;
  }

  async function addSystem(name: string, dependsOnProvider: boolean) {
    const system = await db.system.create({
      data: { name: `Test SOAQ ${name} ${suffix}`, ownerId, frameworkScopes: { connect: [{ id: frameworkId }] } },
    });
    systemIds.push(system.id);
    if (dependsOnProvider) await db.providerDependency.create({ data: { dependentId: system.id, providerId } });
    return system.id;
  }

  async function recordQueries() {
    // The statements the loader sent, between two markers (see query-recorder.ts); the SQL is kept so a
    // mismatch can be read from the failure message.
    return recorder.current!.record(db, () => loadStatementOfApplicability());
  }

  beforeAll(async () => {
    frameworkId = (await createFixtureFramework("SOA queries")).id;
    ownerId = (await db.user.create({ data: { email: `test-soaq-${suffix}@example.com`, name: "Test SOAQ", role: "SYSTEM_OWNER" } })).id;
    const perSystem = await addControl("PER_SYSTEM", 0);
    providerId = (
      await db.system.create({
        data: {
          name: `Test SOAQ Provider ${suffix}`,
          ownerId,
          status: "ONBOARDED",
          isProvider: true,
          frameworkScopes: { connect: [{ id: frameworkId }] },
        },
      })
    ).id;
    systemIds.push(providerId);
    await db.controlOffering.create({ data: { providerId, controlId: perSystem, type: "FULL" } });
    await addSystem("first", true);
  });

  afterAll(async () => {
    await db.system.deleteMany({ where: { id: { in: systemIds } } });
    await db.control.deleteMany({ where: { id: { in: controlIds } } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
  });

  it("sends the same queries for more Controls, Systems and Offerings", async () => {
    const before = await recordQueries();
    expect(before.length).toBeGreaterThan(0);

    for (let index = 1; index <= 6; index += 1) {
      await addControl(index % 2 === 0 ? "BOTH" : "PER_SYSTEM", index);
      await addSystem(`more-${index}`, true);
    }
    const offered = await addControl("PER_SYSTEM", 99);
    await db.controlOffering.create({ data: { providerId, controlId: offered, type: "SHARED", customerResponsibility: "x" } });
    await db.controlAssessment.create({ data: { systemId: systemIds[2], controlId: offered, status: "FULFILLED" } });

    const after = await recordQueries();
    expect(after.length, describeQueries(before, after)).toBe(before.length);
  });
});

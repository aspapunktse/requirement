import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * The Comparison loader sends the same number of SQL queries however many Controls and Systems there are (#371):
 * no query per Control, none per System. `@/lib/prisma` is replaced by a client that records its queries; the test
 * grows the data and checks the count did not move.
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
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { loadComparisonScores } from "../comparison-score-data";

describe("loadComparisonScores: constant number of queries (#371)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const db = prisma as PrismaClient;
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  let frameworkId = "";
  let facetId = "";
  let ownerId = "";
  let providerId = "";

  async function addControl(index: number, applicability: "PER_SYSTEM" | "BOTH") {
    const control = await db.control.create({
      data: {
        code: `TEST-CSQ-${suffix}-${index}`,
        title: `Test CSQ ${index}`,
        description: "d",
        category: "Test",
        applicability,
        question: "Does it?",
        deploymentFacets: { connect: [{ id: facetId }] },
      },
    });
    controlIds.push(control.id);
    await mapControlsToFramework(frameworkId, [control.id]);
    await db.frameworkFirstRoundControl.create({ data: { frameworkId, controlId: control.id } });
    return control.id;
  }

  async function addSystem(name: string, dependsOnProvider: boolean) {
    const system = await db.system.create({
      data: {
        name: `Test CSQ ${name} ${suffix}`,
        ownerId,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: [{ id: frameworkId }] },
      },
    });
    systemIds.push(system.id);
    if (dependsOnProvider) await db.providerDependency.create({ data: { dependentId: system.id, providerId } });
    await db.risk.create({ data: { systemId: system.id, title: "Test CSQ risk", description: "d", severity: "HIGH", likelihood: "LOW" } });
    return system.id;
  }

  const queries = (ids: string[]) => recorder.current!.record(db, () => loadComparisonScores(ids));

  beforeAll(async () => {
    frameworkId = (await createFixtureFramework("CSQ")).id;
    facetId = (await db.deploymentFacet.create({ data: { name: `Test CSQ Facet ${suffix}` } })).id;
    ownerId = (await db.user.create({ data: { email: `test-csq-${suffix}@example.com`, name: "Test CSQ", role: "SYSTEM_OWNER" } })).id;
    providerId = (
      await db.system.create({
        data: {
          name: `Test CSQ Provider ${suffix}`,
          ownerId,
          status: "ONBOARDED",
          isProvider: true,
          deploymentFacets: { connect: [{ id: facetId }] },
          frameworkScopes: { connect: [{ id: frameworkId }] },
        },
      })
    ).id;
    systemIds.push(providerId);
    const first = await addControl(0, "PER_SYSTEM");
    const both = await addControl(1, "BOTH");
    await db.controlOffering.create({ data: { providerId, controlId: first, type: "FULL" } });
    await db.organizationControlImplementation.create({ data: { controlId: both, status: "FULFILLED" } });
    await addSystem("first", true);
  });

  afterAll(async () => {
    await db.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await db.control.deleteMany({ where: { id: { in: controlIds } } });
    await db.deploymentFacet.delete({ where: { id: facetId } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
  });

  it("sends the same queries for one System and for five, with more Controls", async () => {
    const before = await queries([systemIds[1]]);
    expect(before.length).toBeGreaterThan(0);

    for (let index = 2; index <= 9; index += 1) {
      const controlId = await addControl(index, index % 2 === 0 ? "BOTH" : "PER_SYSTEM");
      if (index % 3 === 0) await db.controlOffering.create({ data: { providerId, controlId, type: "SHARED", customerResponsibility: "x" } });
    }
    for (let index = 1; index <= 4; index += 1) await addSystem(`more-${index}`, true);
    await db.controlAssessment.create({ data: { systemId: systemIds[1], controlId: controlIds[3], status: "FULFILLED", assessedById: ownerId } });

    const five = await queries(systemIds.slice(1, 6));
    expect(five.length, describeQueries(before, five)).toBe(before.length);
    // A bounded, small number: not one per Control or per System.
    expect(five.length).toBeLessThan(40);
  });
});

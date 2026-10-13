import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixtureFramework } from "@/test/framework-fixtures";
import { loadStatementOfApplicability } from "../statement-of-applicability";

/**
 * The loader reads one consistent snapshot (#150 follow-up): a Requirement deleted
 * while it runs (a Compliance Manager, the import loader) must not make Prisma find
 * a Control Mapping whose required Requirement is gone and throw.
 */
describe("loadStatementOfApplicability under concurrent catalog edits", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let frameworkId: string;
  let controlId: string;

  beforeAll(async () => {
    frameworkId = (await createFixtureFramework("SOA concurrent")).id;
    controlId = (
      await prisma.control.create({
        data: { code: `TEST-150-CONC-${suffix}`, title: "Test 150 concurrent", description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: controlId } });
  });

  it("never throws while Requirements with mappings are created and deleted", async () => {
    let running = true;
    let created = 0;
    const churn = (async () => {
      while (running) {
        const requirement = await prisma.requirement.create({
          data: {
            frameworkId,
            code: `TEST-150-CONC-${suffix}-${created}`,
            section: "Test",
            title: "Test 150 concurrent Requirement",
            text: "t",
            mappings: { create: [{ controlId, coverage: "FULL" }] },
          },
        });
        created += 1;
        await prisma.requirement.delete({ where: { id: requirement.id } });
      }
    })();

    const errors: unknown[] = [];
    try {
      for (let i = 0; i < 40; i += 1) {
        try {
          await loadStatementOfApplicability();
        } catch (error) {
          errors.push(error);
        }
      }
    } finally {
      running = false;
      await churn;
    }
    expect(created).toBeGreaterThan(0);
    expect(errors.map(String)).toEqual([]);
  }, 120_000);
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixtureFramework } from "@/test/framework-fixtures";
import { loadControlLibrary } from "../control-library";

/** A Requirement deleted while the loader runs must not make Prisma find a mapping whose Requirement is gone (#169). */
describe("loadControlLibrary under concurrent catalog edits", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let frameworkId: string;
  let controlId: string;

  beforeAll(async () => {
    frameworkId = (await createFixtureFramework("169 concurrent")).id;
    controlId = (
      await prisma.control.create({
        data: {
          code: `TEST-169-CONC-${suffix}`,
          title: "Test 169 concurrent",
          description: "d",
          category: "Test",
          applicability: "ORGANIZATIONAL",
        },
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
            code: `TEST-169-CONC-${suffix}-${created}`,
            section: "Test",
            title: "Test 169 concurrent Requirement",
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
          await loadControlLibrary({ role: "VIEWER" });
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

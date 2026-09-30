import { afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

/**
 * Shared test fixtures for Framework-driven applicability (ADR 0007).
 *
 * A Per-System/Both Control only applies to a System if it's mapped to a
 * Requirement of a Published Framework in the System's scope, and the base
 * Framework is always in scope. So a test that wants a fixture Control to
 * apply to a fixture System maps it to the base Framework with
 * `mapControlsToBase`. There is always exactly one base Framework while the
 * tests run: `vitest.global-setup.ts` uses the seeded one (dev DB) or creates
 * a fixture one for the whole run (CI's unseeded DB). Tests never create,
 * flip or delete a base themselves.
 *
 * Requirements created here are removed again in an `afterAll` this module
 * registers for whichever test file imports it (Control Mappings go with them).
 */

let counter = 0;
const createdRequirementIds: string[] = [];

/** The base Framework (guaranteed by vitest.global-setup.ts). */
export function getBaseFramework() {
  return prisma.framework.findFirstOrThrow({ where: { isBase: true } });
}

/**
 * One fixture Requirement in `frameworkId`, mapped (Full coverage) to every
 * control in `controlIds`. Returns the Requirement's id.
 */
export async function mapControlsToFramework(frameworkId: string, controlIds: string[]) {
  counter += 1;
  const code = `TEST-FX-${process.pid}-${Date.now()}-${counter}`;
  const requirement = await prisma.requirement.create({
    data: {
      frameworkId,
      code,
      section: "Test",
      title: `Test fixture Requirement ${code}`,
      text: "Test fixture Requirement",
      mappings: { create: controlIds.map((controlId) => ({ controlId, coverage: "FULL" as const })) },
    },
  });
  createdRequirementIds.push(requirement.id);
  return requirement.id;
}

/** Map `controlIds` to the base Framework, so they apply to every System (subject to their other scoping). */
export async function mapControlsToBase(controlIds: string[]) {
  const base = await getBaseFramework();
  return mapControlsToFramework(base.id, controlIds);
}

/** Delete every fixture Requirement this test file created (and their mappings). */
export async function cleanupFixtureRequirements() {
  const ids = createdRequirementIds.splice(0);
  if (ids.length > 0) await prisma.requirement.deleteMany({ where: { id: { in: ids } } });
}

afterAll(cleanupFixtureRequirements);

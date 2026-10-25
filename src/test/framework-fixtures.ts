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
 * An Organizational Control counts on EVERY System that has its Framework in
 * scope (#122), and every System has the base. So a fixture Organizational
 * Control must never be mapped to the base: it would count on other test files'
 * Systems (and on the seeded ones in the dev DB). Map it to a Published
 * non-base Framework from `createFixtureFramework` instead, and put only your
 * own fixture Systems in that Framework's scope.
 *
 * A base Requirement with no Control Mappings is Not Met on EVERY System, so
 * it moves other test files' figures too (#231). Deleting a Control deletes its
 * mappings, so a test must delete its fixture Requirements before its Controls:
 * call `cleanupFixtureRequirements()` first in the `afterAll` that deletes them
 * (this module's own `afterAll` is file-level, and Vitest runs it after a
 * `describe`'s), and `deleteFixtureRequirement` before deleting a Control
 * mid-file. The file-level cleanup fails the file if it finds a fixture base
 * Requirement left without mappings.
 *
 * Requirements and Frameworks created here are removed again in an `afterAll`
 * this module registers for whichever test file imports it (Control Mappings
 * go with them).
 */

let counter = 0;
const createdRequirementIds: string[] = [];
const createdFrameworkIds: string[] = [];

/** The base Framework (guaranteed by vitest.global-setup.ts). */
export function getBaseFramework() {
  return prisma.framework.findFirstOrThrow({ where: { isBase: true } });
}

/**
 * Refuse base fixtures that would count on other test files' Systems (#231): an
 * unmapped Requirement (Not Met everywhere), an Organizational Control (counts
 * on every System, #122) and a Per-System/Both Control without a Deployment
 * Facet (applies to every System). Scope the Control to a fixture Facet your own
 * Systems have, or map it to a Framework from `createFixtureFramework`.
 */
async function assertSafeForBase(controlIds: string[]) {
  if (controlIds.length === 0) {
    throw new Error("A fixture base Requirement needs at least one Control: unmapped, it is Not Met on every System (#231).");
  }
  const leaking = await prisma.control.findMany({
    where: { id: { in: controlIds }, OR: [{ applicability: "ORGANIZATIONAL" }, { deploymentFacets: { none: {} } }] },
    select: { code: true, applicability: true },
  });
  if (leaking.length > 0) {
    throw new Error(
      `Not mapping ${leaking.map((c) => `${c.code} (${c.applicability})`).join(", ")} to the base Framework: ` +
        "an Organizational Control, or one with no Deployment Facet, counts on every System, other test files' too. " +
        "Scope it to a fixture Deployment Facet, or map it to a Framework from createFixtureFramework (#231).",
    );
  }
}

/**
 * One fixture Requirement in `frameworkId`, mapped (Full coverage) to every
 * control in `controlIds`. Returns the Requirement's id.
 */
export async function mapControlsToFramework(frameworkId: string, controlIds: string[]) {
  const framework = await prisma.framework.findUniqueOrThrow({ where: { id: frameworkId }, select: { isBase: true } });
  if (framework.isBase) await assertSafeForBase(controlIds);
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

/**
 * A Published, non-base fixture Framework (lenient unless `strict`), for fixtures
 * that must not touch the base: an Organizational Control counts on every System
 * with its Framework in scope (#122). Only the fixture Systems should declare it.
 */
export async function createFixtureFramework(label: string, options: { strict?: boolean } = {}) {
  counter += 1;
  const framework = await prisma.framework.create({
    data: {
      name: `Test ${label} Framework ${process.pid}-${Date.now()}-${counter}`,
      version: "1",
      status: "PUBLISHED",
      strictComplianceRequired: options.strict ?? false,
    },
  });
  createdFrameworkIds.push(framework.id);
  return framework;
}

/** Map `controlIds` to the base Framework, so they apply to every System (subject to their other scoping). */
export async function mapControlsToBase(controlIds: string[]) {
  const base = await getBaseFramework();
  return mapControlsToFramework(base.id, controlIds);
}

/** Delete one fixture Requirement now, e.g. before deleting its Control mid-file. */
export async function deleteFixtureRequirement(requirementId: string) {
  const index = createdRequirementIds.indexOf(requirementId);
  if (index >= 0) createdRequirementIds.splice(index, 1);
  await prisma.requirement.deleteMany({ where: { id: requirementId } });
}

/**
 * Delete every fixture Requirement and Framework this test file created (and
 * their mappings). Call it first in an `afterAll` that deletes fixture Controls.
 * Throws, after cleaning up, if a fixture base Requirement had already lost all
 * its mappings: its Controls were deleted first, so for a while it counted as
 * Not Met on every System.
 */
export async function cleanupFixtureRequirements() {
  const ids = createdRequirementIds.splice(0);
  const orphaned =
    ids.length > 0
      ? await prisma.requirement.findMany({
          where: { id: { in: ids }, framework: { isBase: true }, mappings: { none: {} } },
          select: { code: true },
        })
      : [];
  if (ids.length > 0) await prisma.requirement.deleteMany({ where: { id: { in: ids } } });
  const frameworkIds = createdFrameworkIds.splice(0);
  if (frameworkIds.length > 0) await prisma.framework.deleteMany({ where: { id: { in: frameworkIds } } });
  if (orphaned.length > 0) {
    throw new Error(
      `${orphaned.length} fixture base Requirement(s) lost all their Control Mappings before cleanup ` +
        `(${orphaned.map((r) => r.code).join(", ")}), so they counted as Not Met on every System. ` +
        "Delete fixture Requirements before their Controls: call cleanupFixtureRequirements() first in afterAll, " +
        "or deleteFixtureRequirement() before deleting a Control mid-file (#231).",
    );
  }
}

afterAll(cleanupFixtureRequirements);

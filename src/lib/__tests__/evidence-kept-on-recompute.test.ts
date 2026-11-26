// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { diffApplicabilityOps, getStaleAssessments } from "@/lib/control-assessments";
import { finishRecompute, prepareRecompute } from "@/lib/applicability-recompute";
import { cleanupFixtureRequirements, mapControlsToBase } from "@/test/framework-fixtures";

/**
 * A row holding Evidence records is somebody's work even with no status yet (#455): when its Control stops applying,
 * both the classification path (`diffApplicabilityOps`) and the catalog recompute keep it as stale instead of deleting
 * it, which would cascade the records away. A row with neither is still removed. Fixtures only.
 */
const suffix = `${process.pid}-${Date.now()}`;
let userId: string;
let facetId: string;
let withEvidence: string;
let without: string;
const systems: string[] = [];

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `test-evkeep-${suffix}@example.com`, name: "Test EvKeep", role: "SYSTEM_OWNER" } })).id;
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test EvKeep Facet ${suffix}` } })).id;
  const control = (code: string) =>
    prisma.control.create({ data: { code: `EVK-${code}-${suffix}`, title: `EvKeep ${code}`, description: "d", category: "Security", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } } });
  withEvidence = (await control("A")).id;
  without = (await control("B")).id;
  await mapControlsToBase([withEvidence, without]);
});

afterAll(async () => {
  await cleanupFixtureRequirements();
  await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systems } } });
  await prisma.system.deleteMany({ where: { id: { in: systems } } });
  await prisma.control.deleteMany({ where: { id: { in: [withEvidence, without] } } });
  await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

async function freshSystem(label: string) {
  const system = await prisma.system.create({ data: { name: `Test EvKeep ${label} ${suffix}`, ownerId: userId, status: "DRAFT", deploymentFacets: { connect: [{ id: facetId }] } } });
  systems.push(system.id);
  const a = await prisma.controlAssessment.create({ data: { systemId: system.id, controlId: withEvidence } });
  await prisma.controlAssessment.create({ data: { systemId: system.id, controlId: without } });
  await prisma.evidenceItem.create({ data: { controlAssessmentId: a.id, kind: "LINK", url: "https://wiki.example.com/keep" } });
  return { system, assessmentId: a.id };
}
const controlIdsOf = (systemId: string) => prisma.controlAssessment.findMany({ where: { systemId }, select: { controlId: true } }).then((rows) => rows.map((r) => r.controlId));

describe("Evidence keeps its row when the Control stops applying (#455)", { timeout: 30_000 }, () => {
  it("classification path: diffApplicabilityOps removes the untouched row but keeps the one with Evidence", async () => {
    const { system, assessmentId } = await freshSystem("diff");
    const ops = diffApplicabilityOps(system.id, [{ id: withEvidence }, { id: without }], []);
    await ops.deleteOp;
    expect(await controlIdsOf(system.id)).toEqual([withEvidence]);
    expect(await prisma.evidenceItem.count({ where: { controlAssessmentId: assessmentId } })).toBe(1);
  });

  it("catalog recompute: keeps the row with Evidence as stale, removes the untouched one", async () => {
    const { system, assessmentId } = await freshSystem("recompute");
    const pending = await prepareRecompute({ systemsWhere: { id: system.id }, controlIds: [withEvidence, without] }, { snapshot: true });
    await prisma.system.update({ where: { id: system.id }, data: { deploymentFacets: { set: [] } } });
    const summary = await finishRecompute(pending, "Test EvKeep");
    expect(summary).toMatchObject({ removed: 1, stale: 1 });
    expect(await controlIdsOf(system.id)).toEqual([withEvidence]);
    expect(await prisma.evidenceItem.count({ where: { controlAssessmentId: assessmentId } })).toBe(1);
    const stale = await getStaleAssessments({ ...(await prisma.system.findUniqueOrThrow({ where: { id: system.id }, include: { deploymentFacets: true } })), frameworkScopes: [] } as never);
    expect(stale.map((row) => row.controlId)).toEqual([withEvidence]);
  });
});

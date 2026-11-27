// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { finishRecompute, prepareRecompute } from "@/lib/applicability-recompute";
import { cleanupFixtureRequirements, mapControlsToBase } from "@/test/framework-fixtures";

/**
 * Applicability recompute creating Control Assessment rows records their creation in the status history (#456, ADR 0019):
 * from=null, the row's status, no actor (the system), written in the same transaction as the rows. Fixtures only.
 */
const suffix = `${process.pid}-${Date.now()}`;
let userId: string;
let facetId: string;
let controlId: string;
let systemId: string;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { email: `test-rchist-${suffix}@example.com`, name: "Test RcHist", role: "SYSTEM_OWNER" } })).id;
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test RcHist Facet ${suffix}` } })).id;
  controlId = (await prisma.control.create({ data: { code: `RCH-${suffix}`, title: "RcHist", description: "d", category: "Security", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } } })).id;
  await mapControlsToBase([controlId]);
  systemId = (await prisma.system.create({ data: { name: `Test RcHist ${suffix}`, ownerId: userId, status: "DRAFT" } })).id;
});

afterAll(async () => {
  await cleanupFixtureRequirements();
  await prisma.statusChange.deleteMany({ where: { systemId } });
  await prisma.controlAssessment.deleteMany({ where: { systemId } });
  await prisma.system.deleteMany({ where: { id: systemId } });
  await prisma.control.deleteMany({ where: { id: controlId } });
  await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("recompute status history (#456)", { timeout: 30_000 }, () => {
  it("records each created row as from=null with no actor, and a second recompute records nothing more", async () => {
    const pending = await prepareRecompute({ systemsWhere: { id: systemId }, controlIds: [controlId] }, { snapshot: true });
    await prisma.system.update({ where: { id: systemId }, data: { deploymentFacets: { connect: [{ id: facetId }] } } });
    const summary = await finishRecompute(pending, "Test RcHist");
    expect(summary?.added).toBe(1);
    const row = await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId, controlId } } });
    const rows = await prisma.statusChange.findMany({ where: { subjectType: "CONTROL_ASSESSMENT", subjectId: row.id } });
    expect(rows.map((r) => [r.fromStatus, r.toStatus, r.actorId, r.systemId, r.controlId])).toEqual([[null, row.status, null, systemId, controlId]]);

    const again = await prepareRecompute({ systemsWhere: { id: systemId }, controlIds: [controlId] }, { snapshot: true });
    await finishRecompute(again, "Test RcHist");
    expect(await prisma.statusChange.count({ where: { subjectType: "CONTROL_ASSESSMENT", subjectId: row.id } })).toBe(1);
  });
});

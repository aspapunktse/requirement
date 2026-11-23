import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBoundaryCompliance } from "@/lib/compliance-boundary-data";
import { memberState } from "@/lib/compliance-boundary";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

/**
 * The Compliance Percentage per Boundary Framework (#422), against real Postgres. Pooled over the counted members (Approved or
 * Onboarded, not closed); a Draft, In review or closed member adds nothing. Fixtures only, removed in `afterAll`.
 */
const suffix = `${process.pid}-${Date.now()}`;
const N = (label: string) => `Test #422 ${label} ${suffix}`;

describe("getBoundaryCompliance", { timeout: 90_000 }, () => {
  let ownerId: string;
  let facet1: string;
  let facet2: string;
  let fw: string;
  let emptyFw: string;
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  const boundaryIds: string[] = [];

  const makeSystem = async (label: string, data: { status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "ONBOARDED" | "REJECTED"; facets: string[]; closed?: boolean; fulfilled: string[] }) => {
    const system = await prisma.system.create({
      data: {
        name: N(label),
        ownerId,
        status: data.status,
        evaluationClosedAt: data.closed ? new Date() : null,
        deploymentFacets: { connect: data.facets.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    await prisma.controlAssessment.createMany({ data: data.fulfilled.map((controlId) => ({ systemId: system.id, controlId, status: "FULFILLED" as const })) });
    return system.id;
  };
  const makeBoundary = async (label: string, frameworkIds: string[], members: string[]) => {
    const boundary = await prisma.complianceBoundary.create({
      data: { name: N(label), frameworks: { create: frameworkIds.map((frameworkId) => ({ frameworkId })) }, systems: { create: members.map((systemId) => ({ systemId })) } },
    });
    boundaryIds.push(boundary.id);
    return boundary.id;
  };

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `test-422-owner-${suffix}@example.com`, name: "Test #422 Owner", role: "SYSTEM_OWNER" } })).id;
    facet1 = (await prisma.deploymentFacet.create({ data: { name: N("Facet 1") } })).id;
    facet2 = (await prisma.deploymentFacet.create({ data: { name: N("Facet 2") } })).id;
    fw = (await createFixtureFramework("422")).id;
    emptyFw = (await createFixtureFramework("422 empty")).id;
    // c1 and c2 apply to facet 1; c3 only to facet 2. One Requirement per Control.
    for (const [code, facet] of [["C1", facet1], ["C2", facet1], ["C3", facet2]] as const) {
      const control = await prisma.control.create({
        data: { code: `T422-${code}-${suffix}`, title: N(code), description: "d", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facet }] } },
      });
      controlIds.push(control.id);
      await mapControlsToFramework(fw, [control.id]);
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.complianceBoundary.deleteMany({ where: { id: { in: boundaryIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facet1, facet2] } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  }, 60_000);

  it("pools Met over applicable across the counted members, not an average, and leaves out Draft, In review and closed ones", async () => {
    const [c1, c2, c3] = controlIds;
    // Onboarded: 3 applicable, 3 Met. Approved: 2 applicable, 1 Met. Pooled 4/5 = 80%; an average of 100% and 50% would be 75%.
    const onboarded = await makeSystem("onboarded", { status: "ONBOARDED", facets: [facet1, facet2], fulfilled: [c1, c2, c3] });
    const approved = await makeSystem("approved", { status: "APPROVED", facets: [facet1], fulfilled: [c1] });
    // None of these may count: they would pull the figure down to 4/11.
    const draft = await makeSystem("draft", { status: "DRAFT", facets: [facet1, facet2], fulfilled: [] });
    const review = await makeSystem("review", { status: "IN_REVIEW", facets: [facet1, facet2], fulfilled: [] });
    const rejected = await makeSystem("rejected", { status: "REJECTED", closed: true, facets: [facet1, facet2], fulfilled: [] });
    const closedOnboarded = await makeSystem("closed onboarded", { status: "ONBOARDED", closed: true, facets: [facet1, facet2], fulfilled: [] });
    const boundary = await makeBoundary("pooled", [fw, emptyFw], [onboarded, approved, draft, review, rejected, closedOnboarded]);

    const rows = await prisma.system.findMany({ where: { id: { in: [onboarded, approved, draft, review, rejected, closedOnboarded] } }, select: { status: true, evaluationClosedAt: true } });
    expect(rows.filter((row) => memberState(row) === "OPERATING")).toHaveLength(2); // the same rule the where uses

    const result = await getBoundaryCompliance(boundary, [fw, emptyFw]);
    expect(result[0]).toEqual({ frameworkId: fw, met: 4, applicable: 5, percentage: 80 });
    // A Framework with no Requirements has nothing applicable: null, not 0%.
    expect(result[1]).toEqual({ frameworkId: emptyFw, met: 0, applicable: 0, percentage: null });
  });

  it("is null when no member is counted, and for a Boundary without members", async () => {
    const draft = await makeSystem("only draft", { status: "DRAFT", facets: [facet1], fulfilled: [controlIds[0]] });
    const onlyDraft = await makeBoundary("only draft", [fw], [draft]);
    const empty = await makeBoundary("empty", [fw], []);
    expect(await getBoundaryCompliance(onlyDraft, [fw])).toEqual([{ frameworkId: fw, met: 0, applicable: 0, percentage: null }]);
    expect(await getBoundaryCompliance(empty, [fw])).toEqual([{ frameworkId: fw, met: 0, applicable: 0, percentage: null }]);
  });
});

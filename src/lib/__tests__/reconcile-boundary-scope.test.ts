import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { reconcileBoundaryScope } from "@/lib/reconcile-boundary-scope";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";

/**
 * The one-off reconciliation of Boundary members that joined before a Boundary's Frameworks took effect (#419), against real
 * Postgres. Memberships are inserted with Prisma directly, the way #418 left them: no Assessments, no Change Review. Fixtures
 * only; the run is limited to this file's Systems so it never touches other data.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test #419 reconcile ${label} ${suffix}`;

describe("reconcileBoundaryScope", { timeout: 90_000 }, () => {
  let ownerId: string;
  let memberId: string;
  let facetId: string;
  let groupId: string;
  let fw: string;
  let c1: string;
  let c2: string;
  const systemIds: string[] = [];
  let boundaryId: string;

  const makeSystem = async (label: string, status: "DRAFT" | "ONBOARDED", declared: string[] = []) => {
    const system = await prisma.system.create({
      data: {
        name: NAME(label),
        ownerId,
        status,
        sensitivityLevel: 3,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: declared.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    await prisma.complianceBoundarySystem.create({ data: { boundaryId, systemId: system.id } });
    return system.id;
  };
  const rows = async (id: string) => (await prisma.controlAssessment.findMany({ where: { systemId: id, controlId: { in: [c1, c2] } }, orderBy: { controlId: "asc" } })).map((row) => `${row.controlId}:${row.status}`);
  const count = async (id: string) => ({
    events: await prisma.changeEvent.count({ where: { systemId: id } }),
    reviews: await prisma.changeReview.count({ where: { systemId: id } }),
    rows: await prisma.controlAssessment.count({ where: { systemId: id } }),
  });

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `test-419r-owner-${suffix}@example.com`, name: "Test #419r Owner", role: "SYSTEM_OWNER" } })).id;
    memberId = (await prisma.user.create({ data: { email: `test-419r-member-${suffix}@example.com`, name: "Test #419r Member", role: "SYSTEM_OWNER" } })).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: NAME("Facet") } })).id;
    groupId = (await prisma.reviewGroup.create({ data: { name: NAME("Group"), members: { connect: [{ id: memberId }] } } })).id;
    fw = (await createFixtureFramework("419 reconcile")).id;
    await prisma.framework.update({ where: { id: fw }, data: { reviewGroupId: groupId } });
    const controls = [];
    for (const code of ["C1", "C2"]) {
      controls.push(
        await prisma.control.create({
          data: { code: `T419R-${code}-${suffix}`, title: NAME(code), description: "d", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } },
        }),
      );
    }
    [c1, c2] = controls.map((control) => control.id);
    await mapControlsToFramework(fw, [c1, c2]);
    boundaryId = (await prisma.complianceBoundary.create({ data: { name: NAME("Boundary"), frameworks: { create: [{ frameworkId: fw }] } } })).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.complianceBoundary.deleteMany({ where: { id: boundaryId } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: [c1, c2] } } });
    await prisma.framework.updateMany({ where: { id: fw }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: groupId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
  }, 60_000);

  it("creates the missing Assessments, logs one event and starts a Change Review on an Onboarded member, and a second run changes nothing", async () => {
    const draft = await makeSystem("draft", "DRAFT");
    const onboarded = await makeSystem("onboarded", "ONBOARDED");
    const declared = await makeSystem("declared", "ONBOARDED", [fw]); // declared it itself: nothing to reconcile
    await prisma.controlAssessment.createMany({ data: [c1, c2].map((controlId) => ({ systemId: declared, controlId })) });
    const only = { onlySystemIds: [draft, onboarded, declared] };
    const declaredBefore = await count(declared);

    const dry = await reconcileBoundaryScope({ apply: false, ...only });
    expect(dry.systems.find((system) => system.systemId === draft)).toMatchObject({ added: 2, removed: 0, changeReview: "none" });
    expect(dry.systems.find((system) => system.systemId === onboarded)).toMatchObject({ added: 2, changeReview: "started or widened" });
    expect(await rows(draft)).toEqual([]); // a dry run writes nothing
    expect(await rows(onboarded)).toEqual([]);
    expect(await prisma.changeReview.count({ where: { systemId: onboarded } })).toBe(0);

    const first = await reconcileBoundaryScope({ apply: true, ...only });
    expect(first).toMatchObject({ applied: true, added: 4, removed: 0, reviews: 1 });
    for (const id of [draft, onboarded]) expect(await rows(id)).toEqual([c1, c2].sort().map((controlId) => `${controlId}:NOT_STARTED`));
    const events = await prisma.changeEvent.findMany({ where: { systemId: onboarded, action: "CLASSIFICATION_CHANGED" } });
    expect(events).toHaveLength(1);
    expect(events[0].detail).toBe("Framework Scope reconciled for Compliance Boundary membership (+2/-0 Control Assessment(s))");
    const [review] = await prisma.changeReview.findMany({ where: { systemId: onboarded }, include: { controls: true } });
    expect(review.status).toBe("OPEN");
    expect(review.controls.map((row) => row.controlId).sort()).toEqual([c1, c2].sort());
    expect(await prisma.changeReview.count({ where: { systemId: draft } })).toBe(0);
    expect(await count(declared)).toEqual(declaredBefore);

    const after = await Promise.all([draft, onboarded, declared].map(count));
    const second = await reconcileBoundaryScope({ apply: true, ...only });
    expect(second).toMatchObject({ added: 0, removed: 0, reviews: 0 });
    expect(await Promise.all([draft, onboarded, declared].map(count))).toEqual(after);
  });

  it("does not start another Change Review once the first was decided", async () => {
    const system = await makeSystem("decided", "ONBOARDED");
    await reconcileBoundaryScope({ apply: true, onlySystemIds: [system] });
    await prisma.changeReview.updateMany({ where: { systemId: system }, data: { status: "ACCEPTED" } });
    const before = await count(system);
    await reconcileBoundaryScope({ apply: true, onlySystemIds: [system] });
    expect(await count(system)).toEqual(before);
  });
});

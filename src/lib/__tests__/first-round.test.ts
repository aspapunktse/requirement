import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { dropOrphanedFirstRoundMarkings, firstRoundControlIdsForSystem, isControlFirstRound } from "@/lib/first-round";
import { cleanupFixtureRequirements, createFixtureFramework, getBaseFramework, mapControlsToBase, mapControlsToFramework } from "@/test/framework-fixtures";

/**
 * "Is Control X first round for System Y" (#319): first round when the owner of ANY Published Framework in the
 * System's effective Framework Scope (base always) marked it, and the Control is still mapped to that Framework.
 * Every fixture is created here (CI's database is not seeded) and removed in afterAll.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;

describe("first-round Controls for a System", () => {
  let ownerId: string;
  let facetId: string;
  let inScope: { id: string };
  let outOfScope: { id: string };
  let draft: { id: string };
  let system: { id: string };
  let otherSystem: { id: string };
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  let draftFrameworkId: string;

  async function makeControl(tag: string, withFacet = false) {
    const control = await prisma.control.create({
      data: {
        code: `TEST-FR-${tag}-${SUFFIX}`,
        title: `Test FR ${tag}`,
        description: "d",
        category: "Test",
        applicability: withFacet ? "PER_SYSTEM" : "ORGANIZATIONAL",
        question: withFacet ? "Done?" : null,
        mandatory: false,
        ...(withFacet ? { deploymentFacets: { connect: [{ id: facetId }] } } : {}),
      },
    });
    controlIds.push(control.id);
    return control.id;
  }
  const mark = (frameworkId: string, controlId: string) => prisma.frameworkFirstRoundControl.create({ data: { frameworkId, controlId } });

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `test-fr-${SUFFIX}@example.com`, name: "Test FR owner", role: "SYSTEM_OWNER" } })).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test FR Facet ${SUFFIX}` } })).id;
    inScope = await createFixtureFramework("First round in scope");
    outOfScope = await createFixtureFramework("First round out of scope");
    draft = await prisma.framework.create({ data: { name: `Test FR Draft ${SUFFIX}`, version: "1", status: "DRAFT" } });
    draftFrameworkId = draft.id;
    system = await prisma.system.create({
      data: { name: `Test FR System ${SUFFIX}`, ownerId, deploymentFacets: { connect: [{ id: facetId }] }, frameworkScopes: { connect: [{ id: inScope.id }, { id: draft.id }] } },
    });
    otherSystem = await prisma.system.create({ data: { name: `Test FR Other System ${SUFFIX}`, ownerId, deploymentFacets: { connect: [{ id: facetId }] } } });
    systemIds.push(system.id, otherSystem.id);
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.requirement.deleteMany({ where: { frameworkId: draftFrameworkId } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.deleteMany({ where: { id: draftFrameworkId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("is first round when a Framework in the System's scope marked it, and not for a System without that Framework", async () => {
    const control = await makeControl("IN");
    await mapControlsToFramework(inScope.id, [control]);
    await mark(inScope.id, control);
    expect(await isControlFirstRound(control, system.id)).toBe(true);
    expect(await isControlFirstRound(control, otherSystem.id)).toBe(false);
  });

  it("is not first round when only a Framework outside the System's scope marked it", async () => {
    const control = await makeControl("OUT");
    await mapControlsToFramework(outOfScope.id, [control]);
    await mark(outOfScope.id, control);
    expect(await isControlFirstRound(control, system.id)).toBe(false);
    expect(await isControlFirstRound(control, otherSystem.id)).toBe(false);
  });

  it("is first round on every System when the base Framework marked it", async () => {
    const control = await makeControl("BASE", true);
    await mapControlsToBase([control]);
    await mark((await getBaseFramework()).id, control);
    expect(await isControlFirstRound(control, system.id)).toBe(true);
    expect(await isControlFirstRound(control, otherSystem.id)).toBe(true);
  });

  it("does not count a Draft Framework in the System's scope, until it is published", async () => {
    const control = await makeControl("DRAFT");
    await prisma.requirement.create({
      data: { frameworkId: draft.id, code: `FR-D-${SUFFIX}`, section: "T", title: "t", text: "t", mappings: { create: [{ controlId: control, coverage: "FULL" }] } },
    });
    await mark(draft.id, control);
    expect(await isControlFirstRound(control, system.id)).toBe(false);
    await prisma.framework.update({ where: { id: draft.id }, data: { status: "PUBLISHED" } });
    expect(await isControlFirstRound(control, system.id)).toBe(true);
    await prisma.framework.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    expect(await isControlFirstRound(control, system.id)).toBe(false);
  });

  it("ignores a marking whose Control has no mapping to the marking Framework, even if another in-scope Framework maps it", async () => {
    const control = await makeControl("STRAY");
    await mark(inScope.id, control); // marked, but mapped to no Requirement at all
    expect(await isControlFirstRound(control, system.id)).toBe(false);
    await mapControlsToFramework(outOfScope.id, [control]); // mapped to a different Framework, not in scope
    expect(await isControlFirstRound(control, system.id)).toBe(false);
    await mapControlsToFramework(inScope.id, [control]);
    expect(await isControlFirstRound(control, system.id)).toBe(true);
  });

  it("answers for a set of Controls at once, narrowed by controlIds, and is empty when nothing is marked", async () => {
    const marked = await makeControl("SET1");
    const plain = await makeControl("SET2");
    await mapControlsToFramework(inScope.id, [marked, plain]);
    await mark(inScope.id, marked);
    expect([...(await firstRoundControlIdsForSystem(system.id, { controlIds: [marked, plain] }))]).toEqual([marked]);
    expect((await firstRoundControlIdsForSystem(system.id)).has(marked)).toBe(true);
    expect((await firstRoundControlIdsForSystem(system.id)).has(plain)).toBe(false);
    expect((await firstRoundControlIdsForSystem(otherSystem.id, { controlIds: [plain] })).size).toBe(0);
  });

  it("dropOrphanedFirstRoundMarkings removes only markings with no mapping left", async () => {
    const mapped = await makeControl("DROP1");
    const orphan = await makeControl("DROP2");
    await mapControlsToFramework(outOfScope.id, [mapped]);
    await mark(outOfScope.id, mapped);
    await mark(outOfScope.id, orphan);
    const removed = await prisma.$transaction((tx) => dropOrphanedFirstRoundMarkings(tx, outOfScope.id, [mapped, orphan]));
    expect(removed).toBe(1);
    const left = await prisma.frameworkFirstRoundControl.findMany({ where: { frameworkId: outOfScope.id, controlId: { in: [mapped, orphan] } } });
    expect(left.map((m) => m.controlId)).toEqual([mapped]);
  });
});

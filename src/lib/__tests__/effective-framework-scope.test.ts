import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getApplicableControls, getStaleAssessments } from "@/lib/control-assessments";
import { effectiveScopeIds, withEffectiveScope, systemsWithFrameworkInScope } from "@/lib/effective-framework-scope";
import { getSystemFrameworkScopes, getSystemFrameworkScopeSources, systemsInScopeOf } from "@/lib/framework-scope";
import { getVisibleSystem, visibleSystemsWhere } from "@/lib/system-visibility";
import { getSystemFrameworkRequirements } from "@/lib/requirement-status";
import { getComplianceForSystems } from "@/lib/compliance";
import { loadStatementOfApplicability } from "@/lib/statement-of-applicability";
import { effectiveScopeFrameworkIds, effectiveScopeFrameworkIdsForSystems, isControlFirstRound } from "@/lib/first-round";
import { groupsWithRemit } from "@/lib/review-steps";
import { reviewGroupScopeWhere } from "@/lib/review-group-visibility";
import { readOg1 } from "@/lib/evaluation-og1";
import { scopedSystemsWhere } from "@/lib/business-risk-owner";
import { readSuggestions } from "@/lib/framework-suggestions-data";
import { countVisibleSystemsByFramework } from "@/app/frameworks/frameworks-data";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";

/**
 * Every reader of a System's Framework Scope reads the *effective* scope (#419): the declared Frameworks plus the Frameworks of the
 * Compliance Boundaries the System is in. The fixture System `viaBoundary` declares nothing and is in one Boundary holding the
 * fixture Framework, so each assertion here passes only if the reader looks at the Boundary. `bare` is in no Boundary and is the
 * control: it must never show up. Fixtures only; nothing maps to the base Framework.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test #419 readers ${label} ${suffix}`;

describe("effective Framework Scope: every reader (#419)", { timeout: 90_000 }, () => {
  let adminId: string;
  let ownerId: string;
  let memberId: string;
  let facetId: string;
  let groupId: string;
  let frameworkId: string;
  let controlId: string;
  let requirementId: string;
  let boundaryId: string;
  let viaBoundary: string;
  let bare: string;
  let typeId: string;
  let reviewGroupMember: { id: string; role: "SYSTEM_OWNER" };

  const admin = () => ({ id: adminId, role: "ADMIN" as const });

  beforeAll(async () => {
    adminId = (await prisma.user.create({ data: { email: `test-419r-admin-${suffix}@example.com`, name: "Test #419 readers admin", role: "ADMIN" } })).id;
    ownerId = (await prisma.user.create({ data: { email: `test-419r-owner-${suffix}@example.com`, name: "Test #419 readers owner", role: "SYSTEM_OWNER" } })).id;
    memberId = (await prisma.user.create({ data: { email: `test-419r-member-${suffix}@example.com`, name: "Test #419 readers member", role: "SYSTEM_OWNER" } })).id;
    reviewGroupMember = { id: memberId, role: "SYSTEM_OWNER" };
    facetId = (await prisma.deploymentFacet.create({ data: { name: NAME("Facet") } })).id;
    groupId = (await prisma.reviewGroup.create({ data: { name: NAME("Group"), members: { connect: [{ id: memberId }] } } })).id;
    frameworkId = (await createFixtureFramework("419 readers")).id;
    await prisma.framework.update({ where: { id: frameworkId }, data: { reviewGroupId: groupId } });
    controlId = (
      await prisma.control.create({
        data: { code: `T419R-${suffix}`, title: NAME("Control"), description: "d", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } },
      })
    ).id;
    requirementId = await mapControlsToFramework(frameworkId, [controlId]);
    await prisma.frameworkFirstRoundControl.create({ data: { frameworkId, controlId } });
    typeId = (await prisma.informationType.create({ data: { name: NAME("Type"), sensitivity: { connect: { level: 1 } }, suggestedFrameworks: { connect: [{ id: frameworkId }] } } })).id;

    const make = async (label: string, extra: object = {}) =>
      (
        await prisma.system.create({
          data: { name: NAME(label), ownerId, status: "DRAFT", sensitivityLevel: 3, deploymentFacets: { connect: [{ id: facetId }] }, ...extra },
        })
      ).id;
    viaBoundary = await make("via boundary", {
      evaluationStage: "OG1",
      evaluationStageEnteredAt: new Date(Date.now() - 60_000),
      informationTypes: { connect: [{ id: typeId }] },
    });
    bare = await make("bare", { informationTypes: { connect: [{ id: typeId }] } });
    boundaryId = (
      await prisma.complianceBoundary.create({
        data: { name: NAME("Boundary"), frameworks: { create: [{ frameworkId }] }, systems: { create: [{ systemId: viaBoundary }] } },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await prisma.complianceBoundary.deleteMany({ where: { id: boundaryId } });
    await prisma.system.deleteMany({ where: { id: { in: [viaBoundary, bare] } } });
    await prisma.informationType.deleteMany({ where: { id: typeId } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.framework.updateMany({ where: { id: frameworkId }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: groupId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, ownerId, memberId] } } });
  }, 60_000);

  const classification = async (id: string) => (await getVisibleSystem(admin(), id))!;

  it("the helper merges declared and Boundary Frameworks, sorted and without duplicates", () => {
    const merged = effectiveScopeIds({
      frameworkScopes: [{ id: "b" }, { id: "a" }],
      boundaryMemberships: [{ boundary: { frameworks: [{ frameworkId: "c" }, { frameworkId: "a" }] } }, { boundary: { frameworks: [] } }],
    });
    expect(merged).toEqual(["a", "b", "c"]);
    const system = withEffectiveScope({ id: "s", frameworkScopes: [{ id: "x" }], boundaryMemberships: [{ boundary: { frameworks: [{ frameworkId: "y" }] } }] });
    expect(system).toEqual({ id: "s", frameworkScopes: [{ id: "x" }, { id: "y" }] });
  });

  it("applicability: the Control of a Boundary's Framework applies to a member, and to no one else", async () => {
    expect((await getApplicableControls(await classification(viaBoundary))).map((control) => control.id)).toContain(controlId);
    expect((await getApplicableControls(await classification(bare))).map((control) => control.id)).not.toContain(controlId);
    expect((await getStaleAssessments(await classification(viaBoundary))).map((row) => row.controlId)).not.toContain(controlId);
  });

  it("the Framework Scope helpers list the Framework with its Boundary as the source", async () => {
    expect((await getSystemFrameworkScopes(viaBoundary)).map((framework) => framework.id)).toContain(frameworkId);
    expect((await getSystemFrameworkScopes(bare)).map((framework) => framework.id)).not.toContain(frameworkId);
    const source = (await getSystemFrameworkScopeSources(viaBoundary)).find((entry) => entry.framework.id === frameworkId);
    expect(source).toMatchObject({ declared: false, boundaries: [{ id: boundaryId }] });
  });

  it("Systems in scope of a Framework: the list, the where-filter and the per-Framework count include a member", async () => {
    const ids = async (where: object) => (await prisma.system.findMany({ where: { AND: [where, { id: { in: [viaBoundary, bare] } }] }, select: { id: true } })).map((system) => system.id);
    expect(await ids(systemsInScopeOf({ id: frameworkId, isBase: false }))).toEqual([viaBoundary]);
    expect(await ids(systemsWithFrameworkInScope({ id: frameworkId }))).toEqual([viaBoundary]);
    const counts = await prisma.$transaction((tx) => countVisibleSystemsByFramework(admin(), tx));
    expect(counts.countFor({ id: frameworkId, isBase: false })).toBe(1);
    expect((await prisma.system.findMany({ where: { AND: [await visibleSystemsWhere(admin()), { id: viaBoundary }] } })).length).toBe(1);
  });

  it("Requirement status and Compliance Percentage: the Framework's Requirements count on a member", async () => {
    const requirements = await getSystemFrameworkRequirements(await classification(viaBoundary));
    const mine = requirements.find((entry) => entry.framework.id === frameworkId);
    expect(mine?.rows.map((row) => row.requirementId)).toContain(requirementId);
    expect((await getSystemFrameworkRequirements(await classification(bare))).some((entry) => entry.framework.id === frameworkId)).toBe(false);

    const scope = await getComplianceForSystems({ id: { in: [viaBoundary, bare] } }, { frameworkId });
    expect(scope.bySystem.find((row) => row.systemId === viaBoundary)?.applicable).toBe(1);
    expect(scope.bySystem.find((row) => row.systemId === bare)?.applicable).toBe(0);
    expect(scope.applicable).toBe(1);
  });

  it("the Statement of Applicability counts the member as a System the Control applies to", async () => {
    const row = (await loadStatementOfApplicability()).find((entry) => entry.controlId === controlId);
    expect(row?.appliesToSystemCount).toBe(1);
  });

  it("first-round markings follow the Boundary's Framework", async () => {
    expect(await effectiveScopeFrameworkIds(viaBoundary)).toContain(frameworkId);
    expect(await effectiveScopeFrameworkIds(bare)).not.toContain(frameworkId);
    const bulk = await effectiveScopeFrameworkIdsForSystems([viaBoundary, bare]);
    expect([...(bulk.get(viaBoundary) ?? [])]).toContain(frameworkId);
    expect([...(bulk.get(bare) ?? [])]).not.toContain(frameworkId);
    expect(await isControlFirstRound(controlId, viaBoundary)).toBe(true);
    expect(await isControlFirstRound(controlId, bare)).toBe(false);
  });

  it("Review Groups: the group has a remit on the member, and its members see the System", async () => {
    expect([...(await groupsWithRemit(prisma, await classification(viaBoundary))).keys()]).toContain(groupId);
    expect([...(await groupsWithRemit(prisma, await classification(bare))).keys()]).not.toContain(groupId);

    const where = await reviewGroupScopeWhere(memberId);
    expect(where).not.toBeNull();
    const seen = (await prisma.system.findMany({ where: { AND: [where!, { id: { in: [viaBoundary, bare] } }] }, select: { id: true } })).map((system) => system.id);
    expect(seen).toEqual([viaBoundary]);
    void reviewGroupMember;
  });

  it("OG1 lists the group as a participant on a member's first round", async () => {
    const og1 = await prisma.$transaction((tx) => readOg1(tx, viaBoundary));
    expect(og1?.firstRound.has(controlId)).toBe(true);
    expect(og1?.participants.map((participant) => participant.reviewGroupId)).toContain(groupId);
  });

  it("a Business Risk Owner assigned the Framework sees a member System", async () => {
    const where = scopedSystemsWhere({ businessUnitIds: [], frameworkIds: [frameworkId], baseFrameworkIds: [] });
    const seen = (await prisma.system.findMany({ where: { AND: [where, { id: { in: [viaBoundary, bare] } }] }, select: { id: true } })).map((system) => system.id);
    expect(seen).toEqual([viaBoundary]);
  });

  it("Information Type suggestions treat a Boundary's Framework as already in scope", async () => {
    const stateOf = async (id: string) => (await readSuggestions(prisma, id)).find((suggestion) => suggestion.framework.id === frameworkId)?.state;
    expect(await stateOf(viaBoundary)).toBe("in-scope");
    expect(await stateOf(bare)).toBe("open");
  });
});

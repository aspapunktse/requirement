import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { BASE_REVIEW_STEP_NAME, loadReviewRounds } from "@/lib/review-steps";
import { createFixtureFramework, mapControlsToBase, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";

/**
 * Review Steps derived from Framework Scope (#198), against real Postgres. CI's DB is migrated but not
 * seeded, so every row is a `Test #198 …` fixture: Frameworks that are not the base, Controls scoped to
 * a fixture Deployment Facet, Systems that declare the fixture Frameworks.
 */
describe("Review Steps derived from Framework Scope", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let ownerId: string;
  let facetId: string;
  let groupA: { id: string; name: string };
  let groupEmpty: { id: string; name: string };
  let fwA1: string; // group A
  let fwA2: string; // group A too
  let fwNoGroup: string;
  let fwEmpty: string; // group "empty", only a base Control is mapped to it
  let fwDraft: string; // a Draft Framework tied to group A
  const controlIds: string[] = [];
  const systemIds: string[] = [];

  async function makeControl(label: string) {
    const control = await prisma.control.create({
      data: {
        code: `T198-${label}-${suffix}`,
        title: `Test #198 ${label}`,
        description: "Test",
        category: "Test",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: facetId }] },
      },
    });
    controlIds.push(control.id);
    return control.id;
  }

  /** A System declaring `scope`, with an open Review Round. */
  async function makeSystem(scope: string[], status: "IN_REVIEW" | "DRAFT" = "IN_REVIEW") {
    const system = await prisma.system.create({
      data: {
        name: `Test #198 System ${suffix}-${systemIds.length}`,
        ownerId,
        status,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: scope.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    const round = await prisma.reviewRound.create({ data: { systemId: system.id } });
    return { system, round };
  }

  const load = (systemId: string) => loadReviewRounds(systemId);

  const names = (steps: { name: string }[]) => steps.map((step) => step.name);

  beforeAll(async () => {
    ownerId = (
      await prisma.user.create({
        data: { email: `test-198-steps-${suffix}@example.com`, name: "Test #198 Owner", role: "SYSTEM_OWNER" },
      })
    ).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test #198 Facet ${suffix}` } })).id;
    groupA = await prisma.reviewGroup.create({ data: { name: `Test #198 Group A ${suffix}` } });
    groupEmpty = await prisma.reviewGroup.create({ data: { name: `Test #198 Group Empty ${suffix}` } });

    fwA1 = (await createFixtureFramework("198 a1")).id;
    fwA2 = (await createFixtureFramework("198 a2")).id;
    fwNoGroup = (await createFixtureFramework("198 nogroup")).id;
    fwEmpty = (await createFixtureFramework("198 empty")).id;
    fwDraft = (
      await prisma.framework.create({ data: { name: `Test #198 Draft ${suffix}`, version: "1", status: "DRAFT" } })
    ).id;
    await prisma.framework.updateMany({ where: { id: { in: [fwA1, fwA2, fwDraft] } }, data: { reviewGroupId: groupA.id } });
    await prisma.framework.update({ where: { id: fwEmpty }, data: { reviewGroupId: groupEmpty.id } });

    const supplementaryA1 = await makeControl("supp-a1");
    const supplementaryA2 = await makeControl("supp-a2");
    const supplementaryNoGroup = await makeControl("supp-nogroup");
    const supplementaryDraft = await makeControl("supp-draft");
    // Mapped to the base Framework AND to the "empty" group's Framework: a base Control stays with the base step.
    const baseControl = await makeControl("base");
    await mapControlsToFramework(fwA1, [supplementaryA1]);
    await mapControlsToFramework(fwA2, [supplementaryA2]);
    await mapControlsToFramework(fwNoGroup, [supplementaryNoGroup]);
    await mapControlsToFramework(fwDraft, [supplementaryDraft]);
    await mapControlsToBase([baseControl]);
    await mapControlsToFramework(fwEmpty, [baseControl]);
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // rounds and Approvals cascade
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.updateMany({
      where: { reviewGroupId: { in: [groupA.id, groupEmpty.id] } },
      data: { reviewGroupId: null },
    });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: [groupA.id, groupEmpty.id] } } });
    await prisma.framework.deleteMany({ where: { id: fwDraft } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  });

  it("always has the base step, open, and no group step when no grouped Framework is in scope", async () => {
    const { system } = await makeSystem([]);
    const { steps } = await load(system.id);
    expect(steps).toEqual([{ reviewGroupId: null, name: BASE_REVIEW_STEP_NAME, status: "OPEN" }]);
  });

  it("adds an open step for a group with a Control in its remit, next to the base step", async () => {
    const { system } = await makeSystem([fwA1]);
    const { steps } = await load(system.id);
    expect(steps).toEqual([
      { reviewGroupId: null, name: BASE_REVIEW_STEP_NAME, status: "OPEN" },
      { reviewGroupId: groupA.id, name: groupA.name, status: "OPEN" },
    ]);
  });

  it("gives one step for two in-scope Frameworks that share a group", async () => {
    const { system } = await makeSystem([fwA1, fwA2]);
    expect(names((await load(system.id)).steps)).toEqual([BASE_REVIEW_STEP_NAME, groupA.name]);
  });

  it("adds no step for a Framework with no group; its Controls fall to the base step", async () => {
    const { system } = await makeSystem([fwNoGroup]);
    expect(names((await load(system.id)).steps)).toEqual([BASE_REVIEW_STEP_NAME]);
  });

  it("adds no step for a group whose only Control in scope is a base Control", async () => {
    const { system } = await makeSystem([fwEmpty]);
    expect(names((await load(system.id)).steps)).toEqual([BASE_REVIEW_STEP_NAME]);
  });

  it("adds no step for a Draft Framework in scope", async () => {
    const { system } = await makeSystem([fwDraft]);
    expect(names((await load(system.id)).steps)).toEqual([BASE_REVIEW_STEP_NAME]);
  });

  it("adds no step when the group's Controls are scoped to a Deployment Facet the System doesn't have", async () => {
    const { system } = await makeSystem([fwA1]);
    const otherFacet = await prisma.deploymentFacet.create({ data: { name: `Test #198 Other Facet ${suffix}` } });
    try {
      await prisma.system.update({
        where: { id: system.id },
        data: { deploymentFacets: { set: [{ id: otherFacet.id }] } },
      });
      expect(names((await load(system.id)).steps)).toEqual([BASE_REVIEW_STEP_NAME]);
    } finally {
      await prisma.system.update({ where: { id: system.id }, data: { deploymentFacets: { set: [] } } });
      await prisma.deploymentFacet.delete({ where: { id: otherFacet.id } });
    }
  });

  it("adds and drops steps immediately when the Framework Scope changes", async () => {
    const { system } = await makeSystem([fwNoGroup]);
    expect(names((await load(system.id)).steps)).toEqual([BASE_REVIEW_STEP_NAME]);

    await prisma.system.update({ where: { id: system.id }, data: { frameworkScopes: { connect: [{ id: fwA1 }] } } });
    expect(names((await load(system.id)).steps)).toEqual([BASE_REVIEW_STEP_NAME, groupA.name]);

    await prisma.system.update({ where: { id: system.id }, data: { frameworkScopes: { disconnect: [{ id: fwA1 }] } } });
    expect(names((await load(system.id)).steps)).toEqual([BASE_REVIEW_STEP_NAME]);
  });

  it("reads each step's status from the current round's Approvals only", async () => {
    const { system, round } = await makeSystem([fwA1]);
    await prisma.approval.create({
      data: { systemId: system.id, reviewRoundId: round.id, approverId: ownerId, decision: "APPROVED", comment: "ok" },
    });
    let loaded = await load(system.id);
    expect(loaded.steps.map((s) => [s.name, s.status])).toEqual([
      [BASE_REVIEW_STEP_NAME, "APPROVED"],
      [groupA.name, "OPEN"],
    ]);

    await prisma.approval.create({
      data: {
        systemId: system.id,
        reviewRoundId: round.id,
        reviewGroupId: groupA.id,
        approverId: ownerId,
        decision: "REJECTED",
        comment: "no",
      },
    });
    loaded = await load(system.id);
    expect(loaded.steps.map((s) => s.status)).toEqual(["APPROVED", "REJECTED"]);

    // A resubmission starts a new round: the earlier round's decisions don't count towards it.
    const next = await prisma.reviewRound.create({
      data: { systemId: system.id, submittedAt: new Date(round.submittedAt.getTime() + 60_000) },
    });
    loaded = await load(system.id);
    expect(loaded.currentRoundId).toBe(next.id);
    expect(loaded.steps.map((s) => s.status)).toEqual(["OPEN", "OPEN"]);
    expect(loaded.rounds.map((r) => r.id)).toEqual([next.id, round.id]);
  });

  it("ignores a decision by a group that has no step in the round", async () => {
    const { system, round } = await makeSystem([fwNoGroup]);
    await prisma.approval.create({
      data: {
        systemId: system.id,
        reviewRoundId: round.id,
        reviewGroupId: groupA.id,
        approverId: ownerId,
        decision: "APPROVED",
      },
    });
    expect((await load(system.id)).steps).toEqual([{ reviewGroupId: null, name: BASE_REVIEW_STEP_NAME, status: "OPEN" }]);
  });

  it("has no steps and no current round when the System isn't In Review, but still lists its rounds", async () => {
    const { system, round } = await makeSystem([fwA1], "DRAFT");
    const loaded = await load(system.id);
    expect(loaded.steps).toEqual([]);
    expect(loaded.currentRoundId).toBeNull();
    expect(loaded.rounds.map((r) => r.id)).toEqual([round.id]);
  });

  it("reads an In Review System with no round as all steps open", async () => {
    const { system, round } = await makeSystem([fwA1]);
    await prisma.reviewRound.delete({ where: { id: round.id } });
    const loaded = await load(system.id);
    expect(loaded.currentRoundId).toBeNull();
    expect(loaded.steps.map((s) => s.status)).toEqual(["OPEN", "OPEN"]);
  });

  it("reads the System's status and scope from the database, not from the caller", async () => {
    const { system } = await makeSystem([fwA1]);
    expect((await load(system.id)).steps).toHaveLength(2);
    expect(await loadReviewRounds(`missing-${suffix}`)).toEqual({ rounds: [], currentRoundId: null, steps: [] });
  });
});

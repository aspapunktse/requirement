import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  BASE_REVIEW_STEP_NAME,
  inSubset,
  participantList,
  participantsContainingControl,
  participantsOver,
  participantsToReopen,
  remitGroupsByControl,
} from "@/lib/review-participation";
import { SYSTEM_FOR_STEPS } from "@/lib/review-steps";
import { createFixtureFramework, mapControlsToBase, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";

describe("Review participation: pure parts", () => {
  it("reads a subset given as ids or as a predicate; no subset means every Control", () => {
    expect(inSubset(undefined, "x")).toBe(true);
    expect(inSubset(new Set(["a"]), "a")).toBe(true);
    expect(inSubset(new Set(["a"]), "b")).toBe(false);
    expect(inSubset((id) => id.startsWith("r1-"), "r1-9")).toBe(true);
    expect(inSubset((id) => id.startsWith("r1-"), "r2-9")).toBe(false);
  });

  it("lists the base review first when it is in, then the groups by name; no base when not asked", () => {
    const groups = new Map([
      ["g-b", "Beta"],
      ["g-a", "Alpha"],
    ]);
    expect(participantList({ base: true, groups })).toEqual([
      { reviewGroupId: null, name: BASE_REVIEW_STEP_NAME },
      { reviewGroupId: "g-a", name: "Alpha" },
      { reviewGroupId: "g-b", name: "Beta" },
    ]);
    expect(participantList({ base: false, groups }).map((p) => p.name)).toEqual(["Alpha", "Beta"]);
    expect(participantList({ base: true, groups: new Map() }).map((p) => p.name)).toEqual([BASE_REVIEW_STEP_NAME]);
  });

  it("reopens only participants that are in the remit and have an outcome, whatever the outcome is", () => {
    const participants = [
      { reviewGroupId: null, verdict: "FULL" },
      { reviewGroupId: "g1", verdict: "FULL" },
      { reviewGroupId: "g2", verdict: null },
    ];
    const reopened = participantsToReopen(participants, new Set<string | null>([null, "g2"]), (p) => p.verdict !== null);
    expect(reopened.map((p) => p.reviewGroupId)).toEqual([null]);
    expect(participantsToReopen(participants, new Set(), () => true)).toEqual([]);
  });
});

/** Participation over a Control subset (#326), against real Postgres. Fixture rows only; CI's DB is not seeded. */
describe("Review participation over a Control subset", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let ownerId: string;
  let facetId: string;
  const groups: { id: string; name: string }[] = [];
  const controls = {} as Record<"g1" | "g2" | "base", string>;
  const controlIds: string[] = [];
  let systemId: string;

  async function makeControl(label: string) {
    const control = await prisma.control.create({
      data: {
        code: `T326-${label}-${suffix}`,
        title: `Test #326 ${label}`,
        description: "Test",
        category: "Test",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: facetId }] },
      },
    });
    controlIds.push(control.id);
    return control.id;
  }

  const loadSystem = () => prisma.system.findUniqueOrThrow({ where: { id: systemId }, include: SYSTEM_FOR_STEPS });
  const groupIds = (participation: { groups: Map<string, string> }) => [...participation.groups.keys()].sort();

  beforeAll(async () => {
    ownerId = (
      await prisma.user.create({
        data: { email: `test-326-owner-${suffix}@example.com`, name: "Test #326 Owner", role: "SYSTEM_OWNER" },
      })
    ).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test #326 Facet ${suffix}` } })).id;
    groups.push(await prisma.reviewGroup.create({ data: { name: `Test #326 Group 1 ${suffix}` } }));
    groups.push(await prisma.reviewGroup.create({ data: { name: `Test #326 Group 2 ${suffix}` } }));
    const fw1 = await createFixtureFramework("326 one");
    const fw2 = await createFixtureFramework("326 two");
    await prisma.framework.update({ where: { id: fw1.id }, data: { reviewGroupId: groups[0].id } });
    await prisma.framework.update({ where: { id: fw2.id }, data: { reviewGroupId: groups[1].id } });

    controls.g1 = await makeControl("g1");
    controls.g2 = await makeControl("g2");
    controls.base = await makeControl("base");
    await mapControlsToFramework(fw1.id, [controls.g1]);
    await mapControlsToFramework(fw2.id, [controls.g2]);
    await mapControlsToBase([controls.base]);

    const system = await prisma.system.create({
      data: {
        name: `Test #326 System ${suffix}`,
        ownerId,
        status: "IN_REVIEW",
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: [{ id: fw1.id }, { id: fw2.id }] },
      },
    });
    systemId = system.id;
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls (#231)
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.updateMany({
      where: { reviewGroupId: { in: groups.map((group) => group.id) } },
      data: { reviewGroupId: null },
    });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groups.map((group) => group.id) } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  });

  it("takes every group with a Control in its remit when no subset is given", async () => {
    const participation = await participantsOver(prisma, await loadSystem(), { includeBase: true });
    expect(groupIds(participation)).toEqual(groups.map((group) => group.id).sort());
    expect(participation.base).toBe(true);
  });

  it("takes no part for a group with no Control in the subset, given as ids or as a predicate", async () => {
    const system = await loadSystem();
    const byIds = await participantsOver(prisma, system, { controls: new Set([controls.g1]), includeBase: false });
    expect(groupIds(byIds)).toEqual([groups[0].id]);
    const byPredicate = await participantsOver(prisma, system, {
      controls: (id) => id === controls.g2,
      includeBase: false,
    });
    expect(groupIds(byPredicate)).toEqual([groups[1].id]);
    const none = await participantsOver(prisma, system, { controls: new Set([controls.base]), includeBase: false });
    expect(groupIds(none)).toEqual([]);
  });

  it("includes the base review when asked, even if the subset holds no base Control, and not otherwise", async () => {
    const system = await loadSystem();
    const subset = new Set([controls.g1]);
    const withBase = await participantsOver(prisma, system, { controls: subset, includeBase: true });
    expect(participantList(withBase).map((p) => p.name)).toEqual([BASE_REVIEW_STEP_NAME, groups[0].name]);
    const without = await participantsOver(prisma, system, { controls: subset, includeBase: false });
    expect(participantList(without).map((p) => p.name)).toEqual([groups[0].name]);
    const empty = await participantsOver(prisma, system, { controls: new Set(), includeBase: true });
    expect(participantList(empty).map((p) => p.name)).toEqual([BASE_REVIEW_STEP_NAME]);
  });

  it("narrows the per-Control remit read to the subset", async () => {
    const system = await loadSystem();
    const all = await remitGroupsByControl(prisma, system);
    expect([...all.keys()].sort()).toEqual([controls.g1, controls.g2].sort());
    const narrowed = await remitGroupsByControl(prisma, system, undefined, new Set([controls.g2]));
    expect([...narrowed.keys()]).toEqual([controls.g2]);
    expect((await remitGroupsByControl(prisma, system, controls.g1, new Set([controls.g2]))).size).toBe(0);
  });

  it("reopens on an edit inside the subset the group whose remit includes it, and nothing for an edit outside it", async () => {
    const system = await loadSystem();
    const scope = { controls: new Set([controls.g1]), includeBase: true };
    expect(await participantsContainingControl(prisma, system, controls.g1, scope)).toEqual(new Set([groups[0].id]));
    // Outside the subset: nobody's remit in this participation, not even the base review.
    expect(await participantsContainingControl(prisma, system, controls.g2, scope)).toEqual(new Set());
    expect(await participantsContainingControl(prisma, system, controls.base, scope)).toEqual(new Set());
    // Without the full subset the same edits reach their owners as before.
    const all = { includeBase: true };
    expect(await participantsContainingControl(prisma, system, controls.g2, all)).toEqual(new Set([groups[1].id]));
    expect(await participantsContainingControl(prisma, system, controls.base, all)).toEqual(new Set([null]));
  });

  it("leaves the base review out of an edit's reach when the participation excludes it", async () => {
    const system = await loadSystem();
    const scope = { controls: new Set([controls.base, controls.g1]), includeBase: false };
    expect(await participantsContainingControl(prisma, system, controls.base, scope)).toEqual(new Set());
    expect(await participantsContainingControl(prisma, system, controls.g1, scope)).toEqual(new Set([groups[0].id]));
  });
});

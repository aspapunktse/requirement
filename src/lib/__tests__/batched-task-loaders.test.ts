import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOpenVerdictsForUser, readOg1, userCanGiveVerdict } from "@/lib/evaluation-og1";
import { getOpenRecommendationsForUser, readOagReview, userCanRecommend } from "@/lib/evaluation-oag";
import { getChangeReviewDecisionTasksForUser, getOpenChangeReviewRecommendationsForUser, readOpenChangeReview } from "@/lib/change-review";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";

/**
 * The My tasks loaders are set-based (#389): one read of the remits, verdicts, Recommendations and Change Reviews of every System
 * instead of a few per System. Each must give exactly what the per-System readers (`readOg1`, `readOagReview`,
 * `readOpenChangeReview`) give for the same Systems. Fixtures only (CI's database is migrated, not seeded).
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

describe("Set-based My tasks loaders equal the per-System readers (#389)", { timeout: 90_000 }, () => {
  const users: Record<string, { id: string; role: UserRole }> = {};
  const groupIds: string[] = [];
  const frameworkIds: string[] = [];
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  let facetId: string;

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-389-${key}-${SUFFIX}@example.com`, name: `Test 389 ${key} ${SUFFIX}`, role } });
    users[key] = { id: user.id, role };
  }

  async function makeSystem(data: Record<string, unknown>, ownerKey = "owner") {
    const system = await prisma.system.create({
      data: {
        name: `Test 389 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users[ownerKey].id,
        businessSystemOwnerId: users.bso.id,
        sensitivityLevel: 3,
        evaluationTrack: "FULL",
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: frameworkIds.map((id) => ({ id })) },
        ...data,
      },
    });
    systemIds.push(system.id);
    return system;
  }

  const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);

  beforeAll(async () => {
    for (const [key, role] of [["owner", "SYSTEM_OWNER"], ["bso", "SYSTEM_OWNER"], ["reviewer", "REVIEWER"], ["admin", "ADMIN"], ["member1", "SYSTEM_OWNER"], ["member2", "VIEWER"], ["viewer", "VIEWER"]] as [string, UserRole][]) {
      await makeUser(key, role);
    }
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 389 Facet ${SUFFIX}` } })).id;
    for (const [i, member] of [[0, "member1"], [1, "member2"]] as [number, string][]) {
      const group = await prisma.reviewGroup.create({ data: { name: `Test 389 Group ${i + 1} ${SUFFIX}`, members: { connect: [{ id: users[member].id }] } } });
      groupIds.push(group.id);
      const framework = await createFixtureFramework(`389 f${i + 1}`);
      frameworkIds.push(framework.id);
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: group.id } });
      const control = await prisma.control.create({
        data: { code: `T389-${i}-${SUFFIX}`, title: `Test 389 Control ${i}`, description: "Test", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } },
      });
      controlIds.push(control.id);
      await mapControlsToFramework(framework.id, [control.id]);
    }

    // OAG review 1: group 1 has recommended, one older Recommendation from before the stage was entered is ignored.
    const oag1 = await makeSystem({ evaluationStage: "OAG_REVIEW_1", evaluationStageEnteredAt: ago(600) });
    await prisma.recommendation.create({ data: { systemId: oag1.id, stage: "OAG_REVIEW_1", reviewGroupId: groupIds[0], givenById: users.member1.id, kind: "RECOMMEND", comment: "Fine", givenAt: ago(300) } });
    await prisma.recommendation.create({ data: { systemId: oag1.id, stage: "OAG_REVIEW_1", reviewGroupId: groupIds[1], givenById: users.member2.id, kind: "RECOMMEND", comment: "Old", givenAt: ago(900) } });
    // OAG review 2: group 2's Recommendation was voided (reopened).
    const oag2 = await makeSystem({ evaluationStage: "OAG_REVIEW_2", evaluationStageEnteredAt: ago(600) });
    await prisma.recommendation.create({
      data: { systemId: oag2.id, stage: "OAG_REVIEW_2", reviewGroupId: groupIds[1], givenById: users.member2.id, kind: "RECOMMEND", comment: "Was fine", givenAt: ago(400), voidedAt: ago(200), voidReason: "Controls changed" },
    });
    // Owned by a group member: never their own task. A closed one is left out of the OAG list.
    await makeSystem({ evaluationStage: "OAG_REVIEW_1", evaluationStageEnteredAt: ago(600) }, "member1");
    await makeSystem({ evaluationStage: "OAG_REVIEW_1", evaluationStageEnteredAt: ago(600), evaluationClosedAt: ago(10) });

    // OG1: one with the base verdict given, one with group 2's verdict voided, one owned by a member.
    const og1a = await makeSystem({ evaluationStage: "OG1", evaluationStageEnteredAt: ago(600) });
    await prisma.trackVerdict.create({ data: { systemId: og1a.id, reviewGroupId: null, verdictById: users.reviewer.id, verdict: "FULL", comment: "Full", givenAt: ago(300) } });
    const og1b = await makeSystem({ evaluationStage: "OG1", evaluationStageEnteredAt: ago(600) });
    await prisma.trackVerdict.create({
      data: { systemId: og1b.id, reviewGroupId: groupIds[1], verdictById: users.member2.id, verdict: "SELF", comment: "Was self", givenAt: ago(400), voidedAt: ago(200), voidReason: "A control changed" },
    });
    await makeSystem({ evaluationStage: "OG1", evaluationStageEnteredAt: ago(600) }, "member1");

    // Change Reviews: one with group 1's Recommendation given, one untouched (the BSO decides only the first once every group has recommended).
    const reviewed = await makeSystem({ status: "ONBOARDED" });
    const review = await prisma.changeReview.create({
      data: { systemId: reviewed.id, controls: { create: [{ controlId: controlIds[0], reviewGroupId: groupIds[0] }, { controlId: controlIds[1], reviewGroupId: groupIds[1] }, { controlId: controlIds[0], reviewGroupId: null }] } },
    });
    for (const [group, user] of [[null, "reviewer"], [groupIds[0], "member1"], [groupIds[1], "member2"]] as [string | null, string][]) {
      await prisma.recommendation.create({ data: { systemId: reviewed.id, changeReviewId: review.id, reviewGroupId: group, givenById: users[user].id, kind: "RECOMMEND", comment: "Yes", givenAt: ago(100) } });
    }
    const pending = await makeSystem({ status: "ONBOARDED" });
    const pendingReview = await prisma.changeReview.create({ data: { systemId: pending.id, controls: { create: [{ controlId: controlIds[0], reviewGroupId: groupIds[0] }, { controlId: controlIds[1], reviewGroupId: null }] } } });
    await prisma.recommendation.create({
      data: { systemId: pending.id, changeReviewId: pendingReview.id, reviewGroupId: groupIds[0], givenById: users.member1.id, kind: "RECOMMEND", comment: "Was yes", givenAt: ago(100), voidedAt: ago(50), voidReason: "Controls were added" },
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // Recommendations, verdicts and Change Reviews cascade
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.updateMany({ where: { id: { in: frameworkIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groupIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  }, 60_000);

  const mine = <T extends { system: { id: string } }>(tasks: T[]) => tasks.filter((task) => systemIds.includes(task.system.id));
  const key = (task: { system: { id: string }; participant: { reviewGroupId: string | null } }) => `${task.system.id}|${task.participant.reviewGroupId}`;
  /** The tasks as the System id and the participant (the System's own columns are not what is compared), in a fixed order. */
  const sorted = <T extends { system: { id: string }; participant: { reviewGroupId: string | null } }>(tasks: T[]) =>
    [...tasks].sort((a, b) => key(a).localeCompare(key(b))).map((task) => ({ systemId: task.system.id, participant: task.participant, stage: "stage" in task ? task.stage : undefined }));
  const groupsOf = async (userId: string) => (await prisma.reviewGroup.findMany({ where: { members: { some: { id: userId } } }, select: { id: true } })).map((g) => g.id);

  it("OAG: the Recommendations a user owes equal those found System by System", async () => {
    for (const k of Object.keys(users)) {
      const user = users[k];
      const groups = await groupsOf(user.id);
      const expected = await prisma.$transaction(async (tx) => {
        const tasks = [];
        for (const systemId of systemIds) {
          const review = await readOagReview(tx, systemId);
          if (!review || review.system.ownerId === user.id || review.system.evaluationClosedAt) continue;
          for (const participant of review.participants) {
            if (participant.recommendation === null && userCanRecommend(user, review.system.ownerId, groups, participant.reviewGroupId)) {
              tasks.push({ system: { id: review.system.id }, stage: review.stage, participant });
            }
          }
        }
        return tasks;
      });
      expect(JSON.stringify(sorted(mine(await getOpenRecommendationsForUser(user)))), k).toBe(JSON.stringify(sorted(expected)));
    }
    // The fixture is not vacuous: an Admin owes the open ones, and a voided Recommendation shows as reopened.
    const admin = mine(await getOpenRecommendationsForUser(users.admin));
    expect(admin.length).toBeGreaterThanOrEqual(4);
    expect(admin.some((task) => task.participant.reopened)).toBe(true);
  });

  it("OG1: the verdicts a user owes equal those found System by System", async () => {
    for (const k of Object.keys(users)) {
      const user = users[k];
      const groups = await groupsOf(user.id);
      const expected = await prisma.$transaction(async (tx) => {
        const tasks = [];
        for (const systemId of systemIds) {
          const og1 = await readOg1(tx, systemId);
          if (!og1 || og1.system.ownerId === user.id) continue;
          for (const participant of og1.participants) {
            if (participant.verdict === null && userCanGiveVerdict(user, og1.system.ownerId, groups, participant.reviewGroupId)) tasks.push({ system: { id: og1.system.id }, participant });
          }
        }
        return tasks;
      });
      expect(JSON.stringify(sorted(mine(await getOpenVerdictsForUser(user)))), k).toBe(JSON.stringify(sorted(expected)));
    }
    const admin = mine(await getOpenVerdictsForUser(users.admin));
    // The base review's open verdicts on the two Systems that lack one; the owned System and the one with a live base verdict are left out.
    expect(admin.length).toBeGreaterThanOrEqual(2);
    expect(admin.every((task) => task.participant.verdict === null)).toBe(true);
  });

  it("Change Review: the Recommendations and decisions a user owes equal those found System by System", async () => {
    for (const k of Object.keys(users)) {
      const user = users[k];
      const groups = await groupsOf(user.id);
      const reviews = await prisma.$transaction(async (tx) => {
        const found = [];
        for (const systemId of systemIds) {
          const open = await readOpenChangeReview(tx, systemId);
          const system = await tx.system.findUniqueOrThrow({ where: { id: systemId }, select: { id: true, ownerId: true, businessSystemOwnerId: true } });
          if (open) found.push({ system, participants: open.participants });
        }
        return found;
      });
      const expectedRecommendations = reviews
        .filter(({ system }) => system.ownerId !== user.id)
        .flatMap(({ system, participants }) =>
          user.role !== "ADMIN" && user.role !== "REVIEWER" && groups.length === 0
            ? []
            : participants.filter((p) => p.recommendation === null && userCanRecommend(user, system.ownerId, groups, p.reviewGroupId)).map((participant) => ({ system: { id: system.id }, participant })),
        );
      expect(JSON.stringify(sorted(mine(await getOpenChangeReviewRecommendationsForUser(user)))), k).toBe(JSON.stringify(sorted(expectedRecommendations)));

      const expectedDecisions = reviews
        .filter(({ system, participants }) => system.businessSystemOwnerId === user.id && system.ownerId !== user.id && participants.every((p) => p.recommendation !== null))
        .map(({ system }) => system.id)
        .sort();
      expect((await getChangeReviewDecisionTasksForUser(user)).map((system) => system.id).filter((id) => systemIds.includes(id)).sort(), k).toEqual(expectedDecisions);
    }
    // Not vacuous: the BSO decides the review every group has recommended on, and an Admin owes the reopened one.
    expect((await getChangeReviewDecisionTasksForUser(users.bso)).filter((s) => systemIds.includes(s.id))).toHaveLength(1);
    expect(mine(await getOpenChangeReviewRecommendationsForUser(users.admin)).length).toBeGreaterThan(0);
  });
});

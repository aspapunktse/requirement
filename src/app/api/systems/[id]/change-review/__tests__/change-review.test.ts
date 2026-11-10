import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvaluationStage, RecommendationKind, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { changeSystemClassification } from "@/lib/system-classification-change";
import { applyFrameworkScopeDeclared } from "@/lib/framework-scope";
import { sendBackTargets } from "@/lib/gate-decisions";
import { getOpenChangeReviewRecommendationsForUser, getChangeReviewDecisionTasksForUser, getChangeReviewsNeedingBsoForOwner } from "@/lib/change-review";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { GET as getReview } from "../route";
import { POST as giveRecommendation } from "../recommendations/route";
import { POST as decide } from "../decision/route";

/**
 * Change Review on an Onboarded System (#334). Fixtures only (CI's database is migrated, not seeded): two Review Groups, each with its own
 * Framework; Controls scoped to fixture Deployment Facets so a change of facets (or of Framework Scope) adds Controls to a group's remit.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

function requestAs(userId: string | null, url: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, { method: init?.method, headers, body: init?.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Change Review (#334)", { timeout: 90_000 }, () => {
  const users: Record<string, { id: string; name: string }> = {};
  const groups: { id: string; name: string }[] = [];
  const frameworkIds: string[] = [];
  const controls: { id: string; code: string }[] = [];
  const facets: string[] = []; // F (controls 0 and 1), G (control 2, group 0), H (none)
  const systemIds: string[] = [];

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-334-${key}-${SUFFIX}@example.com`, name: `Test 334 ${key} ${SUFFIX}`, role } });
    users[key] = { id: user.id, name: user.name };
  }

  async function makeSystem(options: { facets?: number[]; scope?: number[]; status?: "ONBOARDED" | "APPROVED"; staged?: boolean; bso?: boolean; track?: "SELF" | "FULL" } = {}) {
    const staged = options.staged ?? true;
    const system = await prisma.system.create({
      data: {
        name: `Test 334 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users.owner.id,
        businessSystemOwnerId: options.bso === false ? null : users.bso.id,
        sensitivityLevel: 3,
        status: options.status ?? "ONBOARDED",
        ...(staged ? { evaluationStage: "OG3" as EvaluationStage, evaluationTrack: options.track ?? "FULL", evaluationStageEnteredAt: new Date(Date.now() - 60_000) } : {}),
        deploymentFacets: { connect: (options.facets ?? []).map((i) => ({ id: facets[i] })) },
        frameworkScopes: { connect: (options.scope ?? [0, 1]).map((i) => ({ id: frameworkIds[i] })) },
      },
    });
    systemIds.push(system.id);
    return system;
  }

  const load = (id: string) => prisma.system.findUniqueOrThrow({ where: { id }, include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } } });
  const changeFacets = async (id: string, facetIndexes: number[]) => changeSystemClassification(await load(id), { deploymentFacetIds: facetIndexes.map((i) => facets[i]) }, users.owner.id);
  const declare = async (id: string, frameworkIndex: number) => applyFrameworkScopeDeclared(await load(id), { id: frameworkIds[frameworkIndex], name: "Test" }, users.owner.id);
  const reviews = (id: string) => prisma.changeReview.findMany({ where: { systemId: id }, include: { controls: true }, orderBy: { startedAt: "asc" } });
  const events = (id: string, action?: string) => prisma.changeEvent.findMany({ where: { systemId: id, ...(action ? { action: action as never } : {}) }, orderBy: { createdAt: "asc" } });
  const stateOf = (id: string) => prisma.system.findUniqueOrThrow({ where: { id } });
  async function snapshot(id: string) {
    return JSON.stringify({ system: await stateOf(id), reviews: await reviews(id), recs: await prisma.recommendation.findMany({ where: { systemId: id } }), events: (await events(id)).map((e) => e.id) });
  }
  const url = (id: string, slug = "") => `/api/systems/${id}/change-review${slug}`;
  const recommend = (userKey: string, systemId: string, changeReviewId: string, reviewGroupId: string | null, kind: RecommendationKind = "RECOMMEND", comment = "Fine") =>
    giveRecommendation(requestAs(users[userKey].id, url(systemId, "/recommendations"), { method: "POST", body: { changeReviewId, reviewGroupId, kind, comment } }), ctxFor(systemId));
  const decideAs = (userKey: string, systemId: string, body: unknown) =>
    decide(requestAs(users[userKey].id, url(systemId, "/decision"), { method: "POST", body }), ctxFor(systemId));

  /** An Onboarded System with an open Change Review for both groups, every group having recommended. */
  async function reviewedSystem(options: { staged?: boolean; bso?: boolean; recommend?: boolean } = {}) {
    const system = await makeSystem({ facets: [], ...options });
    await changeFacets(system.id, [0]);
    const [review] = await reviews(system.id);
    expect(review.status).toBe("OPEN");
    if (options.recommend !== false) {
      expect((await recommend("member0", system.id, review.id, groups[0].id)).status).toBe(201);
      expect((await recommend("member1", system.id, review.id, groups[1].id)).status).toBe(201);
    }
    return { system, review };
  }

  beforeAll(async () => {
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("bso", "SYSTEM_OWNER");
    await makeUser("admin", "ADMIN");
    await makeUser("member0", "SYSTEM_OWNER");
    await makeUser("member1", "VIEWER");
    await makeUser("outsider", "SYSTEM_OWNER");

    for (const name of ["F", "G", "H"]) facets.push((await prisma.deploymentFacet.create({ data: { name: `Test 334 Facet ${name} ${SUFFIX}` } })).id);
    const plan: { group: number; facet: number }[] = [{ group: 0, facet: 0 }, { group: 1, facet: 0 }, { group: 0, facet: 1 }];
    for (const [i, member] of [[0, "member0"], [1, "member1"]] as [number, string][]) {
      const group = await prisma.reviewGroup.create({ data: { name: `Test 334 Group ${i + 1} ${SUFFIX}`, members: { connect: [{ id: users[member].id }] } } });
      groups.push({ id: group.id, name: group.name });
      const framework = await createFixtureFramework(`334 f${i + 1}`);
      frameworkIds.push(framework.id);
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: group.id } });
    }
    for (const [i, { group, facet }] of plan.entries()) {
      const control = await prisma.control.create({
        data: { code: `T334-${i}-${SUFFIX}`, title: `Test 334 Control ${i}`, description: "Test", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facets[facet] }] } },
      });
      controls.push({ id: control.id, code: control.code });
      await mapControlsToFramework(frameworkIds[group], [control.id]);
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // Change Reviews and Recommendations cascade
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controls.map((c) => c.id) } } });
    await prisma.framework.updateMany({ where: { id: { in: frameworkIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: facets } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  }, 60_000);

  describe("Starting, widening and not starting", () => {
    it("starts a review for the groups whose remit a classification change grew, and the System stays Onboarded", async () => {
      const system = await makeSystem({ facets: [] });
      await changeFacets(system.id, [0]);
      const [review] = await reviews(system.id);
      expect(review.status).toBe("OPEN");
      expect(review.controls.map((c) => `${c.controlId}:${c.reviewGroupId}`).sort()).toEqual(
        [`${controls[0].id}:${groups[0].id}`, `${controls[1].id}:${groups[1].id}`].sort(),
      );
      expect((await stateOf(system.id)).status).toBe("ONBOARDED");
      expect(await events(system.id, "CHANGE_REVIEW_STARTED")).toHaveLength(1);
    });

    it("starts a review when a Framework is declared, for that Framework's group only", async () => {
      const system = await makeSystem({ facets: [0], scope: [0] });
      expect(await reviews(system.id)).toHaveLength(0);
      await declare(system.id, 1);
      const [review] = await reviews(system.id);
      expect(review.controls.map((c) => c.reviewGroupId)).toEqual([groups[1].id]);
    });

    it("widens the open review instead of starting a second, and reopens a Recommendation of a group that gained Controls", async () => {
      const { system, review } = await reviewedSystem();
      await changeFacets(system.id, [0, 1]);
      const all = await reviews(system.id);
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(review.id);
      expect(all[0].controls).toHaveLength(3);
      expect(await events(system.id, "CHANGE_REVIEW_WIDENED")).toHaveLength(1);
      const recs = await prisma.recommendation.findMany({ where: { systemId: system.id, changeReviewId: review.id } });
      expect(recs.find((r) => r.reviewGroupId === groups[0].id)?.voidedAt).not.toBeNull();
      expect(recs.find((r) => r.reviewGroupId === groups[1].id)?.voidedAt).toBeNull();
    });

    it("works out what a change added from the System as it is under the lock, not from the caller's earlier read", async () => {
      const system = await makeSystem({ facets: [] });
      const stale = await load(system.id); // read before another change committed
      await prisma.system.update({ where: { id: system.id }, data: { deploymentFacets: { connect: [{ id: facets[0] }] } } });
      await changeSystemClassification(stale, { deploymentFacetIds: [facets[0], facets[1]] }, users.owner.id);
      // Controls 0 and 1 were already in the remit; only control 2 (facet G) is new.
      const [review] = await reviews(system.id);
      expect(review.controls.map((c) => c.controlId)).toEqual([controls[2].id]);
    });

    it("starts nothing when the change adds no Controls to any remit", async () => {
      const system = await makeSystem({ facets: [0] });
      await changeFacets(system.id, [0, 2]);
      expect(await reviews(system.id)).toHaveLength(0);
      expect(await events(system.id, "CHANGE_REVIEW_STARTED")).toHaveLength(0);
    });

    it("starts nothing on a System that isn't Onboarded", async () => {
      const system = await makeSystem({ facets: [], status: "APPROVED" });
      await changeFacets(system.id, [0]);
      expect(await reviews(system.id)).toHaveLength(0);
    });
  });

  describe("Recommendations", () => {
    it("lets a group member recommend once, and refuses everyone else without changing anything", async () => {
      const { system, review } = await reviewedSystem({ recommend: false });
      const before = await snapshot(system.id);
      expect((await recommend("outsider", system.id, review.id, groups[0].id)).status).toBe(403);
      expect((await recommend("member1", system.id, review.id, groups[0].id)).status).toBe(403);
      expect((await recommend("member0", system.id, review.id, groups[0].id, "RECOMMEND", "  ")).status).toBe(400);
      expect(await snapshot(system.id)).toBe(before);
      expect((await recommend("member0", system.id, review.id, groups[0].id, "ADVISE_AGAINST", "No")).status).toBe(201);
      const afterGiven = await snapshot(system.id);
      expect((await recommend("member0", system.id, review.id, groups[0].id)).status).toBe(409);
      expect((await recommend("admin", system.id, review.id, null)).status).toBe(409); // the base review isn't part of it
      expect(await snapshot(system.id)).toBe(afterGiven);
      const [event] = await events(system.id, "RECOMMENDATION_GIVEN");
      expect(event.detail.startsWith(`${groups[0].name}: `)).toBe(true);
    });

    it("shows the open review and the tasks it creates", async () => {
      const { system, review } = await reviewedSystem({ recommend: false });
      const view = (await (await getReview(requestAs(users.member0.id, url(system.id)), ctxFor(system.id))).json()).changeReview;
      expect(view.id).toBe(review.id);
      expect(view.participants.map((p: { name: string }) => p.name)).toEqual([groups[0].name, groups[1].name]);
      expect((await getOpenChangeReviewRecommendationsForUser({ id: users.member0.id, role: "SYSTEM_OWNER" })).some((t) => t.system.id === system.id)).toBe(true);
      expect((await getChangeReviewDecisionTasksForUser(users.bso)).some((s) => s.id === system.id)).toBe(false);
      await recommend("member0", system.id, review.id, groups[0].id);
      await recommend("member1", system.id, review.id, groups[1].id);
      expect((await getChangeReviewDecisionTasksForUser(users.bso)).some((s) => s.id === system.id)).toBe(true);
      expect((await getOpenChangeReviewRecommendationsForUser({ id: users.member0.id, role: "SYSTEM_OWNER" })).some((t) => t.system.id === system.id)).toBe(false);
    });
  });

  describe("Decision", () => {
    it("accept closes the review and leaves the System Onboarded", async () => {
      const { system, review } = await reviewedSystem();
      expect((await decideAs("bso", system.id, { decision: "ACCEPT", comment: "  Fine  " })).status).toBe(200);
      const [row] = await reviews(system.id);
      expect(row).toMatchObject({ status: "ACCEPTED", decisionComment: "Fine", decidedById: users.bso.id });
      expect(row.decidedAt).not.toBeNull();
      expect(row.id).toBe(review.id);
      expect((await stateOf(system.id)).status).toBe("ONBOARDED");
      expect(await events(system.id, "CHANGE_REVIEW_DECIDED")).toHaveLength(1);
      expect((await decideAs("bso", system.id, { decision: "ACCEPT", comment: "Again" })).status).toBe(409);
      // A later change starts a new review.
      await changeFacets(system.id, [0, 1]);
      expect((await reviews(system.id)).filter((r) => r.status === "OPEN")).toHaveLength(1);
    });

    it("revoke sends a staged System back to the stage the BSO picks, as a Change Event", async () => {
      const { system } = await reviewedSystem();
      const target = sendBackTargets("FULL", "OG3")[0];
      expect((await decideAs("bso", system.id, { decision: "REVOKE", comment: "Redo" })).status).toBe(400); // no stage
      expect((await decideAs("bso", system.id, { decision: "REVOKE", sendBackTo: "OG3", comment: "Redo" })).status).toBe(409);
      expect((await decideAs("bso", system.id, { decision: "REVOKE", sendBackTo: target, comment: "Redo" })).status).toBe(200);
      const state = await stateOf(system.id);
      expect(state.status).not.toBe("ONBOARDED");
      expect(state.evaluationStage).toBe(target);
      const [row] = await reviews(system.id);
      expect(row).toMatchObject({ status: "REVOKED", sentBackTo: target });
      expect(await events(system.id, "EVALUATION_STAGE_CHANGED")).not.toHaveLength(0);
    });

    it("revoke returns a classic System to Draft, and refuses a stage for it", async () => {
      const { system } = await reviewedSystem({ staged: false });
      expect((await decideAs("bso", system.id, { decision: "REVOKE", sendBackTo: "OG1", comment: "Redo" })).status).toBe(400);
      expect((await decideAs("bso", system.id, { decision: "REVOKE", comment: "Redo" })).status).toBe(200);
      expect((await stateOf(system.id)).status).toBe("DRAFT");
    });

    it("refuses anyone but the BSO or an Admin who isn't the owner, and changes nothing", async () => {
      const { system, review } = await reviewedSystem();
      const before = await snapshot(system.id);
      for (const key of ["owner", "member0", "outsider"]) {
        expect((await decideAs(key, system.id, { decision: "ACCEPT", comment: "Fine" })).status, key).toBe(403);
      }
      expect((await decide(requestAs(null, url(system.id, "/decision"), { method: "POST", body: { decision: "ACCEPT", comment: "x" } }), ctxFor(system.id))).status).toBe(401);
      expect((await decideAs("bso", system.id, { decision: "MAYBE", comment: "x" })).status).toBe(400);
      expect((await decideAs("bso", system.id, { decision: "ACCEPT", comment: "x", changeReviewId: "someone-else" })).status).toBe(409);
      expect(await snapshot(system.id)).toBe(before);
      expect((await decideAs("admin", system.id, { decision: "ACCEPT", comment: "Fine", changeReviewId: review.id })).status).toBe(200);
    });

    it("can't be decided before every group has recommended", async () => {
      const { system, review } = await reviewedSystem({ recommend: false });
      await recommend("member0", system.id, review.id, groups[0].id);
      const before = await snapshot(system.id);
      expect((await decideAs("bso", system.id, { decision: "ACCEPT", comment: "Fine" })).status).toBe(409);
      expect(await snapshot(system.id)).toBe(before);
    });

    it("can't be decided without a Business System Owner, even by an Admin, and flags the owner", async () => {
      const { system } = await reviewedSystem({ bso: false });
      const before = await snapshot(system.id);
      expect((await decideAs("admin", system.id, { decision: "ACCEPT", comment: "Fine" })).status).toBe(409);
      expect(await snapshot(system.id)).toBe(before);
      expect((await getChangeReviewsNeedingBsoForOwner(users.owner)).some((s) => s.id === system.id)).toBe(true);
      await prisma.system.update({ where: { id: system.id }, data: { businessSystemOwnerId: users.bso.id } });
      expect((await getChangeReviewsNeedingBsoForOwner(users.owner)).some((s) => s.id === system.id)).toBe(false);
      expect((await decideAs("bso", system.id, { decision: "ACCEPT", comment: "Fine" })).status).toBe(200);
    });
  });
});

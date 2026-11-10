import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvaluationStage, RecommendationKind, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { reconcileAllReviewSteps } from "@/lib/review-steps";
import { getOpenRecommendationsForUser } from "@/lib/evaluation-oag";
import { getGateTasksForUser, sendBackTargets } from "@/lib/gate-decisions";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { PATCH as patchAssessment } from "../../assessments/[controlId]/route";
import { GET as getEvaluation } from "../route";
import { POST as qualificationDecision } from "../qualification-decision/route";
import { POST as og2Decision } from "../og2-decision/route";
import { POST as submitFirstDocumentation } from "../submit-first-documentation/route";
import { POST as giveRecommendationRoute } from "../recommendations/route";

/**
 * The first half of the Full track (#331): Qualification, first documentation, the OAG review and OG2. Fixtures only (CI's database is
 * migrated, not seeded): two Review Groups, each with its own Framework and one Control scoped to a fixture Deployment Facet, Full-track
 * Systems created directly at each stage, one user per role that matters, and Document Requirements that are removed again.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

function requestAs(userId: string | null, url: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, { method: init?.method, headers, body: init?.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Full track, first half (#331)", { timeout: 90_000 }, () => {
  const users: Record<string, { id: string; name: string }> = {};
  const groups: { id: string; name: string }[] = [];
  const frameworkIds: string[] = [];
  const controls: { id: string; code: string }[] = [];
  const systemIds: string[] = [];
  const requirementIds: string[] = [];
  let facetId: string;

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-331-${key}-${SUFFIX}@example.com`, name: `Test 331 ${key} ${SUFFIX}`, role } });
    users[key] = { id: user.id, name: user.name };
  }

  async function makeSystem(options: { stage: EvaluationStage; ownerKey?: string; scope?: number[]; track?: "SELF" | "FULL" } ) {
    const system = await prisma.system.create({
      data: {
        name: `Test 331 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users[options.ownerKey ?? "owner"].id,
        businessSystemOwnerId: users.bso.id,
        sensitivityLevel: 3,
        evaluationStage: options.stage,
        evaluationTrack: options.track ?? "FULL",
        evaluationStageEnteredAt: new Date(Date.now() - 60_000),
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: (options.scope ?? [0, 1]).map((i) => ({ id: frameworkIds[i] })) },
      },
    });
    systemIds.push(system.id);
    return system;
  }

  const base = (systemId: string, slug: string) => `/api/systems/${systemId}/evaluation/${slug}`;
  const qualify = (userKey: string, systemId: string, body: unknown) =>
    qualificationDecision(requestAs(users[userKey].id, base(systemId, "qualification-decision"), { method: "POST", body }), ctxFor(systemId));
  const decideOg2 = (userKey: string, systemId: string, body: unknown) =>
    og2Decision(requestAs(users[userKey].id, base(systemId, "og2-decision"), { method: "POST", body }), ctxFor(systemId));
  const submitDocs = (userKey: string, systemId: string) =>
    submitFirstDocumentation(requestAs(users[userKey].id, base(systemId, "submit-first-documentation"), { method: "POST" }), ctxFor(systemId));
  const recommend = async (userKey: string, systemId: string, reviewGroupId: string | null, kind: RecommendationKind = "RECOMMEND", comment = "Because", stage?: string) =>
    giveRecommendationRoute(
      requestAs(users[userKey].id, base(systemId, "recommendations"), {
        method: "POST",
        body: { stage: stage ?? ((await stateOf(systemId)).evaluationStage === "OAG_REVIEW_2" ? "OAG_REVIEW_2" : "OAG_REVIEW_1"), reviewGroupId, kind, comment },
      }),
      ctxFor(systemId),
    );
  const view = async (systemId: string, userKey = "admin") =>
    (await (await getEvaluation(requestAs(users[userKey].id, base(systemId, ""), { method: "GET" }), ctxFor(systemId))).json()).evaluation;

  const stateOf = (systemId: string) => prisma.system.findUniqueOrThrow({ where: { id: systemId } });
  const decisions = (systemId: string) => prisma.gateDecision.findMany({ where: { systemId }, orderBy: { decidedAt: "asc" } });
  const recs = (systemId: string) => prisma.recommendation.findMany({ where: { systemId }, orderBy: { givenAt: "asc" } });
  const events = (systemId: string, action?: string) =>
    prisma.changeEvent.findMany({ where: { systemId, ...(action ? { action: action as never } : {}) }, orderBy: { createdAt: "asc" } });
  /** Everything a refused write could have changed, as one comparable value. */
  async function snapshot(systemId: string) {
    const system = await stateOf(systemId);
    return JSON.stringify({
      system,
      decisions: await decisions(systemId),
      recs: await recs(systemId),
      events: (await events(systemId)).map((event) => event.id),
      documents: await prisma.systemDocument.count({ where: { systemId } }),
    });
  }
  const provideFirstDocumentation = async (systemId: string) => {
    for (const requirement of await prisma.documentRequirement.findMany({ where: { stage: "FIRST_DOCUMENTATION", tracks: { has: "FULL" } }, select: { id: true } })) {
      await prisma.systemDocument.upsert({
        where: { systemId_documentRequirementId: { systemId, documentRequirementId: requirement.id } },
        update: { provided: true, link: "https://example.com/doc" },
        create: { systemId, documentRequirementId: requirement.id, link: "https://example.com/doc", provided: true, updatedById: users.owner.id },
      });
    }
  };
  const edit = (systemId: string, control: { id: string }, userKey = "owner") =>
    patchAssessment(requestAs(users[userKey].id, `/api/systems/${systemId}/assessments/${control.id}`, { method: "PATCH", body: { status: "FULFILLED", evidence: "Edited" } }), {
      params: Promise.resolve({ id: systemId, controlId: control.id }),
    });

  beforeAll(async () => {
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("bso", "SYSTEM_OWNER");
    await makeUser("reviewer", "REVIEWER");
    await makeUser("admin", "ADMIN");
    await makeUser("adminOwner", "ADMIN");
    await makeUser("member1", "SYSTEM_OWNER");
    await makeUser("member2", "VIEWER");
    await makeUser("outsider", "SYSTEM_OWNER");
    await makeUser("viewer", "VIEWER");

    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 331 Facet ${SUFFIX}` } })).id;
    for (const [i, member] of [[0, "member1"], [1, "member2"]] as [number, string][]) {
      const group = await prisma.reviewGroup.create({ data: { name: `Test 331 Group ${i + 1} ${SUFFIX}`, members: { connect: [{ id: users[member].id }] } } });
      groups.push({ id: group.id, name: group.name });
      const framework = await createFixtureFramework(`331 f${i + 1}`);
      frameworkIds.push(framework.id);
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: group.id } });
      const control = await prisma.control.create({
        data: {
          code: `T331-${i}-${SUFFIX}`,
          title: `Test 331 Control ${i}`,
          description: "Test",
          category: "Test",
          applicability: "PER_SYSTEM",
          deploymentFacets: { connect: [{ id: facetId }] },
        },
      });
      controls.push({ id: control.id, code: control.code });
      await mapControlsToFramework(framework.id, [control.id]);
    }
    requirementIds.push((await prisma.documentRequirement.create({ data: { name: `Test 331 First documentation ${SUFFIX}`, stage: "FIRST_DOCUMENTATION", tracks: ["FULL"] } })).id);
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // decisions, Recommendations, verdicts, documents, assessments cascade
    await prisma.documentRequirement.deleteMany({ where: { id: { in: requirementIds } } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controls.map((c) => c.id) } } });
    await prisma.framework.updateMany({ where: { id: { in: frameworkIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  }, 60_000);

  describe("Qualification", () => {
    it("refuses everyone but the Business System Owner and an Admin who isn't the owner, and changes nothing", async () => {
      const system = await makeSystem({ stage: "QUALIFICATION" });
      const owned = await makeSystem({ stage: "QUALIFICATION", ownerKey: "adminOwner" });
      const before = [await snapshot(system.id), await snapshot(owned.id)];
      for (const key of ["owner", "reviewer", "member1"]) {
        expect((await qualify(key, system.id, { decision: "AUTHORIZE", comment: "Fine" })).status, key).toBe(403);
      }
      expect((await qualify("adminOwner", owned.id, { decision: "AUTHORIZE", comment: "Fine" })).status).toBe(403);
      expect([await snapshot(system.id), await snapshot(owned.id)]).toEqual(before);
    });

    it("answers 404 to a user who can't see the System and 401 to nobody", async () => {
      const system = await makeSystem({ stage: "QUALIFICATION" });
      const before = await snapshot(system.id);
      expect((await qualify("outsider", system.id, { decision: "AUTHORIZE", comment: "Fine" })).status).toBe(404);
      const anonymous = await qualificationDecision(requestAs(null, base(system.id, "qualification-decision"), { method: "POST", body: { decision: "AUTHORIZE", comment: "x" } }), ctxFor(system.id));
      expect(anonymous.status).toBe(401);
      expect(await snapshot(system.id)).toBe(before);
    });

    it("refuses a System that isn't at Qualification (409), and a bad body (400), with nothing changed", async () => {
      for (const stage of ["OG1", "FIRST_DOCUMENTATION", "OG2"] as const) {
        const system = await makeSystem({ stage });
        const before = await snapshot(system.id);
        expect((await qualify("bso", system.id, { decision: "AUTHORIZE", comment: "Fine" })).status, stage).toBe(409);
        expect(await snapshot(system.id)).toBe(before);
      }
      const system = await makeSystem({ stage: "QUALIFICATION" });
      const before = await snapshot(system.id);
      for (const body of [
        { decision: "AUTHORIZE", comment: "  " },
        { decision: "AUTHORIZE" },
        { decision: "SEND_BACK", comment: "Redo" },
        { decision: "MAYBE", comment: "x" },
        { decision: "AUTHORIZE", comment: "Fine", justification: "Not at this gate" },
      ]) {
        expect((await qualify("bso", system.id, body)).status, JSON.stringify(body)).toBe(400);
      }
      for (const target of ["QUALIFICATION", "FIRST_DOCUMENTATION", "OG2", "SECOND_ROUND"]) {
        expect((await qualify("bso", system.id, { decision: "SEND_BACK", sendBackTo: target, comment: "No" })).status, target).toBe(409);
      }
      expect(await snapshot(system.id)).toBe(before);
    });

    it("moves the System to First documentation on Yes, with a decision and two Change Events", async () => {
      const system = await makeSystem({ stage: "QUALIFICATION" });
      const view1 = await view(system.id, "bso");
      expect(view1.qualification).toEqual({ canDecide: true, sendBackTargets: ["FIRST_ROUND", "OG1"] });
      expect((await view(system.id, "owner")).qualification.canDecide).toBe(false);

      const response = await qualify("bso", system.id, { decision: "AUTHORIZE", comment: "Worth a full evaluation" });
      expect(response.status).toBe(200);
      const state = await stateOf(system.id);
      expect([state.evaluationStage, state.status, state.evaluationClosedAt, state.evaluationTrack]).toEqual(["FIRST_DOCUMENTATION", "DRAFT", null, "FULL"]);
      expect(await decisions(system.id)).toMatchObject([{ gate: "QUALIFICATION", outcome: "AUTHORIZE", comment: "Worth a full evaluation", decidedById: users.bso.id, justification: null }]);
      expect((await events(system.id, "GATE_DECIDED")).map((e) => e.detail)).toEqual(["Qualification: yes: Worth a full evaluation"]);
      expect((await events(system.id, "EVALUATION_STAGE_CHANGED")).map((e) => e.detail)).toEqual(["Qualification passed: moved to First documentation"]);
      expect((await qualify("bso", system.id, { decision: "AUTHORIZE", comment: "Again" })).status).toBe(409);
    });

    it("lets an Admin who isn't the owner decide", async () => {
      const system = await makeSystem({ stage: "QUALIFICATION" });
      expect((await qualify("admin", system.id, { decision: "AUTHORIZE", comment: "Admin call" })).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe("FIRST_DOCUMENTATION");
    });

    it("closes the System on Reject, which is final", async () => {
      const system = await makeSystem({ stage: "QUALIFICATION" });
      expect((await qualify("bso", system.id, { decision: "REJECT", comment: "Not for us" })).status).toBe(200);
      const state = await stateOf(system.id);
      expect([state.status, state.evaluationStage, state.evaluationClosedAt === null]).toEqual(["REJECTED", "QUALIFICATION", false]);
      expect((await events(system.id, "GATE_DECIDED")).map((e) => e.detail)).toEqual(["Qualification: rejected: Not for us"]);
      const closed = await view(system.id, "bso");
      expect([closed.closed, closed.closedAt, closed.qualification]).toEqual([true, "QUALIFICATION", null]);
      const before = await snapshot(system.id);
      expect((await qualify("bso", system.id, { decision: "AUTHORIZE", comment: "Changed my mind" })).status).toBe(409);
      expect(await snapshot(system.id)).toBe(before);
    });

    it("sends back to OG1 (clears the Track, voids the OG1 verdicts) or the first round", async () => {
      expect(sendBackTargets("FULL", "QUALIFICATION")).toEqual(["FIRST_ROUND", "OG1"]);
      const system = await makeSystem({ stage: "QUALIFICATION" });
      await prisma.trackVerdict.create({ data: { systemId: system.id, reviewGroupId: null, verdictById: users.reviewer.id, verdict: "FULL", comment: "Full", givenAt: new Date(Date.now() - 120_000) } });
      expect((await qualify("bso", system.id, { decision: "SEND_BACK", sendBackTo: "OG1", comment: "Ask the groups again" })).status).toBe(200);
      const state = await stateOf(system.id);
      expect([state.evaluationStage, state.evaluationTrack]).toEqual(["OG1", null]);
      expect(await prisma.trackVerdict.count({ where: { systemId: system.id, voidedAt: null } })).toBe(0);
      expect((await decisions(system.id)).map((d) => [d.gate, d.outcome, d.sentBackTo])).toEqual([["QUALIFICATION", "SEND_BACK", "OG1"]]);
      expect((await events(system.id, "GATE_DECIDED")).map((e) => e.detail)).toEqual(["Qualification: sent back to OG1: Ask the groups again"]);

      const second = await makeSystem({ stage: "QUALIFICATION" });
      expect((await qualify("bso", second.id, { decision: "SEND_BACK", sendBackTo: "FIRST_ROUND", comment: "Redo" })).status).toBe(200);
      expect((await stateOf(second.id)).evaluationStage).toBe("FIRST_ROUND");
    });
  });

  describe("first documentation", () => {
    it("is submitted by the owner or an Admin only (403), at that stage only (409), with nothing changed", async () => {
      const system = await makeSystem({ stage: "FIRST_DOCUMENTATION" });
      await provideFirstDocumentation(system.id);
      const before = await snapshot(system.id);
      for (const key of ["bso", "reviewer", "member1"]) {
        expect((await submitDocs(key, system.id)).status, key).toBe(403);
      }
      expect((await submitDocs("outsider", system.id)).status).toBe(404);
      for (const stage of ["QUALIFICATION", "OAG_REVIEW_1", "SECOND_ROUND"] as const) {
        const other = await makeSystem({ stage });
        const otherBefore = await snapshot(other.id);
        expect((await submitDocs("owner", other.id)).status, stage).toBe(409);
        expect(await snapshot(other.id)).toBe(otherBefore);
      }
      expect(await snapshot(system.id)).toBe(before);
    });

    it("names what is missing (409) until every Document Requirement is provided, then moves to the OAG review", async () => {
      const system = await makeSystem({ stage: "FIRST_DOCUMENTATION" });
      const before = await snapshot(system.id);
      const refused = await submitDocs("owner", system.id);
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toContain(`Test 331 First documentation ${SUFFIX}`);
      expect(await snapshot(system.id)).toBe(before);
      const shown = (await view(system.id, "owner")).firstDocumentation;
      expect(shown.ready).toBe(false);
      expect(shown.documentsMissing.map((d: { name: string }) => d.name)).toContain(`Test 331 First documentation ${SUFFIX}`);

      await provideFirstDocumentation(system.id);
      expect((await view(system.id, "owner")).firstDocumentation).toMatchObject({ ready: true, documentsMissing: [] });
      const response = await submitDocs("owner", system.id);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ stage: "OAG_REVIEW_1" });
      expect((await stateOf(system.id)).evaluationStage).toBe("OAG_REVIEW_1");
      expect((await events(system.id, "EVALUATION_STAGE_CHANGED")).map((e) => e.detail)).toEqual(["First documentation submitted: moved to the OAG review"]);
    });

    it("lets an Admin submit", async () => {
      const system = await makeSystem({ stage: "FIRST_DOCUMENTATION" });
      await provideFirstDocumentation(system.id);
      expect((await submitDocs("admin", system.id)).status).toBe(200);
    });
  });

  describe("OAG review", () => {
    it("takes part: the base review and each group with a Control in its remit, over all the System's Controls", async () => {
      const both = await makeSystem({ stage: "OAG_REVIEW_1" });
      const one = await makeSystem({ stage: "OAG_REVIEW_1", scope: [0] });
      const participants = async (id: string) => (await view(id)).oag.participants.map((p: { reviewGroupId: string | null }) => p.reviewGroupId);
      expect(await participants(both.id)).toEqual([null, groups[0].id, groups[1].id]);
      expect(await participants(one.id)).toEqual([null, groups[0].id]);
    });

    it("refuses the wrong person (403) or a System they own, and changes nothing", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_1" });
      const owned = await makeSystem({ stage: "OAG_REVIEW_1", ownerKey: "member1" });
      const before = [await snapshot(system.id), await snapshot(owned.id)];
      expect((await recommend("owner", system.id, groups[0].id)).status).toBe(403);
      expect((await recommend("member2", system.id, groups[0].id)).status).toBe(403); // another group's member
      expect((await recommend("member1", system.id, null)).status).toBe(403); // not the base review
      expect((await recommend("viewer", system.id, null)).status).toBe(404);
      expect((await recommend("bso", system.id, null)).status).toBe(403); // the BSO decides, doesn't recommend
      expect((await recommend("member1", owned.id, groups[0].id)).status).toBe(403); // a System they own
      expect((await recommend("outsider", system.id, null)).status).toBe(404);
      expect([await snapshot(system.id), await snapshot(owned.id)]).toEqual(before);
    });

    it("refuses a bad body (400), a System not at the review, a group that isn't part of it, and a second Recommendation (409)", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_1", scope: [0] });
      const before = await snapshot(system.id);
      const post = (body: unknown) =>
        giveRecommendationRoute(requestAs(users.admin.id, base(system.id, "recommendations"), { method: "POST", body }), ctxFor(system.id));
      const stage = "OAG_REVIEW_1";
      expect((await post({ stage, reviewGroupId: null, kind: "MAYBE", comment: "x" })).status).toBe(400);
      expect((await post({ stage, reviewGroupId: null, kind: "RECOMMEND", comment: "  " })).status).toBe(400);
      expect((await post({ stage, kind: "RECOMMEND", comment: "x" })).status).toBe(400);
      expect((await post({ reviewGroupId: null, kind: "RECOMMEND", comment: "x" })).status).toBe(400); // no stage
      expect((await post({ stage: "OG2", reviewGroupId: null, kind: "RECOMMEND", comment: "x" })).status).toBe(400); // not a review
      expect((await recommend("admin", system.id, groups[1].id)).status).toBe(409); // group 2 has no Control in scope
      for (const stage of ["FIRST_DOCUMENTATION", "OG2"] as const) {
        const other = await makeSystem({ stage });
        const otherBefore = await snapshot(other.id);
        expect((await recommend("admin", other.id, null)).status, stage).toBe(409);
        expect(await snapshot(other.id)).toBe(otherBefore);
      }
      expect(await snapshot(system.id)).toBe(before);

      expect((await recommend("reviewer", system.id, null)).status).toBe(201);
      const once = await snapshot(system.id);
      expect((await recommend("admin", system.id, null)).status).toBe(409);
      expect(await snapshot(system.id)).toBe(once);
    });

    it("shows each Recommendation as the group's (the person only to a viewer who may see them), writes a Change Event, and moves to OG2 on the last one", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_1" });
      expect((await recommend("reviewer", system.id, null, "RECOMMEND", "Base fine")).status).toBe(201);
      expect((await recommend("member1", system.id, groups[0].id, "RECOMMEND_WITH_CONDITIONS", "Patch within 30 days")).status).toBe(201);
      expect((await stateOf(system.id)).evaluationStage).toBe("OAG_REVIEW_1");

      const asOwner = (await view(system.id, "owner")).oag.participants.find((p: { reviewGroupId: string | null }) => p.reviewGroupId === groups[0].id);
      expect(asOwner.recommendation).toMatchObject({ kind: "RECOMMEND_WITH_CONDITIONS", comment: "Patch within 30 days", by: null });
      const asAdmin = (await view(system.id, "admin")).oag.participants.find((p: { reviewGroupId: string | null }) => p.reviewGroupId === groups[0].id);
      expect(asAdmin.recommendation.by).toBe(users.member1.name);
      expect((await view(system.id, "admin")).oag.open).toBe(true);

      const last = await recommend("member2", system.id, groups[1].id, "ADVISE_AGAINST", "Not safe");
      expect(last.status).toBe(201);
      expect((await last.json()).closed).toEqual({ stage: "OG2" });
      expect((await stateOf(system.id)).evaluationStage).toBe("OG2");

      expect((await events(system.id, "RECOMMENDATION_GIVEN")).map((e) => e.detail)).toEqual([
        "Base review: Recommend: Base fine",
        `${groups[0].name}: Recommend with conditions: Patch within 30 days`,
        `${groups[1].name}: Advise against: Not safe`,
      ]);
      const move = (await events(system.id, "EVALUATION_STAGE_CHANGED"))[0];
      expect([move.detail, move.actorId]).toEqual(["OAG review closed: moved to OG2", "system"]);
      // The closed review keeps showing the Recommendations that decided it, as the groups'.
      const closed = (await view(system.id, "owner")).oag;
      expect(closed.open).toBe(false);
      expect(closed.participants.map((p: { name: string }) => p.name)).toEqual(["Base review", groups[0].name, groups[1].name]);
      expect(closed.participants.every((p: { recommendation: { by: string | null } }) => p.recommendation.by === null)).toBe(true);
    });

    it("lets a group member and an Admin recommend for it, and an Admin for the base review", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_1", scope: [0] });
      expect((await recommend("admin", system.id, groups[0].id)).status).toBe(201);
      expect((await recommend("admin", system.id, null)).status).toBe(201);
      expect((await stateOf(system.id)).evaluationStage).toBe("OG2");
    });

    it("is reopened by an owner's edit to a Control in the remit, with the reason, while the review is open", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_1" });
      await recommend("member1", system.id, groups[0].id);
      await recommend("reviewer", system.id, null);
      expect((await edit(system.id, controls[0])).status).toBe(200);

      const rows = await recs(system.id);
      const g1 = rows.find((r) => r.reviewGroupId === groups[0].id)!;
      expect(g1.voidedAt).not.toBeNull();
      expect(g1.voidReason).toBe(`${controls[0].code} changed after the Recommendation`);
      expect(rows.find((r) => r.reviewGroupId === null)!.voidedAt).toBeNull();
      expect((await events(system.id, "RECOMMENDATION_REOPENED")).map((e) => e.detail)).toEqual([`${groups[0].name} Recommendation reopened: ${controls[0].code} changed after the Recommendation`]);
      const participant = (await view(system.id, "admin")).oag.participants.find((p: { reviewGroupId: string | null }) => p.reviewGroupId === groups[0].id);
      expect(participant.recommendation).toBeNull();
      expect(participant.reopened.reason).toContain("changed after the Recommendation");
      expect((await recommend("member1", system.id, groups[0].id, "ADVISE_AGAINST")).status).toBe(201); // may answer again
    });

    it("reopens nothing once the review has closed, or for a Control in another group's remit", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_1" });
      await recommend("member1", system.id, groups[0].id);
      await recommend("member2", system.id, groups[1].id);
      await recommend("reviewer", system.id, null);
      expect((await stateOf(system.id).then((s) => s.evaluationStage))).toBe("OG2");
      expect((await edit(system.id, controls[0])).status).toBe(200);
      expect((await recs(system.id)).every((r) => r.voidedAt === null)).toBe(true);
      expect(await events(system.id, "RECOMMENDATION_REOPENED")).toHaveLength(0);

      const open = await makeSystem({ stage: "OAG_REVIEW_1" });
      await recommend("member2", open.id, groups[1].id);
      expect((await edit(open.id, controls[0])).status).toBe(200);
      expect((await recs(open.id)).every((r) => r.voidedAt === null)).toBe(true);
    });

    it("closes to OG2 when a catalog change (untying the last open group's Framework) leaves every participant answered", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_1", scope: [0, 1] });
      await recommend("reviewer", system.id, null);
      await recommend("member1", system.id, groups[0].id);
      expect((await stateOf(system.id)).evaluationStage).toBe("OAG_REVIEW_1");
      try {
        await prisma.framework.update({ where: { id: frameworkIds[1] }, data: { reviewGroupId: null } });
        await reconcileAllReviewSteps();
        expect((await stateOf(system.id)).evaluationStage).toBe("OG2");
        expect((await events(system.id, "EVALUATION_STAGE_CHANGED")).map((e) => e.detail)).toEqual(["OAG review closed: moved to OG2"]);
      } finally {
        await prisma.framework.update({ where: { id: frameworkIds[1] }, data: { reviewGroupId: groups[1].id } });
      }
    });

    it("lists the open Recommendations in \"My tasks\" for the participants who still owe one", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_1" });
      const mine = async (key: string) => (await getOpenRecommendationsForUser({ id: users[key].id, role: key === "reviewer" ? "REVIEWER" : key === "admin" ? "ADMIN" : "VIEWER" })).filter((t) => t.system.id === system.id).map((t) => t.participant.reviewGroupId);
      expect(await mine("member1")).toEqual([groups[0].id]);
      expect(await mine("member2")).toEqual([groups[1].id]);
      expect(await mine("reviewer")).toEqual([null]);
      expect(await mine("admin")).toEqual([null, groups[0].id, groups[1].id]);
      expect(await mine("viewer")).toEqual([]);
      await recommend("member1", system.id, groups[0].id);
      expect(await mine("member1")).toEqual([]);
      // Not on a System the user owns.
      const owned = await makeSystem({ stage: "OAG_REVIEW_1", ownerKey: "member1" });
      expect((await getOpenRecommendationsForUser({ id: users.member1.id, role: "SYSTEM_OWNER" })).some((t) => t.system.id === owned.id)).toBe(false);
    });
  });

  describe("OG2", () => {
    /** A System at OG2 whose OAG review closed with these Recommendations, by participant (null is the base review). */
    async function atOg2(kinds: [RecommendationKind, RecommendationKind, RecommendationKind] = ["RECOMMEND", "RECOMMEND", "RECOMMEND"]) {
      const system = await makeSystem({ stage: "OAG_REVIEW_1" });
      await recommend("reviewer", system.id, null, kinds[0], "Base says");
      await recommend("member1", system.id, groups[0].id, kinds[1], "Group 1 says");
      await recommend("member2", system.id, groups[1].id, kinds[2], "Group 2 says");
      expect((await stateOf(system.id)).evaluationStage).toBe("OG2");
      return system;
    }

    it("refuses the wrong person (403), a System not at OG2 (409) and a bad body (400), with nothing changed", async () => {
      const system = await atOg2();
      const owned = await makeSystem({ stage: "OG2", ownerKey: "adminOwner" });
      const before = [await snapshot(system.id), await snapshot(owned.id)];
      for (const key of ["owner", "reviewer", "member1"]) {
        expect((await decideOg2(key, system.id, { decision: "AUTHORIZE", comment: "Fine" })).status, key).toBe(403);
      }
      expect((await decideAbsent(owned.id)).status).toBe(403);
      expect((await decideOg2("outsider", system.id, { decision: "AUTHORIZE", comment: "Fine" })).status).toBe(404);
      for (const body of [{ decision: "AUTHORIZE", comment: " " }, { decision: "SEND_BACK", comment: "x" }, { decision: "REJECT", comment: "x", justification: "Not here" }]) {
        expect((await decideOg2("bso", system.id, body)).status, JSON.stringify(body)).toBe(400);
      }
      for (const target of ["OG2", "SECOND_ROUND", "OG3"]) {
        expect((await decideOg2("bso", system.id, { decision: "SEND_BACK", sendBackTo: target, comment: "x" })).status, target).toBe(409);
      }
      expect([await snapshot(system.id), await snapshot(owned.id)]).toEqual(before);

      for (const stage of ["QUALIFICATION", "OAG_REVIEW_1", "SECOND_ROUND"] as const) {
        const other = await makeSystem({ stage });
        const otherBefore = await snapshot(other.id);
        expect((await decideOg2("bso", other.id, { decision: "AUTHORIZE", comment: "Fine" })).status, stage).toBe(409);
        expect(await snapshot(other.id)).toBe(otherBefore);
      }
    });
    const decideAbsent = (systemId: string) => decideOg2("adminOwner", systemId, { decision: "AUTHORIZE", comment: "Fine" });

    it("shows the BSO every Recommendation and the stages it can be sent back to", async () => {
      const system = await atOg2(["RECOMMEND", "ADVISE_AGAINST", "RECOMMEND_WITH_CONDITIONS"]);
      const shown = await view(system.id, "bso");
      expect(shown.og2).toEqual({ canDecide: true, adviseAgainst: true, sendBackTargets: ["FIRST_ROUND", "OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1"] });
      expect(shown.oag.participants.map((p: { name: string; recommendation: { kind: string } }) => [p.name, p.recommendation.kind])).toEqual([
        ["Base review", "RECOMMEND"],
        [groups[0].name, "ADVISE_AGAINST"],
        [groups[1].name, "RECOMMEND_WITH_CONDITIONS"],
      ]);
      expect((await view(system.id, "owner")).og2.canDecide).toBe(false);
      expect((await view(system.id, "reviewer")).og2.canDecide).toBe(false);
    });

    it("refuses Proceed against an Advise-against without a justification (400), and accepts it with one, stored and shown next to it", async () => {
      const system = await atOg2(["RECOMMEND", "ADVISE_AGAINST", "RECOMMEND"]);
      const before = await snapshot(system.id);
      const refused = await decideOg2("bso", system.id, { decision: "AUTHORIZE", comment: "Go" });
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toContain("justification");
      expect((await decideOg2("bso", system.id, { decision: "AUTHORIZE", comment: "Go", justification: "   " })).status).toBe(400);
      expect(await snapshot(system.id)).toBe(before);

      const response = await decideOg2("bso", system.id, { decision: "AUTHORIZE", comment: "Go", justification: "The gateway mitigates it" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ decision: "AUTHORIZE", stage: "SECOND_ROUND" });
      const state = await stateOf(system.id);
      expect([state.evaluationStage, state.evaluationTrack, state.status]).toEqual(["SECOND_ROUND", "FULL", "DRAFT"]);
      expect(await decisions(system.id)).toMatchObject([{ gate: "OG2", outcome: "AUTHORIZE", justification: "The gateway mitigates it", comment: "Go" }]);
      expect((await events(system.id, "GATE_DECIDED")).map((e) => e.detail)).toEqual(["OG2: proceed: Go"]);
      expect((await events(system.id, "EVALUATION_STAGE_CHANGED")).map((e) => e.detail)).toContain("OG2 passed: moved to Second round");
      const after = await view(system.id, "owner");
      expect(after.og2Justification).toBe("The gateway mitigates it");
      expect(after.decisions[0].justification).toBe("The gateway mitigates it");
      expect(after.oag.participants.some((p: { recommendation: { kind: string } }) => p.recommendation.kind === "ADVISE_AGAINST")).toBe(true);
    });

    it("needs no justification when nobody advised against, and a justification then is stored as given", async () => {
      const plain = await atOg2(["RECOMMEND", "RECOMMEND_WITH_CONDITIONS", "RECOMMEND"]);
      expect((await view(plain.id, "bso")).og2.adviseAgainst).toBe(false);
      expect((await decideOg2("bso", plain.id, { decision: "AUTHORIZE", comment: "Go" })).status).toBe(200);
      expect((await decisions(plain.id))[0].justification).toBeNull();
      expect((await stateOf(plain.id)).evaluationStage).toBe("SECOND_ROUND");
    });

    it("lets an Advise-against be answered by Reject or Send back without a justification", async () => {
      const rejected = await atOg2(["ADVISE_AGAINST", "RECOMMEND", "RECOMMEND"]);
      expect((await decideOg2("bso", rejected.id, { decision: "REJECT", comment: "Advice taken" })).status).toBe(200);
      const closed = await stateOf(rejected.id);
      expect([closed.status, closed.evaluationStage, closed.evaluationClosedAt === null]).toEqual(["REJECTED", "OG2", false]);
      expect((await view(rejected.id, "bso")).closedAt).toBe("OG2");
      const before = await snapshot(rejected.id);
      expect((await decideOg2("bso", rejected.id, { decision: "AUTHORIZE", comment: "x", justification: "y" })).status).toBe(409);
      expect(await snapshot(rejected.id)).toBe(before);
    });

    it("sends back to OG2's earlier stages: documentation keeps nothing of the review, a later run starts every group open", async () => {
      const toDocs = await atOg2(["RECOMMEND", "ADVISE_AGAINST", "RECOMMEND"]);
      expect((await decideOg2("bso", toDocs.id, { decision: "SEND_BACK", sendBackTo: "FIRST_DOCUMENTATION", comment: "Add the DPIA" })).status).toBe(200);
      expect((await stateOf(toDocs.id)).evaluationStage).toBe("FIRST_DOCUMENTATION");
      expect((await recs(toDocs.id)).every((r) => r.voidedAt !== null && r.voidReason === "The System was sent back at OG2")).toBe(true);
      expect((await events(toDocs.id, "GATE_DECIDED")).map((e) => e.detail)).toEqual(["OG2: sent back to First documentation: Add the DPIA"]);
      await provideFirstDocumentation(toDocs.id);
      expect((await submitDocs("owner", toDocs.id)).status).toBe(200);
      const fresh = (await view(toDocs.id, "admin")).oag;
      expect(fresh.open).toBe(true);
      expect(fresh.participants.every((p: { recommendation: unknown; reopened: unknown }) => p.recommendation === null && p.reopened === null)).toBe(true);
      expect((await recommend("reviewer", toDocs.id, null)).status).toBe(201);

      const toOag = await atOg2();
      expect((await decideOg2("bso", toOag.id, { decision: "SEND_BACK", sendBackTo: "OAG_REVIEW_1", comment: "Ask again" })).status).toBe(200);
      expect((await stateOf(toOag.id)).evaluationStage).toBe("OAG_REVIEW_1");
      expect((await view(toOag.id, "admin")).oag.participants.every((p: { recommendation: unknown }) => p.recommendation === null)).toBe(true);

      const toQualification = await atOg2();
      expect((await decideOg2("bso", toQualification.id, { decision: "SEND_BACK", sendBackTo: "QUALIFICATION", comment: "Rethink" })).status).toBe(200);
      expect((await stateOf(toQualification.id)).evaluationStage).toBe("QUALIFICATION");
      expect((await recs(toQualification.id)).every((r) => r.voidedAt !== null)).toBe(true);

      const toOg1 = await atOg2();
      expect((await decideOg2("bso", toOg1.id, { decision: "SEND_BACK", sendBackTo: "OG1", comment: "Redo the Track" })).status).toBe(200);
      const reopened = await stateOf(toOg1.id);
      expect([reopened.evaluationStage, reopened.evaluationTrack]).toEqual(["OG1", null]);
    });

    it("makes the Full-track second round work: its Document Requirements are the Full-track ones", async () => {
      const requirement = await prisma.documentRequirement.create({ data: { name: `Test 331 Second round ${SUFFIX}`, stage: "SECOND_ROUND", tracks: ["FULL"] } });
      try {
        const system = await atOg2();
        expect((await decideOg2("bso", system.id, { decision: "AUTHORIZE", comment: "Go" })).status).toBe(200);
        const shown = await view(system.id, "owner");
        expect(shown.stage).toBe("SECOND_ROUND");
        expect(shown.secondRound.documentsMissing.map((d: { name: string }) => d.name)).toContain(requirement.name);
      } finally {
        await prisma.documentRequirement.delete({ where: { id: requirement.id } });
      }
    });
  });

  describe("My tasks for the deciders", () => {
    it("lists a System at Qualification or OG2 for its Business System Owner only, never for its owner, and not once closed", async () => {
      const qualification = await makeSystem({ stage: "QUALIFICATION" });
      const og2 = await makeSystem({ stage: "OG2" });
      const owned = await makeSystem({ stage: "OG2", ownerKey: "bso" });
      const ids = async (key: string, gate: "QUALIFICATION" | "OG2") => (await getGateTasksForUser({ id: users[key].id }, gate)).map((t) => t.id);
      expect(await ids("bso", "QUALIFICATION")).toContain(qualification.id);
      expect(await ids("bso", "QUALIFICATION")).not.toContain(og2.id);
      expect(await ids("bso", "OG2")).toContain(og2.id);
      expect(await ids("bso", "OG2")).not.toContain(owned.id);
      expect(await ids("reviewer", "OG2")).not.toContain(og2.id);
      await qualify("bso", qualification.id, { decision: "REJECT", comment: "No" });
      expect(await ids("bso", "QUALIFICATION")).not.toContain(qualification.id);
    });
  });

  describe("the whole first half", () => {
    it("runs OG1's Full track through Qualification, documentation, the OAG review and OG2 to the second round, one Change Event per step", async () => {
      const system = await makeSystem({ stage: "QUALIFICATION" });
      await provideFirstDocumentation(system.id);
      expect((await qualify("bso", system.id, { decision: "AUTHORIZE", comment: "Yes" })).status).toBe(200);
      expect((await submitDocs("owner", system.id)).status).toBe(200);
      for (const [key, group] of [["reviewer", null], ["member1", groups[0].id], ["member2", groups[1].id]] as const) {
        expect((await recommend(key, system.id, group)).status).toBe(201);
      }
      expect((await decideOg2("bso", system.id, { decision: "AUTHORIZE", comment: "Proceed" })).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe("SECOND_ROUND");
      expect((await events(system.id, "EVALUATION_STAGE_CHANGED")).map((e) => e.detail)).toEqual([
        "Qualification passed: moved to First documentation",
        "First documentation submitted: moved to the OAG review",
        "OAG review closed: moved to OG2",
        "OG2 passed: moved to Second round",
      ]);
      expect((await decisions(system.id)).map((d) => d.gate)).toEqual(["QUALIFICATION", "OG2"]);
      expect(await events(system.id, "RECOMMENDATION_GIVEN")).toHaveLength(3);
    });
  });
});

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvaluationStage, RecommendationKind, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { getOpenRecommendationsForUser } from "@/lib/evaluation-oag";
import { sendBackTargets } from "@/lib/gate-decisions";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { PATCH as patchAssessment } from "../../assessments/[controlId]/route";
import { GET as getEvaluation } from "../route";
import { POST as og3Decision } from "../og3-decision/route";
import { POST as submitSecondRound } from "../submit-second-round/route";
import { POST as giveRecommendationRoute } from "../recommendations/route";
import { POST as completeAnalysis } from "../../risk-analyses/[analysisId]/complete/route";

/**
 * The second half of the Full track (#332): the second round, the Risk Analysis, the second OAG review and OG3, with the Send-back
 * that makes both OAG reviews run again. Fixtures only (CI's database is migrated, not seeded): two Review Groups, each with its own
 * Framework and one Control scoped to a fixture Deployment Facet, Full-track Systems created directly at each stage, and one user per
 * role that matters. The first review's Recommendations are written directly, as it would have left them.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

function requestAs(userId: string | null, url: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, { method: init?.method, headers, body: init?.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Full track, second half (#332)", { timeout: 90_000 }, () => {
  const users: Record<string, { id: string; name: string }> = {};
  const groups: { id: string; name: string }[] = [];
  const frameworkIds: string[] = [];
  const controls: { id: string; code: string }[] = [];
  const systemIds: string[] = [];
  const requirementIds: string[] = [];
  let facetId: string;

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-332-${key}-${SUFFIX}@example.com`, name: `Test 332 ${key} ${SUFFIX}`, role } });
    users[key] = { id: user.id, name: user.name };
  }

  async function makeSystem(options: { stage: EvaluationStage; track?: "SELF" | "FULL" }) {
    const system = await prisma.system.create({
      data: {
        name: `Test 332 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users.owner.id,
        businessSystemOwnerId: users.bso.id,
        sensitivityLevel: 3,
        evaluationStage: options.stage,
        evaluationTrack: options.track ?? "FULL",
        evaluationStageEnteredAt: new Date(Date.now() - 60_000),
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: frameworkIds.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    return system;
  }

  /** A first-review Recommendation as OAG review 1 left it (given before the System entered its current stage). */
  const firstReview = (systemId: string, reviewGroupId: string | null, kind: RecommendationKind = "RECOMMEND", comment = "First review") =>
    prisma.recommendation.create({
      data: { systemId, stage: "OAG_REVIEW_1", reviewGroupId, givenById: users.reviewer.id, kind, comment, givenAt: new Date(Date.now() - 600_000) },
    });
  const secondReview = (systemId: string, reviewGroupId: string | null, kind: RecommendationKind = "RECOMMEND", comment = "Second review") =>
    prisma.recommendation.create({ data: { systemId, stage: "OAG_REVIEW_2", reviewGroupId, givenById: users.reviewer.id, kind, comment, givenAt: new Date() } });
  /** The System at OG3 with both reviews' Recommendations written (base review, group 1, group 2). */
  async function atOg3(first: RecommendationKind[] = ["RECOMMEND", "RECOMMEND", "RECOMMEND"], second: RecommendationKind[] = ["RECOMMEND", "RECOMMEND", "RECOMMEND"]) {
    const system = await makeSystem({ stage: "OG3" });
    const ids = [null, groups[0].id, groups[1].id];
    for (const [i, id] of ids.entries()) {
      await firstReview(system.id, id, first[i]);
      await secondReview(system.id, id, second[i]);
    }
    return system;
  }

  const base = (systemId: string, slug: string) => `/api/systems/${systemId}/evaluation/${slug}`;
  const decideOg3 = (userKey: string, systemId: string, body: unknown) =>
    og3Decision(requestAs(users[userKey].id, base(systemId, "og3-decision"), { method: "POST", body }), ctxFor(systemId));
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
  const submit = (userKey: string, systemId: string) =>
    submitSecondRound(requestAs(users[userKey].id, base(systemId, "submit-second-round"), { method: "POST" }), ctxFor(systemId));
  const completeRiskAnalysis = async (systemId: string) => {
    const row = await prisma.riskAnalysis.create({ data: { systemId, heldOn: new Date(), recordedById: users.risk.id } });
    return completeAnalysis(requestAs(users.risk.id, `/api/systems/${systemId}/risk-analyses/${row.id}/complete`, { method: "POST" }), {
      params: Promise.resolve({ id: systemId, analysisId: row.id }),
    });
  };
  /** Everything the second-round submit needs: every mandatory Control answered and every Full-track second-round document provided. */
  const readyForSubmit = async (systemId: string) => {
    const system = await prisma.system.findUniqueOrThrow({ where: { id: systemId }, include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } } });
    for (const control of await getUnaddressedMandatoryControls(system)) {
      await prisma.controlAssessment.upsert({
        where: { systemId_controlId: { systemId, controlId: control.id } },
        update: { status: "FULFILLED" },
        create: { systemId, controlId: control.id, status: "FULFILLED" },
      });
    }
    for (const requirement of await prisma.documentRequirement.findMany({ where: { stage: "SECOND_ROUND", tracks: { has: "FULL" } }, select: { id: true } })) {
      await prisma.systemDocument.upsert({
        where: { systemId_documentRequirementId: { systemId, documentRequirementId: requirement.id } },
        update: { provided: true, link: "https://example.com/doc" },
        create: { systemId, documentRequirementId: requirement.id, link: "https://example.com/doc", provided: true, updatedById: users.owner.id },
      });
    }
  };

  const stateOf = (systemId: string) => prisma.system.findUniqueOrThrow({ where: { id: systemId } });
  const decisions = (systemId: string) => prisma.gateDecision.findMany({ where: { systemId }, orderBy: { decidedAt: "asc" } });
  const recs = (systemId: string) => prisma.recommendation.findMany({ where: { systemId }, orderBy: [{ givenAt: "asc" }, { id: "asc" }] });
  const live = async (systemId: string, stage: EvaluationStage) => (await recs(systemId)).filter((r) => r.stage === stage && r.voidedAt === null);
  const events = (systemId: string, action?: string) =>
    prisma.changeEvent.findMany({ where: { systemId, ...(action ? { action: action as never } : {}) }, orderBy: { createdAt: "asc" } });
  /** Everything a refused write could have changed, as one comparable value. */
  async function snapshot(systemId: string) {
    return JSON.stringify({
      system: await stateOf(systemId),
      decisions: await decisions(systemId),
      recs: await recs(systemId),
      events: (await events(systemId)).map((event) => event.id),
    });
  }
  const edit = (systemId: string, control: { id: string }) =>
    patchAssessment(requestAs(users.owner.id, `/api/systems/${systemId}/assessments/${control.id}`, { method: "PATCH", body: { status: "FULFILLED", evidence: "Edited" } }), {
      params: Promise.resolve({ id: systemId, controlId: control.id }),
    });

  beforeAll(async () => {
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("bso", "SYSTEM_OWNER");
    await makeUser("reviewer", "REVIEWER");
    await makeUser("admin", "ADMIN");
    await makeUser("risk", "RISK_OWNER");
    await makeUser("member1", "SYSTEM_OWNER");
    await makeUser("member2", "VIEWER");

    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 332 Facet ${SUFFIX}` } })).id;
    for (const [i, member] of [[0, "member1"], [1, "member2"]] as [number, string][]) {
      const group = await prisma.reviewGroup.create({ data: { name: `Test 332 Group ${i + 1} ${SUFFIX}`, members: { connect: [{ id: users[member].id }] } } });
      groups.push({ id: group.id, name: group.name });
      const framework = await createFixtureFramework(`332 f${i + 1}`);
      frameworkIds.push(framework.id);
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: group.id } });
      const control = await prisma.control.create({
        data: {
          code: `T332-${i}-${SUFFIX}`,
          title: `Test 332 Control ${i}`,
          description: "Test",
          category: "Test",
          applicability: "PER_SYSTEM",
          deploymentFacets: { connect: [{ id: facetId }] },
        },
      });
      controls.push({ id: control.id, code: control.code });
      await mapControlsToFramework(framework.id, [control.id]);
    }
    requirementIds.push((await prisma.documentRequirement.create({ data: { name: `Test 332 Second round ${SUFFIX}`, stage: "SECOND_ROUND", tracks: ["FULL"] } })).id);
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // decisions, Recommendations, documents, assessments cascade
    await prisma.documentRequirement.deleteMany({ where: { id: { in: requirementIds } } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controls.map((c) => c.id) } } });
    await prisma.framework.updateMany({ where: { id: { in: frameworkIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  }, 60_000);

  describe("the full path", () => {
    it("runs from the second round through the Risk Analysis and the second OAG review to OG3 and an ATO, keeping the first review as history", async () => {
      const system = await makeSystem({ stage: "SECOND_ROUND" });
      // The first review's Recommendations, from before OG2: the second review starts every participant open despite them.
      await firstReview(system.id, null);
      await firstReview(system.id, groups[0].id, "ADVISE_AGAINST", "Too exposed");
      await firstReview(system.id, groups[1].id);

      // The second round uses the Full-track Document Requirements.
      const shown = await view(system.id, "owner");
      expect(shown.secondRound.documentsMissing.map((d: { name: string }) => d.name)).toContain(`Test 332 Second round ${SUFFIX}`);
      expect((await submit("owner", system.id)).status).toBe(409);
      await readyForSubmit(system.id);
      expect((await submit("owner", system.id)).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe("RISK_ANALYSIS_2");

      expect((await completeRiskAnalysis(system.id)).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe("OAG_REVIEW_2");
      expect((await events(system.id, "EVALUATION_STAGE_CHANGED")).map((e) => e.detail).at(-1)).toBe("Risk Analysis completed: moved to the OAG review");

      // Everyone is open again, and the first review's Recommendations are shown as closed beside the live second review.
      const second = await view(system.id, "admin");
      expect(second.oag2.open).toBe(true);
      expect(second.oag2.participants.map((p: { reviewGroupId: string | null }) => p.reviewGroupId)).toEqual([null, groups[0].id, groups[1].id]);
      expect(second.oag2.participants.every((p: { recommendation: unknown }) => p.recommendation === null)).toBe(true);
      expect(second.oag.open).toBe(false);
      expect(second.oag.participants).toHaveLength(3);

      expect((await recommend("reviewer", system.id, null, "RECOMMEND", "Base fine")).status).toBe(201);
      expect((await recommend("member1", system.id, groups[0].id, "RECOMMEND_WITH_CONDITIONS", "Patched")).status).toBe(201);
      expect((await stateOf(system.id)).evaluationStage).toBe("OAG_REVIEW_2");
      const last = await recommend("member2", system.id, groups[1].id);
      expect(last.status).toBe(201);
      expect((await last.json()).closed).toEqual({ stage: "OG3" });
      expect((await stateOf(system.id)).evaluationStage).toBe("OG3");
      const move = (await events(system.id, "EVALUATION_STAGE_CHANGED")).at(-1)!;
      expect([move.detail, move.actorId]).toEqual(["OAG review closed: moved to OG3", "system"]);

      // The first review's rows are untouched; the second review's are its own.
      expect(await live(system.id, "OAG_REVIEW_1")).toHaveLength(3);
      expect(await live(system.id, "OAG_REVIEW_2")).toHaveLength(3);

      // OG3 shows both reviews, as the groups'; the first one's Advise-against asks for a justification.
      const og3 = await view(system.id, "bso");
      expect(og3.oag.participants.map((p: { recommendation: { kind: string } }) => p.recommendation.kind)).toContain("ADVISE_AGAINST");
      expect(og3.oag2.participants.map((p: { name: string }) => p.name)).toEqual(["Base review", groups[0].name, groups[1].name]);
      expect(og3.oag2.participants.every((p: { recommendation: { by: string | null } }) => p.recommendation.by === null)).toBe(true);
      expect(og3.og3).toMatchObject({ canDecide: true, adviseAgainst: true });

      const before = await snapshot(system.id);
      expect((await decideOg3("bso", system.id, { decision: "AUTHORIZE", comment: "Go" })).status).toBe(400);
      expect(await snapshot(system.id)).toBe(before);

      expect((await decideOg3("bso", system.id, { decision: "AUTHORIZE", comment: "Go", justification: "Mitigated by the gateway" })).status).toBe(200);
      const state = await stateOf(system.id);
      expect([state.status, state.evaluationStage]).toEqual(["APPROVED", "OG3"]);
      expect((await decisions(system.id)).map((d) => [d.gate, d.outcome, d.justification])).toEqual([["OG3", "AUTHORIZE", "Mitigated by the gateway"]]);
    });

    it("lists the stages a Full-track System can be sent back to from OG3", () => {
      expect(sendBackTargets("FULL", "OG3")).toEqual(["FIRST_ROUND", "OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1", "OG2", "SECOND_ROUND", "RISK_ANALYSIS_2", "OAG_REVIEW_2"]);
    });
  });

  describe("the second OAG review", () => {
    it("is reopened by an owner's edit in a group's remit, voiding only the second review's Recommendation", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_2" });
      await firstReview(system.id, groups[0].id);
      expect((await recommend("member1", system.id, groups[0].id)).status).toBe(201); // not a repeat: its first Recommendation was review 1's
      expect((await recommend("reviewer", system.id, null)).status).toBe(201);
      expect((await edit(system.id, controls[0])).status).toBe(200);

      const rows = await recs(system.id);
      const second = rows.find((r) => r.stage === "OAG_REVIEW_2" && r.reviewGroupId === groups[0].id)!;
      expect(second.voidedAt).not.toBeNull();
      expect(second.voidReason).toBe(`${controls[0].code} changed after the Recommendation`);
      expect(rows.find((r) => r.stage === "OAG_REVIEW_1")!.voidedAt).toBeNull();
      expect(rows.find((r) => r.stage === "OAG_REVIEW_2" && r.reviewGroupId === null)!.voidedAt).toBeNull();
      expect((await view(system.id, "admin")).oag2.participants.find((p: { reviewGroupId: string | null }) => p.reviewGroupId === groups[0].id).recommendation).toBeNull();
    });

    it("refuses a Recommendation from the wrong person or on a System not at a review, changing nothing", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_2" });
      const done = await atOg3();
      const before = [await snapshot(system.id), await snapshot(done.id)];
      expect((await recommend("member2", system.id, groups[0].id)).status).toBe(403);
      expect((await recommend("owner", system.id, null)).status).toBe(403);
      expect((await recommend("admin", done.id, null)).status).toBe(409);
      expect([await snapshot(system.id), await snapshot(done.id)]).toEqual(before);
    });

    it("refuses a form left open from review 1 once the System is at review 2 (409), writing nothing", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_2" });
      const before = await snapshot(system.id);
      const stale = await recommend("reviewer", system.id, null, "RECOMMEND", "Stale", "OAG_REVIEW_1");
      expect(stale.status).toBe(409);
      expect((await stale.json()).error).toContain("moved on");
      expect(await snapshot(system.id)).toBe(before);
      const atFirst = await makeSystem({ stage: "OAG_REVIEW_1" });
      const firstBefore = await snapshot(atFirst.id);
      expect((await recommend("reviewer", atFirst.id, null, "RECOMMEND", "Early", "OAG_REVIEW_2")).status).toBe(409);
      expect(await snapshot(atFirst.id)).toBe(firstBefore);
    });

    it("refuses a missing or invalid stage (400), writing nothing", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_2" });
      const before = await snapshot(system.id);
      for (const stage of [undefined, "OG3", "", 2]) {
        const response = await giveRecommendationRoute(
          requestAs(users.reviewer.id, base(system.id, "recommendations"), { method: "POST", body: { ...(stage === undefined ? {} : { stage }), reviewGroupId: null, kind: "RECOMMEND", comment: "x" } }),
          ctxFor(system.id),
        );
        expect(response.status, String(stage)).toBe(400);
      }
      expect(await snapshot(system.id)).toBe(before);
    });

    it("lists the open Recommendations in My tasks, with the review's stage", async () => {
      const system = await makeSystem({ stage: "OAG_REVIEW_2" });
      const mine = async () => (await getOpenRecommendationsForUser({ id: users.member1.id, role: "SYSTEM_OWNER" })).filter((task) => task.system.id === system.id);
      expect((await mine()).map((task) => [task.stage, task.participant.reviewGroupId])).toEqual([["OAG_REVIEW_2", groups[0].id]]);
      await recommend("member1", system.id, groups[0].id);
      expect(await mine()).toHaveLength(0);
    });
  });

  describe("OG3 on the Full track", () => {
    it("needs a justification to authorize against a live Advise-against from either review, and changes nothing without one (400)", async () => {
      const cases: [RecommendationKind[], RecommendationKind[]][] = [
        [["RECOMMEND", "ADVISE_AGAINST", "RECOMMEND"], ["RECOMMEND", "RECOMMEND", "RECOMMEND"]],
        [["RECOMMEND", "RECOMMEND", "RECOMMEND"], ["RECOMMEND", "RECOMMEND", "ADVISE_AGAINST"]],
      ];
      for (const [first, second] of cases) {
        const system = await atOg3(first, second);
        const before = await snapshot(system.id);
        expect((await view(system.id, "bso")).og3.adviseAgainst).toBe(true);
        const refused = await decideOg3("bso", system.id, { decision: "AUTHORIZE", comment: "Go" });
        expect(refused.status).toBe(400);
        expect((await refused.json()).error).toBe("A written justification is required to authorize against an Advise-against Recommendation");
        expect(await snapshot(system.id)).toBe(before);
        expect((await decideOg3("bso", system.id, { decision: "AUTHORIZE", comment: "Go", justification: "  " })).status).toBe(400);
        expect(await snapshot(system.id)).toBe(before);
        expect((await decideOg3("bso", system.id, { decision: "AUTHORIZE", comment: "Go", justification: "Accepted" })).status).toBe(200);
        expect((await stateOf(system.id)).status).toBe("APPROVED");
      }
    });

    it("needs none when nobody advises against, or only a voided Advise-against does, and rejecting or sending back never does", async () => {
      const clean = await atOg3();
      expect((await view(clean.id, "bso")).og3.adviseAgainst).toBe(false);
      expect((await decideOg3("bso", clean.id, { decision: "AUTHORIZE", comment: "Go" })).status).toBe(200);
      expect((await decisions(clean.id)).map((d) => d.justification)).toEqual([null]);

      const voided = await atOg3(["ADVISE_AGAINST", "RECOMMEND", "RECOMMEND"]);
      await prisma.recommendation.updateMany({ where: { systemId: voided.id, kind: "ADVISE_AGAINST" }, data: { voidedAt: new Date(), voidReason: "Reopened" } });
      expect((await decideOg3("bso", voided.id, { decision: "AUTHORIZE", comment: "Go" })).status).toBe(200);

      const against = await atOg3(["ADVISE_AGAINST", "RECOMMEND", "RECOMMEND"]);
      expect((await decideOg3("bso", against.id, { decision: "REJECT", comment: "No" })).status).toBe(200);
      const other = await atOg3(["ADVISE_AGAINST", "RECOMMEND", "RECOMMEND"]);
      expect((await decideOg3("bso", other.id, { decision: "SEND_BACK", sendBackTo: "SECOND_ROUND", comment: "Redo" })).status).toBe(200);
    });

    it("refuses a justification for a decision that isn't to authorize (400)", async () => {
      const system = await atOg3();
      const before = await snapshot(system.id);
      expect((await decideOg3("bso", system.id, { decision: "REJECT", comment: "No", justification: "Because" })).status).toBe(400);
      expect(await snapshot(system.id)).toBe(before);
    });

    it("keeps the Self track as it was: no Recommendations, no justification needed", async () => {
      const system = await makeSystem({ stage: "OG3", track: "SELF" });
      const shown = await view(system.id, "bso");
      expect([shown.oag, shown.oag2, shown.og3.adviseAgainst]).toEqual([null, null, false]);
      expect((await decideOg3("bso", system.id, { decision: "AUTHORIZE", comment: "Go" })).status).toBe(200);
    });
  });

  describe("sending back from OG3", () => {
    it.each(["FIRST_ROUND", "OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1"] as const)("to %s voids both OAG reviews' Recommendations, so both run again", async (target) => {
      const system = await atOg3(["RECOMMEND", "ADVISE_AGAINST", "RECOMMEND"], ["RECOMMEND", "RECOMMEND", "RECOMMEND"]);
      expect((await decideOg3("bso", system.id, { decision: "SEND_BACK", sendBackTo: target, comment: "Run them again" })).status).toBe(200);
      const state = await stateOf(system.id);
      expect(state.evaluationStage).toBe(target);
      expect(state.evaluationTrack).toBe(target === "FIRST_ROUND" || target === "OG1" ? null : "FULL");
      const rows = await recs(system.id);
      expect(rows).toHaveLength(6); // kept as history
      expect(rows.every((r) => r.voidedAt !== null && r.voidReason === "The System was sent back at OG3")).toBe(true);
      expect((await decisions(system.id)).map((d) => [d.gate, d.outcome, d.sentBackTo])).toEqual([["OG3", "SEND_BACK", target]]);
    });

    it("to OAG review 1 starts review 1 open again, and review 2 opens afresh once the System gets there again", async () => {
      const system = await atOg3(["RECOMMEND", "ADVISE_AGAINST", "RECOMMEND"]);
      expect((await decideOg3("bso", system.id, { decision: "SEND_BACK", sendBackTo: "OAG_REVIEW_1", comment: "Again" })).status).toBe(200);
      const first = await view(system.id, "admin");
      expect(first.oag.open).toBe(true);
      expect(first.oag.participants.every((p: { recommendation: unknown }) => p.recommendation === null)).toBe(true);
      for (const [key, id] of [["reviewer", null], ["member1", groups[0].id], ["member2", groups[1].id]] as const) {
        expect((await recommend(key, system.id, id)).status).toBe(201);
      }
      expect((await stateOf(system.id)).evaluationStage).toBe("OG2");
      expect(await live(system.id, "OAG_REVIEW_1")).toHaveLength(3);
      expect(await live(system.id, "OAG_REVIEW_2")).toHaveLength(0);
      // Through OG2 and the second round, the Risk Analysis opens review 2 with nobody answered.
      await prisma.system.update({ where: { id: system.id }, data: { evaluationStage: "RISK_ANALYSIS_2", evaluationStageEnteredAt: new Date(Date.now() - 60_000) } });
      expect((await completeRiskAnalysis(system.id)).status).toBe(200);
      const second = await view(system.id, "admin");
      expect([second.stage, second.oag2.open]).toEqual(["OAG_REVIEW_2", true]);
      expect(second.oag2.participants.every((p: { recommendation: unknown }) => p.recommendation === null)).toBe(true);
    });

    it.each(["OG2", "SECOND_ROUND", "RISK_ANALYSIS_2", "OAG_REVIEW_2"] as const)("to %s voids only the second review's Recommendations and keeps the first's live", async (target) => {
      const system = await atOg3(["RECOMMEND", "ADVISE_AGAINST", "RECOMMEND"]);
      expect((await decideOg3("bso", system.id, { decision: "SEND_BACK", sendBackTo: target, comment: "Redo" })).status).toBe(200);
      expect((await stateOf(system.id)).evaluationStage).toBe(target);
      expect(await live(system.id, "OAG_REVIEW_1")).toHaveLength(3);
      const second = (await recs(system.id)).filter((r) => r.stage === "OAG_REVIEW_2");
      expect(second).toHaveLength(3);
      expect(second.every((r) => r.voidedAt !== null && r.voidReason === "The System was sent back at OG3")).toBe(true);
    });

    it("to the second OAG review starts it open and returns to OG3 once everyone has recommended again", async () => {
      const system = await atOg3();
      expect((await decideOg3("bso", system.id, { decision: "SEND_BACK", sendBackTo: "OAG_REVIEW_2", comment: "Ask again" })).status).toBe(200);
      const shown = await view(system.id, "admin");
      expect([shown.oag2.open, shown.oag2.participants.every((p: { recommendation: unknown }) => p.recommendation === null)]).toEqual([true, true]);
      for (const [key, id] of [["reviewer", null], ["member1", groups[0].id], ["member2", groups[1].id]] as const) {
        expect((await recommend(key, system.id, id, "RECOMMEND", "Again")).status).toBe(201);
      }
      expect((await stateOf(system.id)).evaluationStage).toBe("OG3");
      expect(await live(system.id, "OAG_REVIEW_2")).toHaveLength(3);
    });

    it("refuses OG3 itself as a target (409), changing nothing", async () => {
      const system = await atOg3();
      const before = await snapshot(system.id);
      expect((await decideOg3("bso", system.id, { decision: "SEND_BACK", sendBackTo: "OG3", comment: "No" })).status).toBe(409);
      expect(await snapshot(system.id)).toBe(before);
    });
  });
});

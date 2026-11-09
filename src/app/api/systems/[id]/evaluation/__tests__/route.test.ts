import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { applyFrameworkScopeDeclared, applyFrameworkScopeRemoved } from "@/lib/framework-scope";
import { getOpenVerdictsForUser } from "@/lib/evaluation-og1";
import { STAGED_SYSTEM_REFUSAL } from "@/lib/evaluation-stages";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { POST as createSystem } from "@/app/api/systems/route";
import { POST as classicSubmit } from "../../submit/route";
import { POST as classicOnboard } from "../../onboard/route";
import { POST as classicApproval } from "../../approvals/route";
import { PATCH as patchAssessment } from "../../assessments/[controlId]/route";
import { GET as getEvaluation } from "../route";
import { POST as submitFirstRound } from "../submit-first-round/route";
import { POST as giveVerdictRoute } from "../verdicts/route";

/**
 * Staged evaluation up to OG1 (#328). Fixtures only (CI's database is migrated, not seeded): two Review Groups, each tied to its
 * own Framework with one mandatory first-round Control scoped to a fixture Deployment Facet, Systems that declare both Frameworks,
 * and one user per role that matters. The App Setting is flipped only while a System is being created, and restored.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;
const SETTING_KEY = "evaluation.stagedForNewSystems";

function requestAs(userId: string | null, url: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, {
    method: init?.method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Staged evaluation up to OG1 (#328)", { timeout: 60_000 }, () => {
  const users: Record<string, { id: string; name: string }> = {};
  const groups: { id: string; name: string }[] = [];
  const frameworkIds: string[] = [];
  const controls: { id: string; code: string }[] = [];
  const systemIds: string[] = [];
  let facetId: string;

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-328-${key}-${SUFFIX}@example.com`, name: `Test 328 ${key} ${SUFFIX}`, role } });
    users[key] = { id: user.id, name: user.name };
  }

  /** A staged System at the given stage, declaring the given Frameworks (both by default), with a BSO and a completed Risk Analysis. */
  async function makeSystem(
    options: {
      stage?: "FIRST_ROUND" | "OG1";
      scope?: number[];
      ownerKey?: string;
      bso?: boolean;
      riskAnalysis?: boolean;
      markFirstRound?: number[];
    } = {},
  ) {
    const scope = options.scope ?? [0, 1];
    const enteredAt = new Date(Date.now() - 60_000);
    const system = await prisma.system.create({
      data: {
        name: `Test 328 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users[options.ownerKey ?? "owner"].id,
        businessSystemOwnerId: options.bso === false ? null : users.bso.id,
        evaluationStage: options.stage ?? "OG1",
        evaluationStageEnteredAt: enteredAt,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: scope.map((i) => ({ id: frameworkIds[i] })) },
      },
    });
    systemIds.push(system.id);
    if (options.riskAnalysis !== false) {
      await prisma.riskAnalysis.create({
        data: { systemId: system.id, heldOn: new Date(), recordedById: users.admin.id, completedAt: new Date(), completedById: users.admin.id },
      });
    }
    return system;
  }

  /** Marks the Controls of these Frameworks first round (every one, by default). */
  async function markFirstRound(which: number[] = [0, 1]) {
    for (const i of which) {
      await prisma.frameworkFirstRoundControl.upsert({
        where: { frameworkId_controlId: { frameworkId: frameworkIds[i], controlId: controls[i].id } },
        update: {},
        create: { frameworkId: frameworkIds[i], controlId: controls[i].id },
      });
    }
  }
  const unmarkFirstRound = () => prisma.frameworkFirstRoundControl.deleteMany({ where: { frameworkId: { in: frameworkIds } } });

  const submit = (systemId: string, userKey = "owner") =>
    submitFirstRound(requestAs(users[userKey].id, `/api/systems/${systemId}/evaluation/submit-first-round`, { method: "POST" }), ctxFor(systemId));
  const verdict = (systemId: string, userKey: string, reviewGroupId: string | null, value: "SELF" | "FULL" = "SELF", comment = "Because") =>
    giveVerdictRoute(
      requestAs(users[userKey].id, `/api/systems/${systemId}/evaluation/verdicts`, { method: "POST", body: { reviewGroupId, verdict: value, comment } }),
      ctxFor(systemId),
    );
  const view = async (systemId: string, userKey = "admin") => {
    const response = await getEvaluation(requestAs(users[userKey].id, `/api/systems/${systemId}/evaluation`), ctxFor(systemId));
    return { status: response.status, body: await response.json() };
  };
  const stateOf = (systemId: string) => prisma.system.findUniqueOrThrow({ where: { id: systemId }, select: { evaluationStage: true, evaluationTrack: true, status: true } });
  const eventsOf = (systemId: string, action?: string) =>
    prisma.changeEvent.findMany({ where: { systemId, ...(action ? { action: action as never } : {}) }, orderBy: { createdAt: "asc" } });
  const verdictCount = (systemId: string) => prisma.trackVerdict.count({ where: { systemId } });
  const classified = (systemId: string) =>
    prisma.system.findUniqueOrThrow({ where: { id: systemId }, include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } } });

  beforeAll(async () => {
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("bso", "SYSTEM_OWNER");
    await makeUser("reviewer", "REVIEWER");
    await makeUser("admin", "ADMIN");
    await makeUser("adminOwner", "ADMIN");
    await makeUser("member1", "SYSTEM_OWNER");
    await makeUser("member2", "VIEWER");
    await makeUser("other", "SYSTEM_OWNER");
    await makeUser("viewer", "VIEWER");

    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 328 Facet ${SUFFIX}` } })).id;
    for (const [i, member] of [[0, "member1"], [1, "member2"]] as [number, string][]) {
      const group = await prisma.reviewGroup.create({
        data: { name: `Test 328 Group ${i + 1} ${SUFFIX}`, members: { connect: [{ id: users[member].id }] } },
      });
      groups.push({ id: group.id, name: group.name });
      const framework = await createFixtureFramework(`328 f${i + 1}`);
      frameworkIds.push(framework.id);
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: group.id } });
      const control = await prisma.control.create({
        data: {
          code: `T328-${i}-${SUFFIX}`,
          title: `Test 328 First round ${i}`,
          description: "Test",
          category: "Test",
          applicability: "PER_SYSTEM",
          deploymentFacets: { connect: [{ id: facetId }] },
        },
      });
      controls.push({ id: control.id, code: control.code });
      await mapControlsToFramework(framework.id, [control.id]);
    }
    await markFirstRound();
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // verdicts, assessments, Risk Analyses cascade
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controls.map((c) => c.id) } } });
    await prisma.framework.updateMany({ where: { id: { in: frameworkIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  }, 60_000);

  describe("the App Setting decides the flow of a new System", () => {
    async function createWithSetting(value: boolean | null) {
      const before = await prisma.appSetting.findUnique({ where: { key: SETTING_KEY } });
      try {
        if (value === null) await prisma.appSetting.deleteMany({ where: { key: SETTING_KEY } });
        else await prisma.appSetting.upsert({ where: { key: SETTING_KEY }, update: { value }, create: { key: SETTING_KEY, value } });
        const response = await createSystem(
          requestAs(users.owner.id, "/api/systems", { method: "POST", body: { name: `Test 328 Created ${SUFFIX}-${systemIds.length}`, deploymentFacetIds: [facetId] } }),
        );
        const body = await response.json();
        systemIds.push(body.system.id);
        return { response, id: body.system.id as string };
      } finally {
        if (before) await prisma.appSetting.update({ where: { key: SETTING_KEY }, data: { value: before.value as never } });
        else await prisma.appSetting.deleteMany({ where: { key: SETTING_KEY } });
      }
    }

    it("starts a classic System when the setting is off or unset", async () => {
      for (const value of [false, null]) {
        const { response, id } = await createWithSetting(value);
        expect(response.status).toBe(201);
        expect(await stateOf(id)).toEqual({ evaluationStage: null, evaluationTrack: null, status: "DRAFT" });
        expect(await eventsOf(id, "EVALUATION_STAGE_CHANGED")).toHaveLength(0);
        expect((await view(id)).status).toBe(404);
      }
    });

    it("starts a staged System in its first round when the setting is on, and says so in a Change Event", async () => {
      const { response, id } = await createWithSetting(true);
      expect(response.status).toBe(201);
      expect(await stateOf(id)).toEqual({ evaluationStage: "FIRST_ROUND", evaluationTrack: null, status: "DRAFT" });
      const events = await eventsOf(id, "EVALUATION_STAGE_CHANGED");
      expect(events).toHaveLength(1);
      expect(events[0].detail).toContain("first round");
      const { status, body } = await view(id);
      expect(status).toBe(200);
      expect(body.evaluation.stage).toBe("FIRST_ROUND");
    });
  });

  describe("submitting the first round", () => {
    it("refuses a System without a Business System Owner, naming it, and changes nothing", async () => {
      const system = await makeSystem({ stage: "FIRST_ROUND", bso: false });
      const events = (await eventsOf(system.id)).length;
      const response = await submit(system.id);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain("Business System Owner");
      expect((await stateOf(system.id)).evaluationStage).toBe("FIRST_ROUND");
      expect(await eventsOf(system.id)).toHaveLength(events);
    });

    it("refuses a System whose Risk Analysis isn't completed (or was completed before the first round began)", async () => {
      const none = await makeSystem({ stage: "FIRST_ROUND", riskAnalysis: false });
      const response = await submit(none.id);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain("Risk Analysis");

      const old = await makeSystem({ stage: "FIRST_ROUND", riskAnalysis: false });
      await prisma.riskAnalysis.create({
        data: { systemId: old.id, heldOn: new Date(), completedAt: new Date(Date.now() - 3_600_000), completedById: users.admin.id },
      });
      expect((await submit(old.id)).status).toBe(409);
      for (const id of [none.id, old.id]) expect((await stateOf(id)).evaluationStage).toBe("FIRST_ROUND");
    });

    it("refuses a System with mandatory first-round Controls that have no Assessment, naming them, all reasons at once", async () => {
      const system = await makeSystem({ stage: "FIRST_ROUND", bso: false, riskAnalysis: false });
      const response = await submit(system.id);
      const error = (await response.json()).error as string;
      expect(response.status).toBe(409);
      expect(error).toContain(controls[0].code);
      expect(error).toContain(controls[1].code);
      expect(error).toContain("Business System Owner");
      expect(error).toContain("Risk Analysis");
      expect((await stateOf(system.id)).evaluationStage).toBe("FIRST_ROUND");
    });

    it("lets only the owner or an Admin submit, and refuses a System that isn't in its first round", async () => {
      const system = await makeSystem({ stage: "FIRST_ROUND" });
      for (const key of ["other", "bso", "reviewer", "member1"]) {
        const status = (await submit(system.id, key)).status;
        expect([403, 404]).toContain(status);
      }
      expect((await submit(system.id, "viewer")).status).toBe(404);
      expect((await stateOf(system.id)).evaluationStage).toBe("FIRST_ROUND");
      const og1 = await makeSystem({ stage: "OG1" });
      expect((await submit(og1.id)).status).toBe(409);
      expect((await stateOf(og1.id)).evaluationStage).toBe("OG1");
    });

    it("moves a ready System to OG1 with a Change Event, and the verdicts then count only from OG1", async () => {
      const system = await makeSystem({ stage: "FIRST_ROUND" });
      for (const control of controls) {
        const patched = await patchAssessment(
          requestAs(users.owner.id, `/api/systems/${system.id}/assessments/${control.id}`, { method: "PATCH", body: { status: "FULFILLED", evidence: "Done" } }),
          { params: Promise.resolve({ id: system.id, controlId: control.id }) },
        );
        expect(patched.status).toBe(200);
      }
      const ready = (await view(system.id, "owner")).body.evaluation;
      expect(ready.canSubmit).toBe(true);
      expect(ready.firstRound.ready).toBe(true);

      const response = await submit(system.id);
      expect(response.status).toBe(200);
      expect(await stateOf(system.id)).toMatchObject({ evaluationStage: "OG1", status: "DRAFT" });
      const events = await eventsOf(system.id, "EVALUATION_STAGE_CHANGED");
      expect(events.map((e) => e.detail)).toContain("First round submitted: moved to OG1");
      expect((await submit(system.id)).status).toBe(409); // not twice
    });
  });

  describe("the classic flow refuses a staged System", () => {
    it("answers 409 on submit, onboard and approvals, and changes nothing", async () => {
      const system = await makeSystem({ stage: "OG1" });
      const before = { state: await stateOf(system.id), events: (await eventsOf(system.id)).length };
      const submitted = await classicSubmit(requestAs(users.owner.id, `/api/systems/${system.id}/submit`, { method: "POST" }), ctxFor(system.id));
      const onboarded = await classicOnboard(requestAs(users.admin.id, `/api/systems/${system.id}/onboard`, { method: "POST" }), ctxFor(system.id));
      const approved = await classicApproval(
        requestAs(users.admin.id, `/api/systems/${system.id}/approvals`, { method: "POST", body: { decision: "APPROVED", comment: "Fine", reviewGroupId: null } }),
        ctxFor(system.id),
      );
      for (const response of [submitted, onboarded, approved]) {
        expect(response.status).toBe(409);
        expect((await response.json()).error).toBe(STAGED_SYSTEM_REFUSAL);
      }
      expect(await stateOf(system.id)).toEqual(before.state);
      expect(await eventsOf(system.id)).toHaveLength(before.events);
      expect(await prisma.approval.count({ where: { systemId: system.id } })).toBe(0);
    });

    it("still checks permissions before it refuses", async () => {
      const system = await makeSystem({ stage: "OG1" });
      expect((await classicSubmit(requestAs(users.reviewer.id, `/api/systems/${system.id}/submit`, { method: "POST" }), ctxFor(system.id))).status).toBe(403);
      expect((await classicOnboard(requestAs(users.reviewer.id, `/api/systems/${system.id}/onboard`, { method: "POST" }), ctxFor(system.id))).status).toBe(403);
    });
  });

  describe("OG1 verdicts", () => {
    it("lets a group's member give that group's verdict and no other; a Reviewer the base; an Admin any", async () => {
      const system = await makeSystem();
      const [g1, g2] = groups;
      for (const [key, groupId] of [
        ["member1", g2.id],
        ["member1", null],
        ["member2", g1.id],
        ["reviewer", g1.id],
        ["bso", null],
        ["bso", g1.id],
        ["other", null],
      ] as [string, string | null][]) {
        expect([403, 404]).toContain((await verdict(system.id, key, groupId)).status); // 404 for a user who can't see the System
      }
      expect((await verdict(system.id, "viewer", null)).status).toBe(404);
      expect(await verdictCount(system.id)).toBe(0);
      expect((await stateOf(system.id)).evaluationStage).toBe("OG1");

      expect((await verdict(system.id, "member1", g1.id)).status).toBe(201);
      expect((await verdict(system.id, "reviewer", null)).status).toBe(201);
      expect((await verdict(system.id, "admin", g2.id)).status).toBe(201);
      expect(await verdictCount(system.id)).toBe(3);
    });

    it("gives nobody a verdict on a System they own, an Admin included", async () => {
      const system = await makeSystem({ ownerKey: "adminOwner" });
      expect((await verdict(system.id, "adminOwner", null)).status).toBe(403);
      expect((await verdict(system.id, "adminOwner", groups[0].id)).status).toBe(403);
      const memberOwned = await makeSystem({ ownerKey: "member1" });
      expect((await verdict(memberOwned.id, "member1", groups[0].id)).status).toBe(403);
      expect(await verdictCount(system.id)).toBe(0);
      expect(await verdictCount(memberOwned.id)).toBe(0);
    });

    it("refuses a second verdict from a participant that has one, a participant that isn't part of OG1, bad bodies, and a System not at OG1", async () => {
      const system = await makeSystem({ scope: [0] });
      expect((await verdict(system.id, "member1", groups[0].id, "FULL")).status).toBe(201);
      expect((await verdict(system.id, "member1", groups[0].id, "SELF")).status).toBe(409);
      expect((await verdict(system.id, "admin", groups[1].id)).status).toBe(409); // group 2's Framework isn't in scope
      const bad = await giveVerdictRoute(
        requestAs(users.admin.id, `/api/systems/${system.id}/evaluation/verdicts`, { method: "POST", body: { reviewGroupId: null, verdict: "MAYBE", comment: "x" } }),
        ctxFor(system.id),
      );
      const noComment = await verdict(system.id, "admin", null, "SELF", "");
      expect(bad.status).toBe(400);
      expect(noComment.status).toBe(400);
      expect(await verdictCount(system.id)).toBe(1);

      const firstRound = await makeSystem({ stage: "FIRST_ROUND" });
      expect((await verdict(firstRound.id, "admin", null)).status).toBe(409);
      expect(await verdictCount(firstRound.id)).toBe(0);
    });

    it("closes OG1 on the Full track when any verdict is Full, with one Change Event carrying the Track", async () => {
      const system = await makeSystem();
      expect((await verdict(system.id, "member1", groups[0].id, "SELF")).status).toBe(201);
      expect((await verdict(system.id, "reviewer", null, "FULL")).status).toBe(201);
      expect((await stateOf(system.id)).evaluationStage).toBe("OG1");
      const last = await verdict(system.id, "member2", groups[1].id, "SELF");
      expect(last.status).toBe(201);
      expect((await last.json()).closed).toMatchObject({ track: "FULL", stage: "QUALIFICATION" });
      expect(await stateOf(system.id)).toMatchObject({ evaluationStage: "QUALIFICATION", evaluationTrack: "FULL", status: "DRAFT" });
      const closing = (await eventsOf(system.id, "EVALUATION_STAGE_CHANGED")).filter((e) => e.detail.startsWith("OG1 closed"));
      expect(closing).toHaveLength(1);
      expect(closing[0].detail).toContain("Full");
      expect((await verdict(system.id, "admin", null)).status).toBe(409); // closed
    });

    it("closes OG1 on the Self track when every verdict is Self", async () => {
      const system = await makeSystem();
      await verdict(system.id, "member1", groups[0].id, "SELF");
      await verdict(system.id, "member2", groups[1].id, "SELF");
      await verdict(system.id, "reviewer", null, "SELF");
      expect(await stateOf(system.id)).toMatchObject({ evaluationStage: "SECOND_ROUND", evaluationTrack: "SELF" });
      const body = (await view(system.id)).body.evaluation;
      expect(body.og1.open).toBe(false);
      expect(body.og1.track).toBe("SELF");
      expect(body.og1.participants).toHaveLength(3);
    });

    it("writes a Change Event per verdict that names the group, and shows it as the group's to a viewer who may not see the person", async () => {
      const system = await makeSystem();
      await verdict(system.id, "member1", groups[0].id, "FULL", "Needs a closer look");
      const events = await eventsOf(system.id, "TRACK_VERDICT_GIVEN");
      expect(events).toHaveLength(1);
      expect(events[0].detail).toBe(`${groups[0].name}: Full: Needs a closer look`);
      expect(events[0].actorId).toBe(users.member1.id);

      const asOwner = (await view(system.id, "owner")).body.evaluation.og1.participants.find((p: { reviewGroupId: string | null }) => p.reviewGroupId === groups[0].id);
      expect(asOwner.verdict.verdict).toBe("FULL");
      expect(asOwner.verdict.by).toBeNull();
      const asAdmin = (await view(system.id, "admin")).body.evaluation.og1.participants.find((p: { reviewGroupId: string | null }) => p.reviewGroupId === groups[0].id);
      expect(asAdmin.verdict.by).toBe(users.member1.name);
    });

    it("lets the base review alone take part when nothing is marked first round", async () => {
      await unmarkFirstRound();
      try {
        const system = await makeSystem();
        const participants = (await view(system.id)).body.evaluation.og1.participants as { name: string }[];
        expect(participants).toHaveLength(1);
        expect((await verdict(system.id, "member1", groups[0].id)).status).toBe(409); // a group that takes no part
        expect((await verdict(system.id, "admin", groups[0].id)).status).toBe(409);
        expect((await verdict(system.id, "reviewer", null, "SELF")).status).toBe(201);
        expect(await stateOf(system.id)).toMatchObject({ evaluationStage: "SECOND_ROUND", evaluationTrack: "SELF" });
      } finally {
        await markFirstRound();
      }
    });
  });

  describe("participation is live", () => {
    it("drops a group when its Framework leaves the scope, and closes OG1 when the last open participant goes", async () => {
      const system = await makeSystem();
      await verdict(system.id, "member1", groups[0].id, "SELF");
      await verdict(system.id, "reviewer", null, "SELF");
      expect((await stateOf(system.id)).evaluationStage).toBe("OG1"); // group 2 still to give its verdict

      await applyFrameworkScopeRemoved(await classified(system.id), { id: frameworkIds[1], name: "F2" }, users.admin.id);
      expect(await stateOf(system.id)).toMatchObject({ evaluationStage: "SECOND_ROUND", evaluationTrack: "SELF" });
    });

    it("adds a group when its Framework joins the scope, and voids the verdict of a group that left", async () => {
      const system = await makeSystem({ scope: [0] });
      await verdict(system.id, "member1", groups[0].id, "SELF");
      expect((await view(system.id)).body.evaluation.og1.participants).toHaveLength(2);

      await applyFrameworkScopeDeclared(await classified(system.id), { id: frameworkIds[1], name: "F2" }, users.admin.id);
      const names = ((await view(system.id)).body.evaluation.og1.participants as { name: string }[]).map((p) => p.name);
      expect(names).toContain(groups[1].name);

      await applyFrameworkScopeRemoved(await classified(system.id), { id: frameworkIds[0], name: "F1" }, users.admin.id);
      const voided = await prisma.trackVerdict.findMany({ where: { systemId: system.id, reviewGroupId: groups[0].id } });
      expect(voided).toHaveLength(1);
      expect(voided[0].voidedAt).not.toBeNull();
      expect((await stateOf(system.id)).evaluationStage).toBe("OG1");
    });
  });

  describe("an owner's edit reopens a verdict", () => {
    const edit = (systemId: string, control: { id: string }, status: "FULFILLED" | "IN_PROGRESS", userKey = "owner") =>
      patchAssessment(
        requestAs(users[userKey].id, `/api/systems/${systemId}/assessments/${control.id}`, { method: "PATCH", body: { status, evidence: "Edited" } }),
        { params: Promise.resolve({ id: systemId, controlId: control.id }) },
      );

    it("voids the verdict of the participant whose remit holds the Control, with the reason, and leaves the others", async () => {
      const system = await makeSystem();
      await verdict(system.id, "member1", groups[0].id, "SELF");
      await verdict(system.id, "reviewer", null, "SELF");
      expect((await edit(system.id, controls[0], "FULFILLED")).status).toBe(200);

      const rows = await prisma.trackVerdict.findMany({ where: { systemId: system.id } });
      const g1 = rows.find((r) => r.reviewGroupId === groups[0].id)!;
      expect(g1.voidedAt).not.toBeNull();
      expect(g1.voidReason).toBe(`${controls[0].code} changed after the verdict`);
      // The Control is also in the base Framework's remit? No: it is mapped to the group's Framework only, so the base keeps its verdict.
      expect(rows.find((r) => r.reviewGroupId === null)!.voidedAt).toBeNull();
      expect((await eventsOf(system.id, "TRACK_VERDICT_REOPENED")).length).toBeGreaterThanOrEqual(1);

      const participant = (await view(system.id, "admin")).body.evaluation.og1.participants.find((p: { reviewGroupId: string | null }) => p.reviewGroupId === groups[0].id);
      expect(participant.verdict).toBeNull();
      expect(participant.reopened.reason).toContain("changed after the verdict");
      expect((await verdict(system.id, "member1", groups[0].id, "FULL")).status).toBe(201); // may answer again
    });

    it("reopens nothing once OG1 has closed", async () => {
      const system = await makeSystem();
      await verdict(system.id, "member1", groups[0].id, "SELF");
      await verdict(system.id, "member2", groups[1].id, "SELF");
      await verdict(system.id, "reviewer", null, "SELF");
      expect((await stateOf(system.id)).evaluationStage).toBe("SECOND_ROUND");
      const events = (await eventsOf(system.id, "TRACK_VERDICT_REOPENED")).length;
      expect((await edit(system.id, controls[0], "FULFILLED")).status).toBe(200);
      expect(await prisma.trackVerdict.count({ where: { systemId: system.id, voidedAt: { not: null } } })).toBe(0);
      expect(await eventsOf(system.id, "TRACK_VERDICT_REOPENED")).toHaveLength(events);
    });
  });

  describe("My tasks", () => {
    it("lists the open verdicts a user may give, and not on a System they own", async () => {
      const system = await makeSystem({ ownerKey: "other" });
      const mine = async (key: string) => (await getOpenVerdictsForUser({ id: users[key].id, role: roleOf(key) })).filter((t) => t.system.id === system.id);
      const roleOf = (key: string): UserRole => ({ member1: "SYSTEM_OWNER", member2: "VIEWER", reviewer: "REVIEWER", admin: "ADMIN", other: "SYSTEM_OWNER", bso: "SYSTEM_OWNER" }[key] as UserRole);

      expect((await mine("member1")).map((t) => t.participant.reviewGroupId)).toEqual([groups[0].id]);
      expect((await mine("member2")).map((t) => t.participant.reviewGroupId)).toEqual([groups[1].id]);
      expect((await mine("reviewer")).map((t) => t.participant.reviewGroupId)).toEqual([null]);
      expect(await mine("admin")).toHaveLength(3);
      expect(await mine("other")).toHaveLength(0);
      expect(await mine("bso")).toHaveLength(0);

      await verdict(system.id, "member1", groups[0].id);
      expect(await mine("member1")).toHaveLength(0);
      expect(await mine("admin")).toHaveLength(2);
    });
  });
});

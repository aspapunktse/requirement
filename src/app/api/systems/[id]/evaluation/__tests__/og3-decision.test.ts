import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getOg3TasksForUser, sendBackTargets } from "@/lib/gate-decisions";
import { POST as decide } from "../og3-decision/route";
import { GET as getEvaluation } from "../route";
import { POST as onboard } from "../../onboard/route";

/**
 * The Business System Owner's decision at OG3 (#330). Fixtures only (CI's database is migrated, not seeded): one user per role that
 * matters and Self-track Systems created directly at OG3.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

function requestAs(userId: string | null, url: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${url}`, { method: init?.method, headers, body: init?.body !== undefined ? JSON.stringify(init.body) : undefined });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("OG3: the Business System Owner decides (#330)", { timeout: 60_000 }, () => {
  const users: Record<string, { id: string; name: string }> = {};
  const systemIds: string[] = [];

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({ data: { email: `test-330-${key}-${SUFFIX}@example.com`, name: `Test 330 ${key} ${SUFFIX}`, role } });
    users[key] = { id: user.id, name: user.name };
  }

  async function makeSystem(over: { ownerKey?: string; stage?: "OG3" | "SECOND_ROUND"; track?: "SELF" | "FULL" } = {}) {
    const system = await prisma.system.create({
      data: {
        name: `Test 330 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users[over.ownerKey ?? "owner"].id,
        businessSystemOwnerId: users.bso.id,
        sensitivityLevel: 3,
        evaluationStage: over.stage ?? "OG3",
        evaluationTrack: over.track ?? "SELF",
        evaluationStageEnteredAt: new Date(Date.now() - 3_600_000),
      },
    });
    systemIds.push(system.id);
    return system;
  }

  const decideAs = (userKey: string, systemId: string, body: unknown) =>
    decide(requestAs(users[userKey].id, `/api/systems/${systemId}/evaluation/og3-decision`, { method: "POST", body }), ctxFor(systemId));
  const stateOf = (systemId: string) => prisma.system.findUniqueOrThrow({ where: { id: systemId } });
  const decisions = (systemId: string) => prisma.gateDecision.findMany({ where: { systemId }, orderBy: { decidedAt: "asc" } });
  const events = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId, action: "GATE_DECIDED" } });
  const viewAs = async (userKey: string, systemId: string) =>
    (await (await getEvaluation(requestAs(users[userKey].id, `/api/systems/${systemId}/evaluation`), ctxFor(systemId))).json()).evaluation;

  beforeAll(async () => {
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("bso", "VIEWER");
    await makeUser("admin", "ADMIN");
    await makeUser("reviewer", "REVIEWER");
    await makeUser("outsider", "SYSTEM_OWNER");
    await makeUser("adminOwner", "ADMIN");
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // decisions and verdicts cascade
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  }, 60_000);

  describe("who may decide", () => {
    it("refuses everyone but the Business System Owner and an Admin who isn't the owner, and changes nothing", async () => {
      const system = await makeSystem();
      for (const key of ["owner", "reviewer"]) {
        const response = await decideAs(key, system.id, { decision: "AUTHORIZE", comment: "Fine" });
        expect(response.status, key).toBe(403);
      }
      // An Admin who owns the System is refused too.
      const owned = await makeSystem({ ownerKey: "adminOwner" });
      expect((await decideAs("adminOwner", owned.id, { decision: "REJECT", comment: "Fine" })).status).toBe(403);
      for (const id of [system.id, owned.id]) {
        const state = await stateOf(id);
        expect([state.status, state.evaluationStage, state.evaluationClosedAt]).toEqual(["DRAFT", "OG3", null]);
        expect(await decisions(id)).toHaveLength(0);
        expect(await events(id)).toHaveLength(0);
      }
    });

    it("answers 404 to a user who can't see the System and 401 to nobody", async () => {
      const system = await makeSystem();
      expect((await decideAs("outsider", system.id, { decision: "AUTHORIZE", comment: "Fine" })).status).toBe(404);
      const anonymous = await decide(requestAs(null, `/api/systems/${system.id}/evaluation/og3-decision`, { method: "POST", body: { decision: "AUTHORIZE", comment: "x" } }), ctxFor(system.id));
      expect(anonymous.status).toBe(401);
      expect(await decisions(system.id)).toHaveLength(0);
    });

    it("lets an Admin who isn't the owner decide", async () => {
      const system = await makeSystem();
      expect((await decideAs("admin", system.id, { decision: "AUTHORIZE", comment: "Admin call" })).status).toBe(200);
      expect((await stateOf(system.id)).status).toBe("APPROVED");
    });

    it("tells the viewer whether they decide, and the stages a send-back may go to", async () => {
      const system = await makeSystem();
      expect((await viewAs("bso", system.id)).og3).toEqual({ canDecide: true, sendBackTargets: ["FIRST_ROUND", "OG1", "SECOND_ROUND", "RISK_ANALYSIS_2"] });
      expect((await viewAs("reviewer", system.id)).og3.canDecide).toBe(false);
      expect((await viewAs("owner", system.id)).og3.canDecide).toBe(false);
    });
  });

  describe("refusals", () => {
    it("requires a comment and, for a send-back, a target; changes nothing", async () => {
      const system = await makeSystem();
      for (const body of [
        { decision: "AUTHORIZE", comment: "   " },
        { decision: "AUTHORIZE" },
        { decision: "SEND_BACK", comment: "Redo" },
        { decision: "AUTHORIZE", comment: "Fine", sendBackTo: "OG1" },
        { decision: "MAYBE", comment: "Fine" },
      ]) {
        expect((await decideAs("bso", system.id, body)).status, JSON.stringify(body)).toBe(400);
      }
      expect(await decisions(system.id)).toHaveLength(0);
      expect((await stateOf(system.id)).status).toBe("DRAFT");
    });

    it("refuses a send-back to a stage that isn't earlier on the Track, or to OG3 itself", async () => {
      const system = await makeSystem();
      for (const target of ["QUALIFICATION", "OG2", "OAG_REVIEW_2", "OG3"]) {
        expect((await decideAs("bso", system.id, { decision: "SEND_BACK", sendBackTo: target, comment: "No" })).status, target).toBe(409);
      }
      const state = await stateOf(system.id);
      expect([state.evaluationStage, state.evaluationTrack]).toEqual(["OG3", "SELF"]);
      expect(await decisions(system.id)).toHaveLength(0);
      expect(await events(system.id)).toHaveLength(0);
    });

    it("refuses a System that isn't at OG3", async () => {
      const system = await makeSystem({ stage: "SECOND_ROUND" });
      const response = await decideAs("bso", system.id, { decision: "AUTHORIZE", comment: "Fine" });
      expect(response.status).toBe(409);
      expect((await stateOf(system.id)).status).toBe("DRAFT");
      expect(await decisions(system.id)).toHaveLength(0);
    });

    it("lists the stages per Track", () => {
      expect(sendBackTargets("SELF")).toEqual(["FIRST_ROUND", "OG1", "SECOND_ROUND", "RISK_ANALYSIS_2"]);
      expect(sendBackTargets("FULL")).toEqual(["FIRST_ROUND", "OG1", "QUALIFICATION", "FIRST_DOCUMENTATION", "OAG_REVIEW_1", "OG2", "SECOND_ROUND", "RISK_ANALYSIS_2", "OAG_REVIEW_2"]);
    });
  });

  describe("Authorize to operate", () => {
    it("gives the System its ATO (Approved), records the decision and a Change Event, and lets its owner mark it Onboarded", async () => {
      const system = await makeSystem();
      // Open Risks never block.
      await prisma.risk.create({ data: { systemId: system.id, title: `Test 330 Risk ${SUFFIX}`, description: "An open Risk", severity: "HIGH", likelihood: "HIGH", status: "OPEN" } });
      const early = await onboard(requestAs(users.owner.id, `/api/systems/${system.id}/onboard`, { method: "POST" }), ctxFor(system.id));
      expect(early.status).toBe(400);

      const response = await decideAs("bso", system.id, { decision: "AUTHORIZE", comment: "  Accepted  " });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ decision: "AUTHORIZE", stage: "OG3" });
      const state = await stateOf(system.id);
      expect([state.status, state.evaluationStage, state.evaluationClosedAt]).toEqual(["APPROVED", "OG3", null]);
      const [row] = await decisions(system.id);
      expect(row).toMatchObject({ gate: "OG3", outcome: "AUTHORIZE", comment: "Accepted", decidedById: users.bso.id, sentBackTo: null });
      const [event] = await events(system.id);
      expect(event).toMatchObject({ actorId: users.bso.id, detail: "OG3: authorized to operate: Accepted" });

      const view = await viewAs("owner", system.id);
      expect(view).toMatchObject({ authorized: true, closed: false, og3: null });
      expect(view.decisions[0]).toMatchObject({ outcome: "AUTHORIZE", by: users.bso.name });

      // Once authorized it can't be decided again, and the owner marks it Onboarded.
      expect((await decideAs("bso", system.id, { decision: "REJECT", comment: "Changed my mind" })).status).toBe(409);
      expect((await stateOf(system.id)).status).toBe("APPROVED");
      const onboarded = await onboard(requestAs(users.owner.id, `/api/systems/${system.id}/onboard`, { method: "POST" }), ctxFor(system.id));
      expect(onboarded.status).toBe(200);
      expect((await stateOf(system.id)).status).toBe("ONBOARDED");
    });
  });

  describe("Reject", () => {
    it("closes the System for good", async () => {
      const system = await makeSystem();
      const response = await decideAs("bso", system.id, { decision: "REJECT", comment: "Too risky" });
      expect(response.status).toBe(200);
      const state = await stateOf(system.id);
      expect(state.status).toBe("REJECTED");
      expect(state.evaluationClosedAt).not.toBeNull();
      expect(await decisions(system.id)).toHaveLength(1);
      expect((await events(system.id))[0].detail).toBe("OG3: rejected: Too risky");
      expect((await decideAs("admin", system.id, { decision: "AUTHORIZE", comment: "Undo" })).status).toBe(409);
      expect((await stateOf(system.id)).status).toBe("REJECTED");
      expect(await decisions(system.id)).toHaveLength(1);
      const view = await viewAs("owner", system.id);
      expect(view).toMatchObject({ closed: true, authorized: false, og3: null });
    });
  });

  describe("Send back", () => {
    it("to the first round clears the Track, voids the OG1 verdicts and starts the stage afresh", async () => {
      const system = await makeSystem();
      await prisma.trackVerdict.create({ data: { systemId: system.id, reviewGroupId: null, verdictById: users.reviewer.id, verdict: "SELF", comment: "Self is fine", givenAt: new Date(Date.now() - 7_200_000) } });
      const before = (await stateOf(system.id)).evaluationStageEnteredAt!;
      const response = await decideAs("bso", system.id, { decision: "SEND_BACK", sendBackTo: "FIRST_ROUND", comment: "Redo it all" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ decision: "SEND_BACK", stage: "FIRST_ROUND" });
      const state = await stateOf(system.id);
      expect([state.evaluationStage, state.evaluationTrack, state.status, state.evaluationClosedAt]).toEqual(["FIRST_ROUND", null, "DRAFT", null]);
      expect(state.evaluationStageEnteredAt!.getTime()).toBeGreaterThan(before.getTime());
      const verdicts = await prisma.trackVerdict.findMany({ where: { systemId: system.id } });
      expect(verdicts.every((v) => v.voidedAt !== null)).toBe(true);
      const [row] = await decisions(system.id);
      expect(row).toMatchObject({ outcome: "SEND_BACK", sentBackTo: "FIRST_ROUND", comment: "Redo it all" });
      expect((await events(system.id))[0].detail).toBe("OG3: sent back to First round: Redo it all");
      // The tab now reads the first round, and the decision stays in its history.
      const view = await viewAs("owner", system.id);
      expect(view).toMatchObject({ stage: "FIRST_ROUND", track: null, og3: null });
      expect(view.decisions).toHaveLength(1);
    });

    it("to OG1 clears the Track and reopens OG1 without redoing the first round", async () => {
      const system = await makeSystem();
      await prisma.trackVerdict.create({ data: { systemId: system.id, reviewGroupId: null, verdictById: users.reviewer.id, verdict: "SELF", comment: "Self", givenAt: new Date(Date.now() - 7_200_000) } });
      expect((await decideAs("bso", system.id, { decision: "SEND_BACK", sendBackTo: "OG1", comment: "Check the Track again" })).status).toBe(200);
      const state = await stateOf(system.id);
      expect([state.evaluationStage, state.evaluationTrack]).toEqual(["OG1", null]);
      expect((await prisma.trackVerdict.findMany({ where: { systemId: system.id, voidedAt: null } })).length).toBe(0);
    });

    it("to a later stage keeps the Track and the OG1 verdicts, and re-enters that stage now", async () => {
      for (const target of ["SECOND_ROUND", "RISK_ANALYSIS_2"] as const) {
        const system = await makeSystem();
        await prisma.trackVerdict.create({ data: { systemId: system.id, reviewGroupId: null, verdictById: users.reviewer.id, verdict: "SELF", comment: "Self", givenAt: new Date(Date.now() - 7_200_000) } });
        const before = (await stateOf(system.id)).evaluationStageEnteredAt!;
        expect((await decideAs("admin", system.id, { decision: "SEND_BACK", sendBackTo: target, comment: `Back to ${target}` })).status, target).toBe(200);
        const state = await stateOf(system.id);
        expect([state.evaluationStage, state.evaluationTrack, state.status]).toEqual([target, "SELF", "DRAFT"]);
        expect(state.evaluationStageEnteredAt!.getTime()).toBeGreaterThan(before.getTime());
        expect((await prisma.trackVerdict.findMany({ where: { systemId: system.id, voidedAt: null } })).length).toBe(1);
        // The System can reach OG3 again later and be decided there: a second decision is allowed after a send-back.
        await prisma.system.update({ where: { id: system.id }, data: { evaluationStage: "OG3" } });
        expect((await decideAs("bso", system.id, { decision: "AUTHORIZE", comment: "Now fine" })).status).toBe(200);
        expect(await decisions(system.id)).toHaveLength(2);
      }
    });
  });

  describe("My tasks", () => {
    it("lists a System waiting at OG3 for its Business System Owner only, until it is decided", async () => {
      const system = await makeSystem();
      const ids = async (key: string) => (await getOg3TasksForUser(users[key])).map((task) => task.id);
      expect(await ids("bso")).toContain(system.id);
      for (const key of ["owner", "admin", "reviewer", "outsider"]) expect(await ids(key), key).not.toContain(system.id);
      await decideAs("bso", system.id, { decision: "AUTHORIZE", comment: "Fine" });
      expect(await ids("bso")).not.toContain(system.id);
      const waiting = await makeSystem({ stage: "SECOND_ROUND" });
      expect(await ids("bso")).not.toContain(waiting.id);
    });
  });
});

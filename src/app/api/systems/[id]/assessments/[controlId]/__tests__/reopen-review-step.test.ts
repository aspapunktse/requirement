import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { loadReviewRounds } from "@/lib/review-steps";
import { saveOrganizationImplementationWithEvents } from "@/lib/organization-inheritance";
import { getOrganizationControl } from "@/lib/organization-implementation";
import { evaluateCheckUp } from "@/lib/check-up-evaluations";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { createFixtureFramework, mapControlsToBase, mapControlsToFramework } from "@/test/framework-fixtures";
import { GET as getApprovals, POST as postApproval } from "../../../approvals/route";
import { DELETE as removeStale, PATCH as patchAssessment } from "../route";
import { PATCH as patchAnswer } from "../answer/route";
import { POST as resetToInherited } from "../reset/route";

/**
 * An approved Review Step reopens when a person edits an Assessment in its remit (#200). Fixtures only
 * (CI's database is migrated, not seeded): two Review Groups tied to a Framework each, a third Framework
 * with no group, Controls scoped to a fixture Deployment Facet and mapped to those (or to the base
 * Framework), and In Review Systems that declare the three Frameworks. Every step is decided through the
 * approvals route and every edit through the assessment routes.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

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
const ctxForControl = (id: string, controlId: string) => ({ params: Promise.resolve({ id, controlId }) });

type Fixture = { id: string; code: string };

describe("Reopening an approved Review Step when its remit is edited (#200)", { timeout: 30_000 }, () => {
  const users = {} as Record<"owner" | "admin" | "riskOwner" | "reviewer" | "member1" | "member2" | "other", string>;
  const groups: { id: string; name: string }[] = [];
  const frameworkIds: string[] = [];
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  let facetId: string;
  let facetOtherId: string;
  const c = {} as Record<
    "g1" | "g2" | "noGroup" | "shared" | "base" | "baseAndG1" | "both" | "staleG1" | "staleOrphan" | "second",
    Fixture
  >;

  async function makeUser(key: keyof typeof users, role: UserRole) {
    users[key] = (
      await prisma.user.create({ data: { email: `test-200-${key}-${SUFFIX}@example.com`, name: `Test 200 ${key}`, role } })
    ).id;
  }

  async function makeControl(
    key: keyof typeof c,
    options: { frameworks?: string[]; base?: boolean; facet?: string; applicability?: "PER_SYSTEM" | "BOTH" },
  ) {
    const control = await prisma.control.create({
      data: {
        code: `T200-${key}-${SUFFIX}`,
        title: `Test 200 ${key}`,
        description: "Test",
        category: "Test",
        applicability: options.applicability ?? "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: options.facet ?? facetId }] },
      },
    });
    controlIds.push(control.id);
    c[key] = { id: control.id, code: control.code };
    for (const frameworkId of options.frameworks ?? []) await mapControlsToFramework(frameworkId, [control.id]);
    if (options.base) await mapControlsToBase([control.id]);
  }

  /** An In Review System with an open round, declaring the three Frameworks and the live Facet. */
  async function makeSystem(options: { status?: "IN_REVIEW" | "DRAFT" | "APPROVED"; isProvider?: boolean } = {}) {
    const system = await prisma.system.create({
      data: {
        name: `Test 200 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users.owner,
        status: options.status ?? "IN_REVIEW",
        isProvider: options.isProvider ?? false,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: frameworkIds.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    await prisma.reviewRound.create({ data: { systemId: system.id } });
    return system.id;
  }

  const approve = async (systemId: string, userKey: keyof typeof users, reviewGroupId: string | null) => {
    const response = await postApproval(
      requestAs(users[userKey], `/api/systems/${systemId}/approvals`, {
        method: "POST",
        body: { decision: "APPROVED", comment: "Fine", reviewGroupId },
      }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(201);
  };
  const approveG1 = (systemId: string) => approve(systemId, "member1", groups[0].id);
  const approveG2 = (systemId: string) => approve(systemId, "member2", groups[1].id);
  const approveBase = (systemId: string) => approve(systemId, "reviewer", null);

  const edit = (
    systemId: string,
    control: Fixture,
    body: { status: ControlAssessmentStatus; evidence?: string | null; notes?: string | null },
    userKey: keyof typeof users = "owner",
  ) =>
    patchAssessment(
      requestAs(users[userKey], `/api/systems/${systemId}/assessments/${control.id}`, { method: "PATCH", body }),
      ctxForControl(systemId, control.id),
    );

  const stepStatuses = async (systemId: string) => {
    const body = await (await getApprovals(requestAs(users.admin, `/api/systems/${systemId}/approvals`), ctxFor(systemId))).json();
    return Object.fromEntries(
      (body.steps as { reviewGroupId: string | null; name: string; status: string }[]).map((step) => [
        step.reviewGroupId === null ? "base" : step.reviewGroupId === groups[0].id ? "g1" : "g2",
        step.status,
      ]),
    ) as Record<"base" | "g1" | "g2", string>;
  };
  const statusOf = async (systemId: string) => (await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).status;
  const reopenEvents = (systemId: string) =>
    prisma.changeEvent.findMany({ where: { systemId, action: "REVIEW_STEP_REOPENED" }, orderBy: { createdAt: "asc" } });
  const liveApprovals = (systemId: string) => prisma.approval.count({ where: { systemId, voidedAt: null } });

  beforeAll(async () => {
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("admin", "ADMIN");
    await makeUser("riskOwner", "RISK_OWNER");
    await makeUser("reviewer", "REVIEWER");
    await makeUser("member1", "SYSTEM_OWNER");
    await makeUser("member2", "VIEWER");
    await makeUser("other", "SYSTEM_OWNER");

    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 200 Facet ${SUFFIX}` } })).id;
    facetOtherId = (await prisma.deploymentFacet.create({ data: { name: `Test 200 Other Facet ${SUFFIX}` } })).id;
    for (const [index, member] of [[0, "member1"], [1, "member2"]] as const) {
      const group = await prisma.reviewGroup.create({
        data: { name: `Test 200 Group ${index + 1} ${SUFFIX}`, members: { connect: [{ id: users[member] }] } },
      });
      groups.push({ id: group.id, name: group.name });
      const framework = await createFixtureFramework(`200 g${index + 1}`);
      frameworkIds.push(framework.id);
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: group.id } });
    }
    frameworkIds.push((await createFixtureFramework("200 nogroup")).id);

    const [fw1, fw2, fw3] = frameworkIds;
    await makeControl("g1", { frameworks: [fw1] });
    await makeControl("second", { frameworks: [fw1] });
    await makeControl("g2", { frameworks: [fw2] });
    await makeControl("noGroup", { frameworks: [fw3] });
    await makeControl("shared", { frameworks: [fw1, fw2] });
    await makeControl("base", { base: true });
    await makeControl("baseAndG1", { base: true, frameworks: [fw1] });
    await makeControl("both", { frameworks: [fw1], applicability: "BOTH" });
    // Stale for a System that declares only the live Facet.
    await makeControl("staleG1", { frameworks: [fw1], facet: facetOtherId });
    await makeControl("staleOrphan", { facet: facetOtherId });
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // rounds, Approvals and Assessments cascade
    await prisma.organizationControlImplementation.deleteMany({ where: { controlId: { in: controlIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.updateMany({ where: { id: { in: frameworkIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetId, facetOtherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  describe("which steps an edit reopens", () => {
    it("reopens the group's step and only that step, records why, and writes one Change Event as the editor", async () => {
      const systemId = await makeSystem();
      await approveG1(systemId);
      await approveG2(systemId);
      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "APPROVED", g2: "APPROVED" });

      expect((await edit(systemId, c.g1, { status: "IN_PROGRESS" })).status).toBe(200);

      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "OPEN", g2: "APPROVED" });
      const voided = await prisma.approval.findMany({ where: { systemId, voidedAt: { not: null } } });
      expect(voided).toHaveLength(1);
      expect(voided[0]).toMatchObject({ reviewGroupId: groups[0].id, voidReason: `${c.g1.code} changed after approval` });
      expect(await liveApprovals(systemId)).toBe(1);

      const events = await reopenEvents(systemId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        actorId: users.owner,
        detail: `${groups[0].name} Review Group step reopened: ${c.g1.code} changed after approval`,
      });

      // The API says when and why on the open step, and keeps the voided decision in the round's history.
      const body = await (await getApprovals(requestAs(users.admin, `/api/systems/${systemId}/approvals`), ctxFor(systemId))).json();
      const g1 = body.steps.find((step: { reviewGroupId: string | null }) => step.reviewGroupId === groups[0].id);
      expect(g1.reopened).toMatchObject({ reason: `${c.g1.code} changed after approval` });
      expect(new Date(g1.reopened.at).getTime()).toBeGreaterThan(0);
      expect(body.steps.find((step: { reviewGroupId: string | null }) => step.reviewGroupId === groups[1].id).reopened).toBeUndefined();
      const history = body.rounds[0].approvals.find((a: { voided: boolean }) => a.voided);
      expect(history).toMatchObject({ stepName: groups[0].name, voidReason: `${c.g1.code} changed after approval` });
    });

    it("reopens the base step for a base Control, and only the base step", async () => {
      const systemId = await makeSystem();
      await approveBase(systemId);
      await approveG1(systemId);
      expect((await edit(systemId, c.base, { status: "FULFILLED" })).status).toBe(200);
      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "APPROVED", g2: "OPEN" });
      const events = await reopenEvents(systemId);
      expect(events.map((event) => event.detail)).toEqual([`Base review step reopened: ${c.base.code} changed after approval`]);
    });

    it("keeps a base Control that is also in a group's Framework in the base step only", async () => {
      const systemId = await makeSystem();
      await approveBase(systemId);
      await approveG1(systemId);
      await edit(systemId, c.baseAndG1, { status: "FULFILLED" });
      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "APPROVED", g2: "OPEN" });
    });

    it("sends a non-base Control of a Framework with no Review Group to the base step", async () => {
      const systemId = await makeSystem();
      await approveBase(systemId);
      await approveG1(systemId);
      await edit(systemId, c.noGroup, { status: "FULFILLED" });
      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "APPROVED", g2: "OPEN" });
    });

    it("reopens every approved step whose remit holds a Control shared by two groups", async () => {
      const systemId = await makeSystem();
      await approveG1(systemId);
      await approveG2(systemId);
      await edit(systemId, c.shared, { status: "FULFILLED" });
      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "OPEN", g2: "OPEN" });
      expect(await reopenEvents(systemId)).toHaveLength(2);
    });

    it("does nothing to a step that is still open", async () => {
      const systemId = await makeSystem();
      await approveG2(systemId);
      await edit(systemId, c.g1, { status: "FULFILLED" });
      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "OPEN", g2: "APPROVED" });
      expect(await reopenEvents(systemId)).toHaveLength(0);
      expect(await prisma.approval.count({ where: { systemId, voidedAt: { not: null } } })).toBe(0);
    });

    it("reopens a step approved earlier again after it was reopened and approved again", async () => {
      const systemId = await makeSystem();
      await approveG1(systemId);
      await edit(systemId, c.g1, { status: "IN_PROGRESS" });
      await approveG1(systemId);
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "APPROVED" });
      await edit(systemId, c.second, { status: "FULFILLED" });
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN" });
      expect(await reopenEvents(systemId)).toHaveLength(2);
    });
  });

  describe("what counts as an edit", () => {
    it("reopens on a changed status, evidence or notes, and not on re-sending the stored values", async () => {
      const systemId = await makeSystem();
      expect((await edit(systemId, c.g1, { status: "IN_PROGRESS", evidence: "e1", notes: "n1" })).status).toBe(200);

      await approveG1(systemId);
      expect((await edit(systemId, c.g1, { status: "IN_PROGRESS", evidence: "e1", notes: "n1" })).status).toBe(200);
      expect((await edit(systemId, c.g1, { status: "IN_PROGRESS" })).status).toBe(200); // evidence and notes left out
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "APPROVED" });
      expect(await reopenEvents(systemId)).toHaveLength(0);
      expect(await liveApprovals(systemId)).toBe(1);

      await edit(systemId, c.g1, { status: "IN_PROGRESS", evidence: "e2", notes: "n1" });
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN" });

      await approveG1(systemId);
      await edit(systemId, c.g1, { status: "IN_PROGRESS", evidence: "e2", notes: "n2" });
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN" });

      await approveG1(systemId);
      await edit(systemId, c.g1, { status: "FULFILLED", evidence: "e2", notes: "n2" });
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN" });
      expect(await reopenEvents(systemId)).toHaveLength(3);
    });

    it("counts the first save of a Control with no Assessment yet", async () => {
      const systemId = await makeSystem();
      await approveG1(systemId);
      await edit(systemId, c.g1, { status: "FULFILLED" });
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN" });
    });

    it("reopens on a changed Self-Assessment answer, and not on re-sending it", async () => {
      const systemId = await makeSystem();
      const answer = (value: "YES" | "NO") =>
        patchAnswer(
          requestAs(users.owner, `/api/systems/${systemId}/assessments/${c.g1.id}/answer`, { method: "PATCH", body: { answer: value } }),
          ctxForControl(systemId, c.g1.id),
        );
      expect((await answer("YES")).status).toBe(200);
      await approveG1(systemId);
      expect((await answer("YES")).status).toBe(200);
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "APPROVED" });
      expect(await reopenEvents(systemId)).toHaveLength(0);
      expect((await answer("NO")).status).toBe(200);
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN" });
      expect(await reopenEvents(systemId)).toHaveLength(1);
    });

    it("counts an Admin's edit and a Risk Owner's Not Applicable (any person's edit, open question 1)", async () => {
      const systemId = await makeSystem();
      await approveG1(systemId);
      await approveG2(systemId);
      expect((await edit(systemId, c.g1, { status: "IN_PROGRESS" }, "admin")).status).toBe(200);
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN", g2: "APPROVED" });
      expect((await reopenEvents(systemId))[0].actorId).toBe(users.admin);

      expect((await edit(systemId, c.g2, { status: "NOT_APPLICABLE", notes: "Does not apply" }, "riskOwner")).status).toBe(200);
      expect(await stepStatuses(systemId)).toMatchObject({ g2: "OPEN" });
      expect((await reopenEvents(systemId))[1].actorId).toBe(users.riskOwner);
    });

    it("counts a reset to inherited, and not the inheritance moving", async () => {
      const systemId = await makeSystem();
      const organization = async (status: ControlAssessmentStatus) =>
        saveOrganizationImplementationWithEvents((await getOrganizationControl(prisma, c.both.id))!, users.admin, { status });
      await organization("FULFILLED");
      await prisma.controlAssessment.create({
        data: { systemId, controlId: c.both.id, status: "IN_PROGRESS", assessedById: users.owner, assessedAt: new Date() },
      });
      await approveG1(systemId);

      // The Organization's status moves under the System: nobody edited the Assessment.
      await organization("IN_PROGRESS");
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "APPROVED" });
      expect(await reopenEvents(systemId)).toHaveLength(0);

      const response = await resetToInherited(
        requestAs(users.owner, `/api/systems/${systemId}/assessments/${c.both.id}/reset`, { method: "POST" }),
        ctxForControl(systemId, c.both.id),
      );
      expect(response.status).toBe(200);
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN" });
      expect((await reopenEvents(systemId))[0].detail).toBe(
        `${groups[0].name} Review Group step reopened: ${c.both.code} changed after approval`,
      );
    });

    it("counts the removal of a stale Assessment, by the Control's mappings, or the base step if they lead nowhere", async () => {
      const systemId = await makeSystem();
      for (const control of [c.staleG1, c.staleOrphan]) {
        await prisma.controlAssessment.create({
          data: { systemId, controlId: control.id, status: "IN_PROGRESS", assessedById: users.owner, assessedAt: new Date() },
        });
      }
      await approveBase(systemId);
      await approveG1(systemId);
      await approveG2(systemId);
      // The last approval Approved the System; put it back In Review, as it was while the owner could still edit.
      await prisma.system.update({ where: { id: systemId }, data: { status: "IN_REVIEW" } });
      const remove = (control: Fixture) =>
        removeStale(
          requestAs(users.owner, `/api/systems/${systemId}/assessments/${control.id}`, { method: "DELETE" }),
          ctxForControl(systemId, control.id),
        );

      expect((await remove(c.staleG1)).status).toBe(200);
      expect(await stepStatuses(systemId)).toEqual({ base: "APPROVED", g1: "OPEN", g2: "APPROVED" });
      expect((await remove(c.staleOrphan)).status).toBe(200);
      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "OPEN", g2: "APPROVED" });
      expect((await reopenEvents(systemId)).map((event) => event.detail)).toEqual([
        `${groups[0].name} Review Group step reopened: ${c.staleG1.code} changed after approval`,
        `Base review step reopened: ${c.staleOrphan.code} changed after approval`,
      ]);
    });
  });

  describe("a System that is not In Review, and refused edits", () => {
    it("changes no step of a Draft or Approved System", async () => {
      for (const status of ["DRAFT", "APPROVED"] as const) {
        const systemId = await makeSystem({ status });
        const round = await prisma.reviewRound.findFirstOrThrow({ where: { systemId } });
        await prisma.approval.create({
          data: { systemId, reviewRoundId: round.id, reviewGroupId: groups[0].id, approverId: users.member1, decision: "APPROVED", comment: "Fine" },
        });
        expect((await edit(systemId, c.g1, { status: "FULFILLED" })).status).toBe(200);
        expect(await liveApprovals(systemId)).toBe(1);
        expect(await reopenEvents(systemId)).toHaveLength(0);
        expect(await statusOf(systemId)).toBe(status);
      }
    });

    it("changes nothing, steps included, when the edit is refused", async () => {
      const systemId = await makeSystem();
      await approveG1(systemId);
      const before = await prisma.changeEvent.count({ where: { systemId } });
      for (const userKey of ["reviewer", "member1"] as const) {
        expect((await edit(systemId, c.g1, { status: "FULFILLED" }, userKey)).status).toBe(403);
      }
      expect((await edit(systemId, c.g1, { status: "FULFILLED" }, "other")).status).toBe(404);
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "APPROVED" });
      expect(await liveApprovals(systemId)).toBe(1);
      expect(await prisma.changeEvent.count({ where: { systemId } })).toBe(before);
      expect(await prisma.controlAssessment.count({ where: { systemId } })).toBe(0);
    });
  });

  describe("the System stays In Review while a step is reopened", () => {
    it("is not Approved by the other steps approving, until the reopened step approves again", async () => {
      const systemId = await makeSystem();
      await approveG2(systemId);
      await approveG1(systemId); // the last of the approved ones
      await edit(systemId, c.g1, { status: "IN_PROGRESS" }); // reopens it
      expect(await stepStatuses(systemId)).toEqual({ base: "OPEN", g1: "OPEN", g2: "APPROVED" });

      await approveBase(systemId);
      expect(await statusOf(systemId)).toBe("IN_REVIEW");
      await approveG1(systemId);
      expect(await statusOf(systemId)).toBe("APPROVED");
    });

    it("needs the reopened step to approve again even when the others approved before and after it", async () => {
      const systemId = await makeSystem();
      await approveBase(systemId);
      await approveG1(systemId);
      await edit(systemId, c.g2, { status: "FULFILLED" }); // g2 is not approved: nothing to reopen
      await edit(systemId, c.g1, { status: "FULFILLED" }); // g1 approved: reopened
      await approveG2(systemId);
      expect(await statusOf(systemId)).toBe("IN_REVIEW");
      await approveG1(systemId);
      expect(await statusOf(systemId)).toBe("APPROVED");
    });
  });

  describe("a Provider", () => {
    it("reopens a step in the same transaction as its own write (and under the Provider lock)", async () => {
      const systemId = await makeSystem({ isProvider: true });
      await approveG1(systemId);
      expect((await edit(systemId, c.g1, { status: "IN_PROGRESS" })).status).toBe(200);
      expect(await stepStatuses(systemId)).toMatchObject({ g1: "OPEN" });
      expect(await reopenEvents(systemId)).toHaveLength(1);
    });
  });

  describe("what is not an edit", () => {
    let scenario: Awaited<ReturnType<typeof createCheckUpScenario>>;

    beforeAll(async () => {
      scenario = await createCheckUpScenario("200", { systemControls: 1, organizationControls: 0 });
    });
    afterAll(async () => {
      await prisma.approval.deleteMany({ where: { systemId: scenario.systemId } });
      await scenario.cleanup();
    });

    it("does not reopen a step when a Nonconformity sets the Assessment back", async () => {
      const control = scenario.systemControls[0];
      await prisma.system.update({ where: { id: scenario.systemId }, data: { status: "IN_REVIEW" } });
      const round = await prisma.reviewRound.create({ data: { systemId: scenario.systemId } });
      await prisma.approval.create({
        data: {
          systemId: scenario.systemId,
          reviewRoundId: round.id,
          approverId: scenario.roleUser.REVIEWER,
          decision: "APPROVED",
          comment: "Fine",
        },
      });
      await prisma.controlAssessment.create({
        data: { systemId: scenario.systemId, controlId: control.id, status: "FULFILLED", assessedById: scenario.systemOwner },
      });

      const checkUp = scenario.find(control.code);
      await scenario.answer(checkUp.id, scenario.systemOwner);
      await evaluateCheckUp(checkUp.id, { id: scenario.roleUser.INTERNAL_AUDITOR, role: "INTERNAL_AUDITOR" }, {
        outcome: "NONCONFORMITY",
        comment: "It does not work",
      });

      const after = await prisma.controlAssessment.findUniqueOrThrow({
        where: { systemId_controlId: { systemId: scenario.systemId, controlId: control.id } },
      });
      expect(after.status).toBe("IN_PROGRESS"); // it was set back...
      const { steps } = await loadReviewRounds(scenario.systemId);
      expect(steps).toEqual([{ reviewGroupId: null, name: "Base review", status: "APPROVED" }]); // ...but nobody reopened the step
      expect(await reopenEvents(scenario.systemId)).toHaveLength(0);
    });
  });
});

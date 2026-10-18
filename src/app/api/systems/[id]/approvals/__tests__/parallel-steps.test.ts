import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { BASE_REVIEW_STEP_NAME } from "@/lib/review-steps";
import { applyFrameworkScopeDeclared, applyFrameworkScopeRemoved } from "@/lib/framework-scope";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { roleView } from "@/app/home/role-view";
import { DELETE as untieFramework, PUT as tieFramework } from "@/app/api/frameworks/[id]/review-group/route";
import { GET, POST } from "../route";

/**
 * Parallel Review Steps decided as the group (#199). Fixtures only (CI's DB isn't seeded): two Review Groups,
 * each tied to its own Framework with one Supplementary Control scoped to a Deployment Facet, Systems that
 * declare both Frameworks, and one user per role that matters.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

function requestAs(userId: string | null, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest("http://localhost/api/systems/x/approvals", {
    method: init?.method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Parallel Review Steps through /api/systems/[id]/approvals (#199)", () => {
  const users: Record<string, { id: string; name: string }> = {};
  let facetId: string;
  const groups: { id: string; name: string }[] = [];
  const frameworkIds: string[] = [];
  const controlIds: string[] = [];
  const systemIds: string[] = [];

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({
      data: { email: `test-199-${key}-${SUFFIX}@example.com`, name: `Test 199 ${key} ${SUFFIX}`, role },
    });
    users[key] = { id: user.id, name: user.name };
    return user;
  }

  /** An In Review System with an open round, declaring the given Frameworks (both by default). */
  async function makeSystem(options: { ownerKey?: string; scope?: number[]; status?: "IN_REVIEW" | "DRAFT" } = {}) {
    const scope = options.scope ?? [0, 1];
    const system = await prisma.system.create({
      data: {
        name: `Test 199 System ${SUFFIX}-${systemIds.length}`,
        ownerId: users[options.ownerKey ?? "owner"].id,
        status: options.status ?? "IN_REVIEW",
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: scope.map((i) => ({ id: frameworkIds[i] })) },
      },
    });
    systemIds.push(system.id);
    const round = await prisma.reviewRound.create({ data: { systemId: system.id } });
    return { system, round };
  }

  const decide = (
    systemId: string,
    userKey: string,
    decision: "APPROVED" | "REJECTED",
    reviewGroupId: string | null | undefined,
    comment = "Because",
  ) =>
    POST(
      requestAs(users[userKey].id, {
        method: "POST",
        body: { decision, comment, ...(reviewGroupId === undefined ? {} : { reviewGroupId }) },
      }),
      ctxFor(systemId),
    );

  const statusOf = async (systemId: string) => (await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).status;
  const stepsOf = async (systemId: string, userKey = "admin") =>
    (await (await GET(requestAs(users[userKey].id), ctxFor(systemId))).json()).steps as {
      reviewGroupId: string | null;
      name: string;
      status: string;
      canDecide: boolean;
    }[];

  /** Loads the System as the scope helpers want it. */
  const classified = (systemId: string) =>
    prisma.system.findUniqueOrThrow({
      where: { id: systemId },
      include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } },
    });

  beforeAll(async () => {
    await makeUser("owner", "SYSTEM_OWNER");
    await makeUser("reviewer", "REVIEWER");
    await makeUser("admin", "ADMIN");
    await makeUser("adminOwner", "ADMIN");
    await makeUser("member1", "SYSTEM_OWNER"); // member of group 1, no other rights
    await makeUser("member2", "VIEWER"); // member of group 2
    await makeUser("reviewerMember1", "REVIEWER"); // a Reviewer who is also in group 1
    await makeUser("riskOwner", "RISK_OWNER");
    await makeUser("auditor", "INTERNAL_AUDITOR");
    await makeUser("compliance", "COMPLIANCE_MANAGER");
    await makeUser("viewer", "VIEWER");

    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 199 Facet ${SUFFIX}` } })).id;
    for (const [i, members] of [[0, ["member1", "reviewerMember1"]], [1, ["member2"]]] as [number, string[]][]) {
      const group = await prisma.reviewGroup.create({
        data: {
          name: `Test 199 Group ${i + 1} ${SUFFIX}`,
          members: { connect: members.map((key) => ({ id: users[key].id })) },
        },
      });
      groups.push({ id: group.id, name: group.name });
      const framework = await createFixtureFramework(`199 f${i + 1}`);
      frameworkIds.push(framework.id);
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: group.id } });
      const control = await prisma.control.create({
        data: {
          code: `T199-${i}-${SUFFIX}`,
          title: `Test 199 Supplementary ${i}`,
          description: "Test",
          category: "Test",
          applicability: "PER_SYSTEM",
          deploymentFacets: { connect: [{ id: facetId }] },
        },
      });
      controlIds.push(control.id);
      await mapControlsToFramework(framework.id, [control.id]);
    }
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // rounds and Approvals cascade
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.updateMany({ where: { id: { in: frameworkIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: groups.map((g) => g.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  });

  describe("who decides", () => {
    it("lets a group's member decide that group's step and no other; a Reviewer only the base step; an Admin any", async () => {
      const { system } = await makeSystem();
      const [g1, g2] = groups;

      expect((await decide(system.id, "member1", "APPROVED", g2.id)).status).toBe(403);
      expect((await decide(system.id, "member1", "APPROVED", null)).status).toBe(403);
      expect((await decide(system.id, "member1", "APPROVED", undefined)).status).toBe(403);
      expect((await decide(system.id, "reviewer", "APPROVED", g1.id)).status).toBe(403);
      expect((await decide(system.id, "member2", "APPROVED", g1.id)).status).toBe(403);
      expect((await decide(system.id, "riskOwner", "APPROVED", null)).status).toBe(403);
      expect((await decide(system.id, "auditor", "APPROVED", null)).status).toBe(403);
      expect((await decide(system.id, "compliance", "APPROVED", g1.id)).status).toBe(403);
      // A User who can't see the System doesn't learn it exists.
      expect((await decide(system.id, "viewer", "APPROVED", null)).status).toBe(404);
      expect(await prisma.approval.count({ where: { systemId: system.id } })).toBe(0);
      expect(await statusOf(system.id)).toBe("IN_REVIEW");

      expect((await decide(system.id, "member1", "APPROVED", g1.id)).status).toBe(201);
      expect((await decide(system.id, "reviewer", "APPROVED", null)).status).toBe(201);
      expect((await decide(system.id, "admin", "APPROVED", g2.id)).status).toBe(201);
      expect(await statusOf(system.id)).toBe("APPROVED");
    });

    it("lets a Reviewer who is also a member decide both the base step and their group's", async () => {
      const { system } = await makeSystem();
      expect((await decide(system.id, "reviewerMember1", "APPROVED", null)).status).toBe(201);
      expect((await decide(system.id, "reviewerMember1", "APPROVED", groups[0].id)).status).toBe(201);
    });

    it("never lets the owner decide a step on their own System, even as a member, a Reviewer or an Admin", async () => {
      const own = [
        { ownerKey: "member1", userKey: "member1", step: groups[0].id },
        { ownerKey: "reviewer", userKey: "reviewer", step: null },
        { ownerKey: "adminOwner", userKey: "adminOwner", step: null },
        { ownerKey: "adminOwner", userKey: "adminOwner", step: groups[1].id },
        { ownerKey: "reviewerMember1", userKey: "reviewerMember1", step: groups[0].id },
      ];
      for (const { ownerKey, userKey, step } of own) {
        const { system } = await makeSystem({ ownerKey });
        const response = await decide(system.id, userKey, "APPROVED", step);
        expect(response.status).toBe(403);
        expect(await prisma.approval.count({ where: { systemId: system.id } })).toBe(0);
        expect(await statusOf(system.id)).toBe("IN_REVIEW");
        expect(await prisma.changeEvent.count({ where: { systemId: system.id, action: "APPROVAL_DECIDED" } })).toBe(0);
      }
    });

    it("being the Control Owner of a Control in the remit is no bar", async () => {
      const { system } = await makeSystem();
      await prisma.control.update({ where: { id: controlIds[0] }, data: { ownerId: users.member1.id } });
      try {
        expect((await decide(system.id, "member1", "APPROVED", groups[0].id)).status).toBe(201);
      } finally {
        await prisma.control.update({ where: { id: controlIds[0] }, data: { ownerId: null } });
      }
    });

    it("requires a comment and a valid step id, and refuses a step that isn't live or is already decided", async () => {
      const { system } = await makeSystem({ scope: [0] });

      const noComment = await POST(
        requestAs(users.member1.id, { method: "POST", body: { decision: "APPROVED", reviewGroupId: groups[0].id } }),
        ctxFor(system.id),
      );
      expect(noComment.status).toBe(400);

      // Group 2 has no remit on this System: no step to decide, even for an Admin.
      const notLive = await decide(system.id, "admin", "APPROVED", groups[1].id);
      expect(notLive.status).toBe(409);
      const unknown = await decide(system.id, "admin", "APPROVED", "no-such-group");
      expect(unknown.status).toBe(409);
      expect(await prisma.approval.count({ where: { systemId: system.id } })).toBe(0);

      expect((await decide(system.id, "member1", "APPROVED", groups[0].id)).status).toBe(201);
      const again = await decide(system.id, "member1", "REJECTED", groups[0].id);
      expect(again.status).toBe(409);
      expect(await prisma.approval.count({ where: { systemId: system.id } })).toBe(1);
      expect(await statusOf(system.id)).toBe("IN_REVIEW");
    });

    it("refuses a decision on a System that isn't In Review and writes nothing", async () => {
      const { system } = await makeSystem({ status: "DRAFT" });
      expect((await decide(system.id, "admin", "APPROVED", null)).status).toBe(400);
      expect(await prisma.approval.count({ where: { systemId: system.id } })).toBe(0);
    });
  });

  describe("outcome", () => {
    it("Approves the System only once every step has approved, in any order", async () => {
      const { system } = await makeSystem();
      await decide(system.id, "member2", "APPROVED", groups[1].id);
      expect(await statusOf(system.id)).toBe("IN_REVIEW");
      await decide(system.id, "reviewer", "APPROVED", null);
      expect(await statusOf(system.id)).toBe("IN_REVIEW");
      await decide(system.id, "member1", "APPROVED", groups[0].id);
      expect(await statusOf(system.id)).toBe("APPROVED");
    });

    it("sends the System back to Draft at once on a rejection, and nothing more is recorded on the cancelled steps", async () => {
      const { system, round } = await makeSystem();
      await decide(system.id, "reviewer", "APPROVED", null);
      const rejected = await decide(system.id, "member1", "REJECTED", groups[0].id, "Not good enough");
      expect(rejected.status).toBe(201);
      expect(await statusOf(system.id)).toBe("DRAFT");

      const late = await decide(system.id, "admin", "APPROVED", groups[1].id);
      expect(late.status).toBe(400);
      const approvals = await prisma.approval.findMany({ where: { reviewRoundId: round.id } });
      expect(approvals.map((a) => a.decision).sort()).toEqual(["APPROVED", "REJECTED"]);
      expect((await stepsOf(system.id)).length).toBe(0);
    });

    it("starts every step open again in a new round; earlier rounds' approvals don't count", async () => {
      const { system, round } = await makeSystem();
      await decide(system.id, "reviewer", "APPROVED", null);
      await decide(system.id, "member1", "REJECTED", groups[0].id);
      expect(await statusOf(system.id)).toBe("DRAFT");

      // The resubmission as the submit route leaves it.
      await prisma.reviewRound.create({
        data: { systemId: system.id, submittedAt: new Date(round.submittedAt.getTime() + 60_000) },
      });
      await prisma.system.update({ where: { id: system.id }, data: { status: "IN_REVIEW" } });

      expect((await stepsOf(system.id)).map((s) => s.status)).toEqual(["OPEN", "OPEN", "OPEN"]);
      await decide(system.id, "member1", "APPROVED", groups[0].id);
      await decide(system.id, "member2", "APPROVED", groups[1].id);
      expect(await statusOf(system.id)).toBe("IN_REVIEW"); // the base step is open again
      await decide(system.id, "reviewer", "APPROVED", null);
      expect(await statusOf(system.id)).toBe("APPROVED");
    });

    it("two concurrent approvals of different steps both record, and exactly one makes the System Approved", async () => {
      const { system } = await makeSystem({ scope: [0] });
      const responses = await Promise.all([
        decide(system.id, "reviewer", "APPROVED", null),
        decide(system.id, "member1", "APPROVED", groups[0].id),
      ]);
      expect(responses.map((r) => r.status)).toEqual([201, 201]);
      expect(await statusOf(system.id)).toBe("APPROVED");
      expect(await prisma.approval.count({ where: { systemId: system.id } })).toBe(2);
    });

    it("a concurrent approval and rejection leave the System in Draft with no decision recorded after the rejection", async () => {
      const { system } = await makeSystem({ scope: [0] });
      const responses = await Promise.all([
        decide(system.id, "reviewer", "APPROVED", null),
        decide(system.id, "member1", "REJECTED", groups[0].id),
      ]);
      expect(responses.some((r) => r.status === 201)).toBe(true);
      expect(await statusOf(system.id)).toBe("DRAFT");
      const approvals = await prisma.approval.findMany({ where: { systemId: system.id }, orderBy: { decidedAt: "asc" } });
      expect(approvals.at(-1)?.decision === "REJECTED" || approvals.length === 1).toBe(true);
      expect(approvals.filter((a) => a.decision === "REJECTED")).toHaveLength(1);
    });
  });

  describe("live steps", () => {
    it("a step that disappears and comes back during the same round comes back Open", async () => {
      const { system } = await makeSystem();
      await decide(system.id, "member1", "APPROVED", groups[0].id, "Group one is fine");
      expect((await stepsOf(system.id)).map((s) => s.status)).toEqual(["OPEN", "APPROVED", "OPEN"]);

      // Its remit goes (the Framework leaves the System's scope) and then returns.
      await applyFrameworkScopeRemoved(await classified(system.id), { id: frameworkIds[0], name: "F1" }, users.admin.id);
      expect((await stepsOf(system.id)).map((s) => s.reviewGroupId)).toEqual([null, groups[1].id]);
      const voided = await prisma.approval.findFirstOrThrow({ where: { systemId: system.id, reviewGroupId: groups[0].id } });
      expect(voided.voidedAt).not.toBeNull(); // kept in the history, no longer counted

      await applyFrameworkScopeDeclared(await classified(system.id), { id: frameworkIds[0], name: "F1" }, users.admin.id);
      const back = await stepsOf(system.id);
      expect(back.find((s) => s.reviewGroupId === groups[0].id)?.status).toBe("OPEN");

      // The restored step can be decided again, and the old decision stays visible as voided.
      expect((await decide(system.id, "member1", "APPROVED", groups[0].id, "Again")).status).toBe(201);
      const history = (await (await GET(requestAs(users.admin.id), ctxFor(system.id))).json()).rounds[0].approvals;
      expect(history.map((a: { voided: boolean }) => a.voided)).toEqual([true, false]);
    });

    it("a group untied from its Framework and tied again during the round also comes back Open", async () => {
      const { system } = await makeSystem();
      await decide(system.id, "member2", "APPROVED", groups[1].id);

      const route = (method: "DELETE" | "PUT", body?: unknown) => {
        const request = new NextRequest("http://localhost/api/frameworks/x/review-group", {
          method,
          headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${users.admin.id}` }),
          body: body ? JSON.stringify(body) : undefined,
        });
        const ctx = { params: Promise.resolve({ id: frameworkIds[1] }) };
        return method === "DELETE" ? untieFramework(request, ctx) : tieFramework(request, ctx);
      };
      expect((await route("DELETE")).status).toBe(200);
      expect((await stepsOf(system.id)).map((s) => s.reviewGroupId)).toEqual([null, groups[0].id]);
      expect((await route("PUT", { reviewGroupId: groups[1].id })).status).toBe(200);
      expect((await stepsOf(system.id)).find((s) => s.reviewGroupId === groups[1].id)?.status).toBe("OPEN");
    });

    it("approves the System at once when the last open step disappears and every remaining step has approved", async () => {
      const { system } = await makeSystem();
      await decide(system.id, "reviewer", "APPROVED", null);
      await decide(system.id, "member1", "APPROVED", groups[0].id);
      expect(await statusOf(system.id)).toBe("IN_REVIEW");

      await applyFrameworkScopeRemoved(await classified(system.id), { id: frameworkIds[1], name: "F2" }, users.admin.id);
      expect(await statusOf(system.id)).toBe("APPROVED");
      const events = await prisma.changeEvent.findMany({ where: { systemId: system.id, action: "APPROVAL_DECIDED" } });
      expect(events.some((e) => e.detail.startsWith("Approved: every remaining") && e.actorId === "system")).toBe(true);
    });

    it("a dropped approved step doesn't keep the System from waiting on the others, and a new group gets an open step", async () => {
      const { system } = await makeSystem({ scope: [0] });
      await decide(system.id, "member1", "APPROVED", groups[0].id);
      await applyFrameworkScopeDeclared(await classified(system.id), { id: frameworkIds[1], name: "F2" }, users.admin.id);
      expect((await stepsOf(system.id)).map((s) => s.status)).toEqual(["OPEN", "APPROVED", "OPEN"]);
      await applyFrameworkScopeRemoved(await classified(system.id), { id: frameworkIds[0], name: "F1" }, users.admin.id);
      expect(await statusOf(system.id)).toBe("IN_REVIEW");
      expect((await stepsOf(system.id)).map((s) => s.reviewGroupId)).toEqual([null, groups[1].id]);
    });
  });

  describe("attribution", () => {
    it("records the group in the Change Event and the deciding User as its actor", async () => {
      const { system } = await makeSystem();
      await decide(system.id, "member1", "REJECTED", groups[0].id, "Missing DPIA");
      await decide(system.id, "reviewer", "APPROVED", null, "ok");

      const events = await prisma.changeEvent.findMany({
        where: { systemId: system.id, action: "APPROVAL_DECIDED" },
        orderBy: { createdAt: "asc" },
      });
      expect(events.map((e) => e.detail)).toEqual([`${groups[0].name}: Rejected: Missing DPIA`]); // the round ended
      expect(events[0].actorId).toBe(users.member1.id);
      expect(events[0].detail).not.toContain(users.member1.name);

      const other = await makeSystem();
      await decide(other.system.id, "reviewer", "APPROVED", null, "ok");
      const event = await prisma.changeEvent.findFirstOrThrow({ where: { systemId: other.system.id, action: "APPROVAL_DECIDED" } });
      expect(event.detail).toBe(`${BASE_REVIEW_STEP_NAME}: Approved: ok`);
      expect(event.actorId).toBe(users.reviewer.id);
    });

    it("never gives the owner (or anyone else not entitled) the decider, in any part of the response", async () => {
      const { system } = await makeSystem();
      await decide(system.id, "member1", "APPROVED", groups[0].id, "Group one: fine");
      await decide(system.id, "reviewer", "APPROVED", null, "Base: fine");

      const deciderIds = [users.member1.id, users.reviewer.id];
      const deciderNames = [users.member1.name, users.reviewer.name];
      const rawFor = async (userKey: string) => {
        const response = await GET(requestAs(users[userKey].id), ctxFor(system.id));
        expect(response.status).toBe(200);
        return JSON.stringify(await response.json());
      };

      const ownerBody = await rawFor("owner");
      for (const needle of [...deciderIds, ...deciderNames, "approver", "approverId"]) expect(ownerBody).not.toContain(needle);
      expect(ownerBody).toContain(groups[0].name);
      expect(ownerBody).toContain("Group one: fine");
      expect(ownerBody).toContain(BASE_REVIEW_STEP_NAME);

      // Entitled: Admin, Internal Auditor, Compliance Manager see both.
      for (const key of ["admin", "auditor", "compliance"]) {
        const body = await rawFor(key);
        for (const needle of [...deciderIds, ...deciderNames]) expect(body).toContain(needle);
      }
      // A group's members see their own group's decider only; a Reviewer the base step's only.
      const memberBody = await rawFor("member1");
      expect(memberBody).toContain(users.member1.id);
      expect(memberBody).not.toContain(users.reviewer.id);
      const reviewerBody = await rawFor("reviewer");
      expect(reviewerBody).toContain(users.reviewer.id);
      expect(reviewerBody).not.toContain(users.member1.id);
      // A Risk Owner sees the System but is neither a Reviewer nor a member.
      const riskOwnerBody = await rawFor("riskOwner");
      for (const needle of [...deciderIds, ...deciderNames]) expect(riskOwnerBody).not.toContain(needle);
    });

    it("hides the decider from an owner who is also a Reviewer or a member", async () => {
      const { system } = await makeSystem({ ownerKey: "reviewerMember1" });
      await decide(system.id, "member1", "APPROVED", groups[0].id);
      await decide(system.id, "reviewer", "APPROVED", null);
      const raw = JSON.stringify(await (await GET(requestAs(users.reviewerMember1.id), ctxFor(system.id))).json());
      expect(raw).not.toContain(users.member1.id);
      expect(raw).not.toContain(users.reviewer.id);
    });

    it("the decision's own response is attributed to the step", async () => {
      const { system } = await makeSystem();
      const body = await (await decide(system.id, "member2", "APPROVED", groups[1].id, "fine")).json();
      expect(body.approval).toMatchObject({ stepName: groups[1].name, reviewGroupId: groups[1].id, decision: "APPROVED" });
      expect(body.approval).not.toHaveProperty("approverId");
    });
  });

  describe("who sees what", () => {
    it("reports per viewer which open steps they can decide", async () => {
      const { system } = await makeSystem();
      const canDecide = async (key: string) => (await stepsOf(system.id, key)).map((s) => s.canDecide);
      expect(await canDecide("admin")).toEqual([true, true, true]);
      expect(await canDecide("reviewer")).toEqual([true, false, false]);
      expect(await canDecide("member1")).toEqual([false, true, false]);
      expect(await canDecide("member2")).toEqual([false, false, true]);
      expect(await canDecide("owner")).toEqual([false, false, false]);
      expect(await canDecide("riskOwner")).toEqual([false, false, false]);
    });

    it("lets a member see a System In Review while their group has a step on it, and no longer after", async () => {
      const { system } = await makeSystem({ scope: [0] });
      expect((await GET(requestAs(users.member1.id), ctxFor(system.id))).status).toBe(200);
      // member2's group has no step on this System.
      expect((await GET(requestAs(users.member2.id), ctxFor(system.id))).status).toBe(404);

      await prisma.system.update({ where: { id: system.id }, data: { status: "DRAFT" } });
      expect((await GET(requestAs(users.member1.id), ctxFor(system.id))).status).toBe(404);
    });

    it("lists open steps in the right users' My tasks, never for the owner, and drops a decided step", async () => {
      const { system } = await makeSystem();
      const rowIds = async (key: string) => {
        const user = await prisma.user.findUniqueOrThrow({ where: { id: users[key].id } });
        return ((await roleView(user)).tasks ?? []).filter((t) => t.status === "Awaiting review").map((t) => t.id).filter((id) => id.startsWith(system.id));
      };
      const g1Row = `${system.id}:step:${groups[0].id}`;
      const g2Row = `${system.id}:step:${groups[1].id}`;

      expect(await rowIds("reviewer")).toEqual([system.id]);
      expect(await rowIds("member1")).toEqual([g1Row]);
      expect(await rowIds("member2")).toEqual([g2Row]);
      expect((await rowIds("reviewerMember1")).sort()).toEqual([system.id, g1Row].sort());
      expect((await rowIds("admin")).sort()).toEqual([system.id, g1Row, g2Row].sort());
      expect(await rowIds("owner")).toEqual([]);
      expect(await rowIds("riskOwner")).toEqual([]);

      await decide(system.id, "reviewer", "APPROVED", null);
      await decide(system.id, "member1", "APPROVED", groups[0].id);
      expect(await rowIds("reviewer")).toEqual([]);
      expect(await rowIds("member1")).toEqual([]);
      expect(await rowIds("member2")).toEqual([g2Row]);
      expect((await rowIds("admin")).sort()).toEqual([g2Row]);

      const ownAdmin = await makeSystem({ ownerKey: "adminOwner" });
      const adminOwnerView = await roleView(await prisma.user.findUniqueOrThrow({ where: { id: users.adminOwner.id } }));
      expect((adminOwnerView.tasks ?? []).some((t) => t.id.startsWith(ownAdmin.system.id) && t.status === "Awaiting review")).toBe(false);
    });
  });
});

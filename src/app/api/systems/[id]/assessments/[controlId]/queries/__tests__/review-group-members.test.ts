import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OnboardingStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { BASE_REVIEW_STEP_NAME, groupsWhoseRemitIncludes } from "@/lib/review-steps";
import { getVisibleSystem, getVisibleSystems } from "@/lib/system-visibility";
import { getActionableQueries, getActionableQueryCountsBySystem } from "@/lib/assessment-queries";
import { roleView } from "@/app/home/role-view";
import { cleanupFixtureRequirements, createFixtureFramework, getBaseFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { GET as listAssessments } from "../../../route";
import { POST as raise } from "../route";
import { POST as reply } from "../[queryId]/messages/route";
import { POST as resolve } from "../[queryId]/resolve/route";

/**
 * Review Group members: System visibility and Assessment Queries (#201). Fixtures only (CI's DB is not
 * seeded): a "GDPR" group tied to its own fixture Framework with one Supplementary Control, a second
 * group and Framework, a base Control (also mapped to the GDPR Framework, as an Annex A Control that
 * satisfies it would be), Systems in every status, and one user per role that matters.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

type Json = Record<string, unknown>;

function request(userId: string | null, method: "GET" | "POST", body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest("http://localhost/api/x", { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
}

describe("Review Group members: visibility and Assessment Queries (#201)", () => {
  const users: Record<string, { id: string; name: string; email: string }> = {};
  const systems: Record<string, string> = {};
  const controls: Record<string, string> = {};
  const groups: Record<string, { id: string; name: string }> = {};
  const frameworkIds: string[] = [];
  let facetId: string;

  async function makeUser(key: string, role: UserRole) {
    const user = await prisma.user.create({
      data: { email: `test-201-${key}-${SUFFIX}@example.com`, name: `Test #201 ${key} ${SUFFIX}`, role },
    });
    users[key] = { id: user.id, name: user.name, email: user.email };
  }

  async function makeSystem(key: string, status: OnboardingStatus, scope: string[], ownerKey = "owner") {
    const system = await prisma.system.create({
      data: {
        name: `Test #201 System ${key} ${SUFFIX}`,
        ownerId: users[ownerKey].id,
        status,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: scope.map((i) => ({ id: frameworkIds[Number(i)] })) },
      },
    });
    systems[key] = system.id;
  }

  const raiseAs = (userKey: string, systemKey: string, controlKey: string, body = "Is this true?") =>
    raise(request(users[userKey].id, "POST", { body }), {
      params: Promise.resolve({ id: systems[systemKey], controlId: controls[controlKey] }),
    });
  const replyAs = (userKey: string, systemKey: string, controlKey: string, queryId: string, body = "A reply") =>
    reply(request(users[userKey].id, "POST", { body }), {
      params: Promise.resolve({ id: systems[systemKey], controlId: controls[controlKey], queryId }),
    });
  const resolveAs = (userKey: string, systemKey: string, controlKey: string, queryId: string) =>
    resolve(request(users[userKey].id, "POST"), {
      params: Promise.resolve({ id: systems[systemKey], controlId: controls[controlKey], queryId }),
    });

  /** The Queries on one Control as GET /assessments sends them to `userKey`. */
  async function queriesSeenBy(userKey: string, systemKey: string, controlKey: string) {
    const response = await listAssessments(request(users[userKey].id, "GET"), { params: Promise.resolve({ id: systems[systemKey] }) });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { assessments: { control: { id: string }; assessment: { queries: Json[] } | null; canManageQueries: boolean }[] };
    const row = body.assessments.find((r) => r.control.id === controls[controlKey]);
    return { queries: row?.assessment?.queries ?? [], canManage: row?.canManageQueries, raw: JSON.stringify(body) };
  }

  const dbCount = async (systemKey: string) =>
    prisma.assessmentQuery.count({ where: { controlAssessment: { systemId: systems[systemKey] } } });

  beforeAll(async () => {
    for (const [key, role] of [
      ["owner", "SYSTEM_OWNER"],
      ["admin", "ADMIN"],
      ["reviewer", "REVIEWER"],
      ["riskOwner", "RISK_OWNER"],
      ["auditor", "INTERNAL_AUDITOR"],
      ["compliance", "COMPLIANCE_MANAGER"], // not a member
      ["viewerMember", "VIEWER"], // GDPR group member, no other right
      ["adminMember", "ADMIN"], // GDPR group member and an Admin
      ["complianceMember", "COMPLIANCE_MANAGER"], // GDPR group member
      ["reviewerMember", "REVIEWER"], // GDPR group member and a Reviewer
      ["ownerMember", "SYSTEM_OWNER"], // GDPR group member who owns sysOwned
      ["otherMember", "VIEWER"], // member of the other group
      ["viewer", "VIEWER"], // member of nothing
    ] as [string, UserRole][]) {
      await makeUser(key, role);
    }
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test #201 Facet ${SUFFIX}` } })).id;

    const groupDefs: [string, string[]][] = [
      ["gdpr", ["viewerMember", "complianceMember", "reviewerMember", "ownerMember", "adminMember"]],
      ["other", ["otherMember"]],
    ];
    for (const [key, members] of groupDefs) {
      groups[key] = await prisma.reviewGroup
        .create({
          data: { name: `Test #201 ${key} group ${SUFFIX}`, members: { connect: members.map((m) => ({ id: users[m].id })) } },
        })
        .then((g) => ({ id: g.id, name: g.name }));
      const framework = await createFixtureFramework(`201 ${key}`);
      frameworkIds.push(framework.id);
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: groups[key].id } });
    }

    const makeControl = async (key: string, frameworkIndexes: number[], base = false) => {
      const control = await prisma.control.create({
        data: {
          code: `T201-${key}-${SUFFIX}`,
          title: `Test #201 Control ${key}`,
          description: "Test",
          category: "Test",
          applicability: "PER_SYSTEM",
          deploymentFacets: { connect: [{ id: facetId }] }, // only this file's Systems declare the facet
        },
      });
      controls[key] = control.id;
      for (const i of frameworkIndexes) await mapControlsToFramework(frameworkIds[i], [control.id]);
      if (base) await mapControlsToFramework((await getBaseFramework()).id, [control.id]);
    };
    await makeControl("gdpr", [0]); // a Supplementary Control in the GDPR group's remit
    await makeControl("other", [1]); // in the other group's remit
    await makeControl("base", [], true); // a plain base Control
    await makeControl("baseAlso", [0], true); // base and GDPR: stays in the base step's remit

    // Systems in every status with GDPR in scope, one without it, and one with both Frameworks.
    await makeSystem("draft", "DRAFT", ["0"]);
    await makeSystem("inReview", "IN_REVIEW", ["0"]);
    await makeSystem("approved", "APPROVED", ["0"]);
    await makeSystem("rejected", "REJECTED", ["0"]);
    await makeSystem("onboarded", "ONBOARDED", ["0"]);
    await makeSystem("noGdpr", "DRAFT", []);
    await makeSystem("onlyOther", "DRAFT", ["1"]);
    await makeSystem("both", "IN_REVIEW", ["0", "1"]);
    await makeSystem("owned", "DRAFT", ["0"], "ownerMember");
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    const systemIds = Object.values(systems);
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // assessments, queries and messages cascade
    await prisma.control.deleteMany({ where: { id: { in: Object.values(controls) } } });
    await prisma.framework.updateMany({ where: { id: { in: frameworkIds } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: { in: Object.values(groups).map((g) => g.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  });

  describe("visibility", () => {
    const ids = (list: { id: string }[]) => new Set(list.map((s) => s.id));

    it("shows a member every System with one of the group's Frameworks in scope, in any status, and nothing else new", async () => {
      const member = ids(await getVisibleSystems({ id: users.viewerMember.id, role: "VIEWER" }));
      for (const key of ["draft", "inReview", "approved", "rejected", "onboarded", "both", "owned"]) {
        expect(member.has(systems[key]), key).toBe(true);
      }
      expect(member.has(systems.noGdpr)).toBe(false);
      expect(member.has(systems.onlyOther)).toBe(false);

      // Beyond the GDPR-scope Systems, nothing new: whatever else they see is Onboarded or their own, as for
      // any Viewer (other test files create and delete Systems concurrently, so each is checked on its own).
      const gdprScoped = new Set(["draft", "inReview", "approved", "rejected", "both", "owned"].map((k) => systems[k]));
      const rest = [...member].filter((id) => !gdprScoped.has(id));
      const others = await prisma.system.findMany({ where: { id: { in: rest } }, select: { status: true, ownerId: true } });
      for (const other of others) expect(other.status === "ONBOARDED" || other.ownerId === users.viewerMember.id).toBe(true);
      const viewer = ids(await getVisibleSystems({ id: users.viewer.id, role: "VIEWER" }));
      for (const key of ["draft", "inReview", "approved", "rejected", "both"]) expect(viewer.has(systems[key]), key).toBe(false);
    });

    it("counts the Framework in scope whatever its own status", async () => {
      await prisma.framework.update({ where: { id: frameworkIds[0] }, data: { status: "DRAFT" } });
      try {
        expect(await getVisibleSystem({ id: users.viewerMember.id, role: "VIEWER" }, systems.draft)).not.toBeNull();
      } finally {
        await prisma.framework.update({ where: { id: frameworkIds[0] }, data: { status: "PUBLISHED" } });
      }
    });

    it("lets the other group's member see only the Systems with their group's Framework", async () => {
      const other = ids(await getVisibleSystems({ id: users.otherMember.id, role: "VIEWER" }));
      expect(other.has(systems.onlyOther)).toBe(true);
      expect(other.has(systems.both)).toBe(true);
      expect(other.has(systems.draft)).toBe(false);
    });
  });

  describe("remit of one Control", () => {
    it("names the groups whose remit includes it, and none for a base Control", async () => {
      const system = await prisma.system.findUniqueOrThrow({
        where: { id: systems.both },
        include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } },
      });
      expect([...(await groupsWhoseRemitIncludes(prisma, system, controls.gdpr)).keys()]).toEqual([groups.gdpr.id]);
      expect([...(await groupsWhoseRemitIncludes(prisma, system, controls.other)).keys()]).toEqual([groups.other.id]);
      expect((await groupsWhoseRemitIncludes(prisma, system, controls.base)).size).toBe(0);
      expect((await groupsWhoseRemitIncludes(prisma, system, controls.baseAlso)).size).toBe(0);
    });
  });

  describe("raising, replying and resolving", () => {
    it("lets a Viewer who is a member raise and resolve on a Supplementary Control, attributed to the group", async () => {
      const raised = await raiseAs("viewerMember", "draft", "gdpr", "Where is the DPIA?");
      expect(raised.status).toBe(201);
      const { query } = (await raised.json()) as { query: { id: string; messages: { attributedTo: string | null }[] } };
      expect(query.messages[0].attributedTo).toBe(groups.gdpr.name);

      const stored = await prisma.queryMessage.findFirstOrThrow({ where: { assessmentQueryId: query.id } });
      expect(stored).toMatchObject({ authorId: users.viewerMember.id, reviewGroupId: groups.gdpr.id, attributedTo: groups.gdpr.name });

      const replied = await replyAs("viewerMember", "draft", "gdpr", query.id, "Still waiting");
      expect(replied.status).toBe(201);
      expect(await prisma.queryMessage.count({ where: { assessmentQueryId: query.id, reviewGroupId: groups.gdpr.id } })).toBe(2);

      const resolved = await resolveAs("viewerMember", "draft", "gdpr", query.id);
      expect(resolved.status).toBe(200);
      expect(await prisma.assessmentQuery.findUniqueOrThrow({ where: { id: query.id } })).toMatchObject({
        resolved: true,
        resolvedById: users.viewerMember.id,
        resolvedByReviewGroupId: groups.gdpr.id,
        resolvedAttributedTo: groups.gdpr.name,
      });
    });

    it("refuses a member on a base Control, including one that is also mapped to the group's Framework, and changes nothing", async () => {
      const before = await dbCount("inReview");
      const assessmentsBefore = await prisma.controlAssessment.count({ where: { systemId: systems.inReview } });
      for (const key of ["base", "baseAlso"]) {
        expect((await raiseAs("viewerMember", "inReview", key)).status, key).toBe(403);
      }
      expect(await dbCount("inReview")).toBe(before);
      // Not even the lazily created Assessment row appears.
      expect(await prisma.controlAssessment.count({ where: { systemId: systems.inReview } })).toBe(assessmentsBefore);

      // A Query a Reviewer raised on a base Control can't be replied to or resolved by the member either.
      const reviewerQuery = await (await raiseAs("reviewer", "inReview", "baseAlso", "Base question")).json();
      const queryId = (reviewerQuery as { query: { id: string } }).query.id;
      const messagesBefore = await prisma.queryMessage.count({ where: { assessmentQueryId: queryId } });
      expect((await replyAs("viewerMember", "inReview", "baseAlso", queryId)).status).toBe(403);
      expect((await resolveAs("viewerMember", "inReview", "baseAlso", queryId)).status).toBe(403);
      expect(await prisma.queryMessage.count({ where: { assessmentQueryId: queryId } })).toBe(messagesBefore);
      expect((await prisma.assessmentQuery.findUniqueOrThrow({ where: { id: queryId } })).resolved).toBe(false);
    });

    it("refuses a non-member, the other group's member on this group's Control, and a System the member can't see", async () => {
      expect((await raiseAs("viewer", "both", "gdpr")).status).toBe(403);
      expect((await raiseAs("otherMember", "both", "gdpr")).status).toBe(403);
      expect((await raiseAs("otherMember", "draft", "gdpr")).status).toBe(404);
      expect((await raiseAs("viewerMember", "noGdpr", "gdpr")).status).toBe(404);
      expect(await dbCount("both")).toBe(0);
      expect(await dbCount("noGdpr")).toBe(0);
    });

    it("never gives a member Query rights on a System they own, but leaves the owner's reply alone", async () => {
      expect((await raiseAs("ownerMember", "owned", "gdpr")).status).toBe(403);
      expect(await dbCount("owned")).toBe(0);

      const raised = await (await raiseAs("admin", "owned", "gdpr", "Owner, please explain")).json();
      const queryId = (raised as { query: { id: string } }).query.id;
      expect((await resolveAs("ownerMember", "owned", "gdpr", queryId)).status).toBe(403);
      const replied = await replyAs("ownerMember", "owned", "gdpr", queryId, "Explained");
      expect(replied.status).toBe(201);
      // The owner's own reply is shown named, never as the group.
      expect(await prisma.queryMessage.findFirstOrThrow({ where: { assessmentQueryId: queryId, authorId: users.ownerMember.id } })).toMatchObject({
        reviewGroupId: null,
        attributedTo: null,
      });
    });

    it("lets a Compliance Manager who is a member act in the remit only, and an Internal Auditor never", async () => {
      const raised = await raiseAs("complianceMember", "approved", "gdpr", "From compliance");
      expect(raised.status).toBe(201);
      const queryId = ((await raised.json()) as { query: { id: string } }).query.id;
      expect((await replyAs("complianceMember", "approved", "gdpr", queryId)).status).toBe(201);
      expect((await resolveAs("complianceMember", "approved", "gdpr", queryId)).status).toBe(200);

      expect((await raiseAs("complianceMember", "approved", "base")).status).toBe(403);
      expect((await raiseAs("compliance", "approved", "gdpr")).status).toBe(403);

      await prisma.reviewGroup.update({ where: { id: groups.gdpr.id }, data: { members: { connect: { id: users.auditor.id } } } });
      try {
        expect((await raiseAs("auditor", "approved", "gdpr")).status).toBe(403);
      } finally {
        await prisma.reviewGroup.update({ where: { id: groups.gdpr.id }, data: { members: { disconnect: { id: users.auditor.id } } } });
      }
    });

    it("attributes by the rules: a member to the group (even a Reviewer), a Reviewer to Base review, Risk Owner and Admin named", async () => {
      const attribution = async (userKey: string, controlKey: string) => {
        const raised = await raiseAs(userKey, "onboarded", controlKey, `By ${userKey}`);
        expect(raised.status, `${userKey} on ${controlKey}`).toBe(201);
        const id = ((await raised.json()) as { query: { id: string } }).query.id;
        const message = await prisma.queryMessage.findFirstOrThrow({ where: { assessmentQueryId: id } });
        return [message.reviewGroupId, message.attributedTo];
      };
      expect(await attribution("reviewerMember", "gdpr")).toEqual([groups.gdpr.id, groups.gdpr.name]);
      expect(await attribution("reviewerMember", "base")).toEqual([null, BASE_REVIEW_STEP_NAME]);
      expect(await attribution("reviewer", "gdpr")).toEqual([null, BASE_REVIEW_STEP_NAME]);
      expect(await attribution("riskOwner", "gdpr")).toEqual([null, null]);
      expect(await attribution("admin", "gdpr")).toEqual([null, null]);
    });

    it("picks the group whose name sorts first when two of the author's groups have the Control in remit", async () => {
      // A second group tied to a second Framework that also maps the GDPR Control, on a System declaring both.
      const earlier = await prisma.reviewGroup.create({
        data: { name: `Test #201 AAA group ${SUFFIX}`, members: { connect: [{ id: users.viewerMember.id }] } },
      });
      const framework = await createFixtureFramework("201 earlier");
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: earlier.id } });
      await mapControlsToFramework(framework.id, [controls.gdpr]);
      await prisma.system.update({ where: { id: systems.both }, data: { frameworkScopes: { connect: [{ id: framework.id }] } } });
      try {
        const raised = await raiseAs("viewerMember", "both", "gdpr", "Two groups");
        expect(raised.status).toBe(201);
        const id = ((await raised.json()) as { query: { id: string } }).query.id;
        expect(await prisma.queryMessage.findFirstOrThrow({ where: { assessmentQueryId: id } })).toMatchObject({
          reviewGroupId: earlier.id,
          attributedTo: earlier.name,
        });
      } finally {
        await prisma.system.update({ where: { id: systems.both }, data: { frameworkScopes: { disconnect: [{ id: framework.id }] } } });
        await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: null } });
        await prisma.reviewGroup.delete({ where: { id: earlier.id } });
      }
    });
  });

  describe("who sees the person", () => {
    let queryId: string; // on `rejected`: a member's, a Reviewer's, a Risk Owner's message, resolved by a member

    beforeAll(async () => {
      const raised = await raiseAs("viewerMember", "rejected", "gdpr", "Member question");
      queryId = ((await raised.json()) as { query: { id: string } }).query.id;
      expect((await replyAs("reviewer", "rejected", "gdpr", queryId, "Reviewer follow-up")).status).toBe(201);
      expect((await replyAs("riskOwner", "rejected", "gdpr", queryId, "Risk Owner follow-up")).status).toBe(201);
      expect((await resolveAs("viewerMember", "rejected", "gdpr", queryId)).status).toBe(200);
    });

    /** For one viewer: [author name or null, shown attribution] of each message, and who resolved it. */
    async function seenBy(userKey: string) {
      const { queries, raw } = await queriesSeenBy(userKey, "rejected", "gdpr");
      const query = queries.find((q) => q.id === queryId) as {
        messages: { attributedTo: string | null; author?: { id: string; name: string } }[];
        resolvedAttributedTo: string | null;
        resolvedBy?: { name: string };
      };
      return {
        messages: query.messages.map((m) => [m.author?.name ?? null, m.attributedTo]),
        resolvedBy: query.resolvedBy?.name ?? null,
        resolvedAttributedTo: query.resolvedAttributedTo,
        raw,
      };
    }
    const named = (key: string) => users[key].name;

    it("shows the owner the group, Base review and the named Risk Owner, and never an id, name or email of the others", async () => {
      const seen = await seenBy("owner");
      expect(seen.messages).toEqual([
        [null, groups.gdpr.name],
        [null, BASE_REVIEW_STEP_NAME],
        [named("riskOwner"), null],
      ]);
      expect(seen.resolvedBy).toBeNull();
      expect(seen.resolvedAttributedTo).toBe(groups.gdpr.name);
      for (const key of ["viewerMember", "reviewer"]) {
        for (const secret of [users[key].id, users[key].name, users[key].email]) expect(seen.raw).not.toContain(secret);
      }
      // No author key at all on an attributed message, and no raw id columns on the Query.
      const { queries } = await queriesSeenBy("owner", "rejected", "gdpr");
      const query = queries.find((q) => q.id === queryId) as { messages: Json[] } & Json;
      expect(query.messages[0]).not.toHaveProperty("author");
      expect(query.messages[0]).not.toHaveProperty("authorId");
      expect(query).not.toHaveProperty("lastMessageAuthorId");
      expect(query).not.toHaveProperty("resolvedById");
    });

    it("shows Admin, Internal Auditor and Compliance Manager the person behind every attribution", async () => {
      for (const key of ["admin", "auditor", "compliance"]) {
        const seen = await seenBy(key);
        expect(seen.messages, key).toEqual([
          [named("viewerMember"), groups.gdpr.name],
          [named("reviewer"), BASE_REVIEW_STEP_NAME],
          [named("riskOwner"), null],
        ]);
        expect(seen.resolvedBy, key).toBe(named("viewerMember"));
      }
    });

    it("shows the group's members their own group's people, a Reviewer the base step's, and nobody else's", async () => {
      expect((await seenBy("viewerMember")).messages.map((m) => m[0])).toEqual([named("viewerMember"), null, named("riskOwner")]);
      expect((await seenBy("viewerMember")).resolvedBy).toBe(named("viewerMember"));
      expect((await seenBy("reviewer")).messages.map((m) => m[0])).toEqual([null, named("reviewer"), named("riskOwner")]);
      expect((await seenBy("reviewer")).resolvedBy).toBeNull();
      // A Reviewer who is also a member sees both.
      expect((await seenBy("reviewerMember")).messages.map((m) => m[0])).toEqual([named("viewerMember"), named("reviewer"), named("riskOwner")]);
      // The other group's member can't see this System's thread's people (they can't see the System at all here).
    });

    it("keeps a Risk Owner's messages named for everyone", async () => {
      for (const key of ["owner", "reviewer", "viewerMember", "admin"]) {
        expect((await seenBy(key)).messages[2], key).toEqual([named("riskOwner"), null]);
      }
    });

    it("tells a member per Control whether they may raise and resolve", async () => {
      expect((await queriesSeenBy("viewerMember", "rejected", "gdpr")).canManage).toBe(true);
      expect((await queriesSeenBy("viewerMember", "rejected", "base")).canManage).toBe(false);
      expect((await queriesSeenBy("viewerMember", "rejected", "baseAlso")).canManage).toBe(false);
      expect((await queriesSeenBy("reviewer", "rejected", "base")).canManage).toBe(true);
      expect((await queriesSeenBy("compliance", "rejected", "gdpr")).canManage).toBe(false);
      expect((await queriesSeenBy("complianceMember", "rejected", "gdpr")).canManage).toBe(true);
      expect((await queriesSeenBy("admin", "rejected", "gdpr")).canManage).toBe(true);
      expect((await queriesSeenBy("owner", "rejected", "gdpr")).canManage).toBe(false);
    });
  });

  describe("attribution is fixed when it is posted", () => {
    it("survives the member leaving the group, and the group being deleted", async () => {
      const raised = await raiseAs("viewerMember", "approved", "gdpr", "Posted as the group");
      const queryId = ((await raised.json()) as { query: { id: string } }).query.id;
      expect((await resolveAs("viewerMember", "approved", "gdpr", queryId)).status).toBe(200);

      const seenByOwner = async () => {
        const { queries } = await queriesSeenBy("owner", "approved", "gdpr");
        const query = queries.find((q) => q.id === queryId) as { messages: { attributedTo: string | null; author?: unknown }[]; resolvedAttributedTo: string | null };
        return [query.messages[0].attributedTo, "author" in query.messages[0], query.resolvedAttributedTo];
      };
      const seenByReviewer = async () => {
        const { queries } = await queriesSeenBy("reviewer", "approved", "gdpr");
        const query = queries.find((q) => q.id === queryId) as { messages: { author?: { name: string } }[] };
        return query.messages[0].author?.name ?? null;
      };

      await prisma.reviewGroup.update({ where: { id: groups.gdpr.id }, data: { members: { disconnect: { id: users.viewerMember.id } } } });
      try {
        expect(await seenByOwner()).toEqual([groups.gdpr.name, false, groups.gdpr.name]);
        expect(await prisma.queryMessage.findFirstOrThrow({ where: { assessmentQueryId: queryId } })).toMatchObject({
          reviewGroupId: groups.gdpr.id,
          attributedTo: groups.gdpr.name,
        });
        // The ex-member no longer acts on it.
        expect((await raiseAs("viewerMember", "approved", "gdpr")).status).toBe(403);
      } finally {
        await prisma.reviewGroup.update({ where: { id: groups.gdpr.id }, data: { members: { connect: { id: users.viewerMember.id } } } });
      }

      // A group deleted after the fact: the snapshot name stays, the group id goes, only the always-seeing roles see the person.
      const doomed = await prisma.reviewGroup.create({
        data: { name: `Test #201 Doomed group ${SUFFIX}`, members: { connect: [{ id: users.viewerMember.id }] } },
      });
      const framework = await createFixtureFramework("201 doomed");
      await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: doomed.id } });
      await mapControlsToFramework(framework.id, [controls.gdpr]);
      await prisma.system.update({ where: { id: systems.approved }, data: { frameworkScopes: { connect: [{ id: framework.id }] } } });
      let doomedQueryId: string;
      try {
        // Both of the member's groups have the Control in remit here; the earlier name wins ("...Doomed" < "...gdpr").
        const response = await raiseAs("viewerMember", "approved", "gdpr", "Posted as the doomed group");
        doomedQueryId = ((await response.json()) as { query: { id: string } }).query.id;
        expect(await prisma.queryMessage.findFirstOrThrow({ where: { assessmentQueryId: doomedQueryId } })).toMatchObject({ reviewGroupId: doomed.id });
      } finally {
        await prisma.system.update({ where: { id: systems.approved }, data: { frameworkScopes: { disconnect: [{ id: framework.id }] } } });
        await prisma.framework.update({ where: { id: framework.id }, data: { reviewGroupId: null } });
        await prisma.reviewGroup.delete({ where: { id: doomed.id } });
      }
      const message = await prisma.queryMessage.findFirstOrThrow({ where: { assessmentQueryId: doomedQueryId } });
      expect(message).toMatchObject({ reviewGroupId: null, attributedTo: doomed.name });

      const view = async (userKey: string) => {
        const { queries } = await queriesSeenBy(userKey, "approved", "gdpr");
        const query = queries.find((q) => q.id === doomedQueryId) as { messages: { attributedTo: string | null; author?: { name: string } }[] };
        return [query.messages[0].attributedTo, query.messages[0].author?.name ?? null];
      };
      expect(await view("owner")).toEqual([doomed.name, null]);
      expect(await view("reviewer")).toEqual([doomed.name, null]); // not the base step's, so not a Reviewer's to see
      expect(await view("admin")).toEqual([doomed.name, users.viewerMember.name]);
      expect(await view("auditor")).toEqual([doomed.name, users.viewerMember.name]);
      expect(await view("compliance")).toEqual([doomed.name, users.viewerMember.name]);
      expect(await seenByReviewer()).toBeNull(); // the earlier group's message: a Reviewer isn't a member
      expect(await seenByOwner()).toEqual([groups.gdpr.name, false, groups.gdpr.name]);
    });
  });

  describe("tasks and counts", () => {
    it("counts an open Query on a remit Control for the member when it is the reviewer side's turn, and not for others", async () => {
      // A reviewer-side question on a remit Control, and one on a base Control.
      const remit = ((await (await raiseAs("admin", "draft", "gdpr", "Remit question")).json()) as { query: { id: string } }).query.id;
      const base = ((await (await raiseAs("admin", "draft", "base", "Base question")).json()) as { query: { id: string } }).query.id;

      const member = { id: users.viewerMember.id, role: "VIEWER" as const };
      // Awaiting the owner: nobody on the reviewer side is on the hook yet.
      expect((await getActionableQueryCountsBySystem(member, [systems.draft])).get(systems.draft) ?? 0).toBe(0);

      // The owner answers both: now it is the reviewer side's turn.
      expect((await replyAs("owner", "draft", "gdpr", remit, "Answer")).status).toBe(201);
      expect((await replyAs("owner", "draft", "base", base, "Answer")).status).toBe(201);

      expect((await getActionableQueryCountsBySystem(member, [systems.draft])).get(systems.draft)).toBe(1);
      const rows = await getActionableQueries(member, [systems.draft]);
      expect(rows.map((r) => r.id)).toEqual([remit]);

      for (const [key, role] of [["viewer", "VIEWER"], ["otherMember", "VIEWER"], ["owner", "SYSTEM_OWNER"], ["auditor", "INTERNAL_AUDITOR"]] as const) {
        const rowsFor = await getActionableQueries({ id: users[key].id, role }, [systems.draft]);
        expect(rowsFor.filter((r) => [remit, base].includes(r.id)), key).toEqual([]);
      }
      // A Compliance Manager member counts it too; a Reviewer counts both, as before.
      expect((await getActionableQueries({ id: users.complianceMember.id, role: "COMPLIANCE_MANAGER" }, [systems.draft])).map((r) => r.id)).toEqual([remit]);
      expect((await getActionableQueries({ id: users.reviewer.id, role: "REVIEWER" }, [systems.draft])).map((r) => r.id).sort()).toEqual([remit, base].sort());

      // And it is a row in their My tasks.
      const user = await prisma.user.findUniqueOrThrow({ where: { id: users.viewerMember.id } });
      const tasks = (await roleView(user)).tasks ?? [];
      expect(tasks.filter((t) => t.kind === "Query").map((t) => t.id)).toContain(remit);
      expect(tasks.map((t) => t.id)).not.toContain(base);

      // Resolved, it drops out.
      expect((await resolveAs("viewerMember", "draft", "gdpr", remit)).status).toBe(200);
      expect((await getActionableQueryCountsBySystem(member, [systems.draft])).get(systems.draft) ?? 0).toBe(0);
    });

    it("lists in an Admin member's My tasks only the Queries on Controls in their group's remit", async () => {
      // On one System: a remit Control, a base Control and another group's Control, each awaiting the reviewer side.
      const ids: Record<string, string> = {};
      for (const key of ["gdpr", "base", "other"]) {
        ids[key] = ((await (await raiseAs("reviewer", "both", key, `Question on ${key}`)).json()) as { query: { id: string } }).query.id;
        expect((await replyAs("owner", "both", key, ids[key], "Answer")).status).toBe(201);
      }
      const user = await prisma.user.findUniqueOrThrow({ where: { id: users.adminMember.id } });
      const queryRows = ((await roleView(user)).tasks ?? []).filter((t) => t.kind === "Query").map((t) => t.id);
      expect(queryRows).toContain(ids.gdpr);
      expect(queryRows).not.toContain(ids.base);
      expect(queryRows).not.toContain(ids.other);
    });
  });
});

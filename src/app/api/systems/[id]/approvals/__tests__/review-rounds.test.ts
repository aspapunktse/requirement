import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { BASE_REVIEW_STEP_NAME } from "@/lib/review-steps";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { DELETE as deleteReviewGroup } from "@/app/api/review-groups/[id]/route";
import { GET, POST } from "../route";

/**
 * Review Rounds through the approvals route (#198): today's decision endpoint records against the current
 * round's base step, and the history comes back grouped by round with the derived steps. Submitting starts a
 * round; that is tested in route.test.ts next door, which already owns the mandatory-Control fixture the submit
 * gate needs (two files each satisfying it would block each other's cleanup).
 * Fixtures only (CI's DB isn't seeded): a Deployment Facet, a Framework with a Review Group, a Supplementary
 * Control scoped to the facet, Systems that declare the Framework.
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

describe("Review Rounds through /api/systems/[id]/approvals", () => {
  let ownerId: string;
  let reviewerId: string;
  let viewerId: string;
  let adminId: string;
  let facetId: string;
  let groupId: string;
  let groupName: string;
  let frameworkId: string;
  let controlId: string;
  const systemIds: string[] = [];

  async function makeSystem(status: "DRAFT" | "IN_REVIEW", scope: string[] = [frameworkId]) {
    const system = await prisma.system.create({
      data: {
        name: `Test #198 Route System ${SUFFIX}-${systemIds.length}`,
        ownerId,
        status,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: scope.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    return system;
  }

  /** An In Review System as submitting leaves it: one open Review Round, no Approvals. */
  async function makeSubmittedSystem(scope: string[] = [frameworkId]) {
    const system = await makeSystem("IN_REVIEW", scope);
    const round = await prisma.reviewRound.create({ data: { systemId: system.id } });
    return { system, round };
  }

  const decide = (systemId: string, userId: string, decision: "APPROVED" | "REJECTED", comment = "Because") =>
    POST(requestAs(userId, { method: "POST", body: { decision, comment } }), ctxFor(systemId));

  const roundsOf = (systemId: string) =>
    prisma.reviewRound.findMany({ where: { systemId }, orderBy: { submittedAt: "asc" }, include: { approvals: true } });

  beforeAll(async () => {
    const mkUser = (key: string, role: "SYSTEM_OWNER" | "REVIEWER" | "VIEWER" | "ADMIN") =>
      prisma.user.create({
        data: { email: `test-198-route-${key}-${SUFFIX}@example.com`, name: `Test #198 ${key}`, role },
      });
    ownerId = (await mkUser("owner", "SYSTEM_OWNER")).id;
    reviewerId = (await mkUser("reviewer", "REVIEWER")).id;
    viewerId = (await mkUser("viewer", "VIEWER")).id;
    adminId = (await mkUser("admin", "ADMIN")).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test #198 Route Facet ${SUFFIX}` } })).id;
    const group = await prisma.reviewGroup.create({ data: { name: `Test #198 Route Group ${SUFFIX}` } });
    groupId = group.id;
    groupName = group.name;
    const framework = await createFixtureFramework("198 route");
    frameworkId = framework.id;
    await prisma.framework.update({ where: { id: frameworkId }, data: { reviewGroupId: groupId } });
    const control = await prisma.control.create({
      data: {
        code: `T198-ROUTE-${SUFFIX}`,
        title: "Test #198 Supplementary",
        description: "Test",
        category: "Test",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: facetId }] },
      },
    });
    controlId = control.id;
    await mapControlsToFramework(frameworkId, [controlId]);
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // rounds and Approvals cascade
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.framework.updateMany({ where: { reviewGroupId: groupId }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: groupId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, reviewerId, viewerId, adminId] } } });
  });

  it("records a decision against the current round's base step; the System stays In Review while the group step is open", async () => {
    const { system, round } = await makeSubmittedSystem();

    const response = await decide(system.id, reviewerId, "APPROVED", "Base is fine");
    expect(response.status).toBe(201);

    const approval = await prisma.approval.findFirstOrThrow({ where: { systemId: system.id } });
    expect(approval).toMatchObject({ reviewRoundId: round.id, reviewGroupId: null, decision: "APPROVED" });
    expect((await prisma.system.findUniqueOrThrow({ where: { id: system.id } })).status).toBe("IN_REVIEW");
    expect(await prisma.changeEvent.count({ where: { systemId: system.id, action: "APPROVAL_DECIDED" } })).toBe(1);
  });

  it("creates the round in the same transaction when an In Review System has none", async () => {
    const system = await makeSystem("IN_REVIEW");
    expect(await roundsOf(system.id)).toHaveLength(0);

    const response = await decide(system.id, reviewerId, "REJECTED", "Not yet");
    expect(response.status).toBe(201);

    const rounds = await roundsOf(system.id);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].approvals.map((a) => [a.decision, a.reviewGroupId])).toEqual([["REJECTED", null]]);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: system.id } })).status).toBe("DRAFT");
  });

  it("a refused decision changes nothing: no Approval, no round, no status change", async () => {
    const inReview = await makeSystem("IN_REVIEW");
    const draft = await makeSystem("DRAFT");

    const byOwner = await decide(inReview.id, ownerId, "APPROVED");
    expect(byOwner.status).toBe(403);
    const onDraft = await decide(draft.id, reviewerId, "APPROVED");
    expect(onDraft.status).toBe(400);
    const noComment = await POST(
      requestAs(reviewerId, { method: "POST", body: { decision: "APPROVED" } }),
      ctxFor(inReview.id),
    );
    expect(noComment.status).toBe(400);

    for (const system of [inReview, draft]) {
      expect(await prisma.approval.count({ where: { systemId: system.id } })).toBe(0);
      expect(await roundsOf(system.id)).toHaveLength(0);
      expect(await prisma.changeEvent.count({ where: { systemId: system.id, action: "APPROVAL_DECIDED" } })).toBe(0);
    }
    expect((await prisma.system.findUniqueOrThrow({ where: { id: inReview.id } })).status).toBe("IN_REVIEW");
  });

  it("the history groups decisions by round, newest first, and a new round starts with every step open", async () => {
    const { system, round: first } = await makeSubmittedSystem();
    await decide(system.id, reviewerId, "REJECTED", "First pass");
    // The resubmission, as the submit route leaves it: Draft -> In Review with a newer round.
    const second = await prisma.reviewRound.create({
      data: { systemId: system.id, submittedAt: new Date(first.submittedAt.getTime() + 60_000) },
    });
    await prisma.system.update({ where: { id: system.id }, data: { status: "IN_REVIEW" } });

    const body = await (await GET(requestAs(ownerId), ctxFor(system.id))).json();
    expect(body.rounds.map((r: { id: string }) => r.id)).toEqual([second.id, first.id]);
    expect(body.rounds.map((r: { current: boolean }) => r.current)).toEqual([true, false]);
    expect(body.rounds[0].approvals).toEqual([]);
    expect(body.rounds[1].approvals).toHaveLength(1);
    expect(body.rounds[1].approvals[0]).toMatchObject({
      decision: "REJECTED",
      comment: "First pass",
      stepName: BASE_REVIEW_STEP_NAME,
    });
    // The earlier round's rejection doesn't count towards the new round.
    expect(body.steps.map((s: { status: string }) => s.status)).toEqual(["OPEN", "OPEN"]);

    // A decision lands in the new round, not the old one.
    await decide(system.id, reviewerId, "APPROVED", "Second pass");
    const rounds = await roundsOf(system.id);
    expect(rounds.map((r) => r.approvals.map((a) => a.decision))).toEqual([["REJECTED"], ["APPROVED"]]);
  });

  it("GET returns the current round's steps while In Review: the base step and the group's step", async () => {
    const { system } = await makeSubmittedSystem();

    const body = await (await GET(requestAs(ownerId), ctxFor(system.id))).json();
    expect(body.steps).toEqual([
      { reviewGroupId: null, name: BASE_REVIEW_STEP_NAME, status: "OPEN", canDecide: false },
      { reviewGroupId: groupId, name: groupName, status: "OPEN", canDecide: false },
    ]);

    // A scope change shows at once.
    await prisma.system.update({ where: { id: system.id }, data: { frameworkScopes: { set: [] } } });
    const dropped = await (await GET(requestAs(ownerId), ctxFor(system.id))).json();
    expect(dropped.steps.map((s: { name: string }) => s.name)).toEqual([BASE_REVIEW_STEP_NAME]);
  });

  it("GET shows no steps once the System isn't In Review, and refuses a user who can't see the System", async () => {
    const draft = await makeSystem("DRAFT");
    const body = await (await GET(requestAs(ownerId), ctxFor(draft.id))).json();
    expect(body).toMatchObject({ rounds: [], steps: [] });

    expect((await GET(requestAs(viewerId), ctxFor(draft.id))).status).toBe(404);
    expect((await GET(requestAs(null), ctxFor(draft.id))).status).toBe(401);
  });

  it("keeps a Review Group that has decided a step: deleting it is refused and the decision stays", async () => {
    const { system, round } = await makeSubmittedSystem();
    const group = await prisma.reviewGroup.create({ data: { name: `Test #198 Decided Group ${SUFFIX}` } });
    await prisma.approval.create({
      data: {
        systemId: system.id,
        reviewRoundId: round.id,
        reviewGroupId: group.id,
        approverId: reviewerId,
        decision: "APPROVED",
        comment: "Group says yes",
      },
    });

    const response = await deleteReviewGroup(
      new NextRequest("http://localhost/api/review-groups/x", {
        method: "DELETE",
        headers: new Headers({ cookie: `${ACTING_USER_COOKIE}=${adminId}` }),
      }),
      ctxFor(group.id),
    );

    expect(response.status).toBe(409);
    expect(await prisma.reviewGroup.count({ where: { id: group.id } })).toBe(1);
    expect(await prisma.approval.count({ where: { reviewGroupId: group.id } })).toBe(1);

    await prisma.approval.deleteMany({ where: { reviewGroupId: group.id } });
    await prisma.reviewGroup.delete({ where: { id: group.id } });
  });
});

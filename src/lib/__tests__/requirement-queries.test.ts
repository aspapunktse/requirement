import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  addQueryMessage,
  canReplyToQuery,
  getActionableQueryCountsBySystem,
  isAwaitingOwner,
  isQueryActionableBy,
  raiseQuery,
  resolveQuery,
} from "../requirement-queries";

describe("canReplyToQuery", () => {
  it("allows the System's owner", () => {
    expect(canReplyToQuery({ id: "u1", role: "VIEWER" }, { ownerId: "u1" })).toBe(true);
  });

  it.each(["REVIEWER", "RISK_OWNER", "ADMIN"] as const)("allows %s regardless of ownership", (role) => {
    expect(canReplyToQuery({ id: "other", role }, { ownerId: "owner-1" })).toBe(true);
  });

  it("forbids a SYSTEM_OWNER who doesn't own this System", () => {
    expect(canReplyToQuery({ id: "other", role: "SYSTEM_OWNER" }, { ownerId: "owner-1" })).toBe(false);
  });
});

describe("isAwaitingOwner / isQueryActionableBy", () => {
  const system = { ownerId: "owner-1" };

  it("is awaiting the owner when the last message came from the reviewer side", () => {
    expect(isAwaitingOwner({ lastMessageAuthorId: "reviewer-1" }, system)).toBe(true);
  });

  it("is not awaiting the owner once the owner has replied", () => {
    expect(isAwaitingOwner({ lastMessageAuthorId: "owner-1" }, system)).toBe(false);
  });

  it("is actionable by the owner only when it's their turn", () => {
    const awaitingOwner = { resolved: false, lastMessageAuthorId: "reviewer-1" };
    const awaitingReviewer = { resolved: false, lastMessageAuthorId: "owner-1" };
    expect(isQueryActionableBy(awaitingOwner, system, { id: "owner-1", role: "SYSTEM_OWNER" })).toBe(true);
    expect(isQueryActionableBy(awaitingReviewer, system, { id: "owner-1", role: "SYSTEM_OWNER" })).toBe(false);
  });

  it("is actionable by a REVIEWER/RISK_OWNER/ADMIN only once the owner has replied", () => {
    const awaitingOwner = { resolved: false, lastMessageAuthorId: "reviewer-1" };
    const awaitingReviewer = { resolved: false, lastMessageAuthorId: "owner-1" };
    expect(isQueryActionableBy(awaitingReviewer, system, { id: "any", role: "REVIEWER" })).toBe(true);
    expect(isQueryActionableBy(awaitingOwner, system, { id: "any", role: "REVIEWER" })).toBe(false);
  });

  it("is never actionable once resolved", () => {
    const resolved = { resolved: true, lastMessageAuthorId: "owner-1" };
    expect(isQueryActionableBy(resolved, system, { id: "owner-1", role: "SYSTEM_OWNER" })).toBe(false);
    expect(isQueryActionableBy(resolved, system, { id: "any", role: "REVIEWER" })).toBe(false);
  });

  it("is never actionable by a VIEWER or an unrelated SYSTEM_OWNER", () => {
    const awaitingOwner = { resolved: false, lastMessageAuthorId: "reviewer-1" };
    expect(isQueryActionableBy(awaitingOwner, system, { id: "someone-else", role: "VIEWER" })).toBe(false);
    expect(isQueryActionableBy(awaitingOwner, system, { id: "someone-else", role: "SYSTEM_OWNER" })).toBe(
      false,
    );
  });
});

const OWNER_EMAIL = "test-req-query-owner@example.com";
const REVIEWER_EMAIL = "test-req-query-reviewer@example.com";

describe("raiseQuery / addQueryMessage / resolveQuery (integration)", () => {
  let ownerId: string;
  let reviewerId: string;
  let requirementId: string;
  const systemIds: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Req Query Owner", role: "SYSTEM_OWNER" },
    });
    const reviewer = await prisma.user.upsert({
      where: { email: REVIEWER_EMAIL },
      update: {},
      create: { email: REVIEWER_EMAIL, name: "Req Query Reviewer", role: "REVIEWER" },
    });
    ownerId = owner.id;
    reviewerId = reviewer.id;

    const requirement = await prisma.requirement.create({
      data: {
        code: `REQ-QUERY-${Date.now()}`,
        title: "Query Target",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    requirementId = requirement.id;
  });

  afterAll(async () => {
    await prisma.requirementQuery.deleteMany({
      where: { requirementAssessment: { systemId: { in: systemIds } } },
    });
    await prisma.requirementAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.requirement.deleteMany({ where: { id: requirementId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, REVIEWER_EMAIL] } } });
  });

  it("raises a Query, lazily creating the RequirementAssessment row if none exists yet", async () => {
    const system = await prisma.system.create({
      data: { name: `Query Lazy ${Date.now()}`, ownerId, status: "DRAFT" },
    });
    systemIds.push(system.id);

    const before = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId: system.id, requirementId } },
    });
    expect(before).toBeNull();

    const query = await raiseQuery(system, requirementId, reviewerId, "What does this control require here?");
    expect(query.resolved).toBe(false);
    expect(query.lastMessageAuthorId).toBe(reviewerId);
    expect(query.messages).toHaveLength(1);
    expect(query.messages[0].body).toBe("What does this control require here?");

    const after = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId: system.id, requirementId } },
    });
    expect(after?.status).toBe("NOT_STARTED");
  });

  it("a reply updates lastMessageAuthorId and, on a resolved Query, reopens it", async () => {
    const system = await prisma.system.create({
      data: { name: `Query Reopen ${Date.now()}`, ownerId, status: "DRAFT" },
    });
    systemIds.push(system.id);

    const query = await raiseQuery(system, requirementId, reviewerId, "Clarify please");
    await resolveQuery(query.id, reviewerId);

    const resolved = await prisma.requirementQuery.findUniqueOrThrow({ where: { id: query.id } });
    expect(resolved.resolved).toBe(true);

    const reopened = await addQueryMessage(query.id, ownerId, "Here's an answer");
    expect(reopened.resolved).toBe(false);
    expect(reopened.resolvedById).toBeNull();
    expect(reopened.lastMessageAuthorId).toBe(ownerId);
    expect(reopened.messages).toHaveLength(2);
  });

  it("getActionableQueryCountsBySystem: owner's turn after a raise, reviewer's turn after a reply", async () => {
    const system = await prisma.system.create({
      data: { name: `Query Turns ${Date.now()}`, ownerId, status: "DRAFT" },
    });
    systemIds.push(system.id);

    const query = await raiseQuery(system, requirementId, reviewerId, "Question one");

    const ownerCountsAfterRaise = await getActionableQueryCountsBySystem(
      { id: ownerId, role: "SYSTEM_OWNER" },
      [system.id],
    );
    expect(ownerCountsAfterRaise.get(system.id)).toBe(1);

    const reviewerCountsAfterRaise = await getActionableQueryCountsBySystem(
      { id: reviewerId, role: "REVIEWER" },
      [system.id],
    );
    expect(reviewerCountsAfterRaise.get(system.id) ?? 0).toBe(0);

    await addQueryMessage(query.id, ownerId, "Here's my answer");

    const ownerCountsAfterReply = await getActionableQueryCountsBySystem(
      { id: ownerId, role: "SYSTEM_OWNER" },
      [system.id],
    );
    expect(ownerCountsAfterReply.get(system.id) ?? 0).toBe(0);

    const reviewerCountsAfterReply = await getActionableQueryCountsBySystem(
      { id: reviewerId, role: "REVIEWER" },
      [system.id],
    );
    expect(reviewerCountsAfterReply.get(system.id)).toBe(1);
  });
});

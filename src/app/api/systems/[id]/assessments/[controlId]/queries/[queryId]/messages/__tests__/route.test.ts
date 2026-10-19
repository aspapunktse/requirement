import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { raiseQuery, NAMED } from "@/lib/assessment-queries";
import { POST } from "../route";

const OWNER_EMAIL = "test-query-reply-owner@example.com";
const OTHER_OWNER_EMAIL = "test-query-reply-other-owner@example.com";
const REVIEWER_EMAIL = "test-query-reply-reviewer@example.com";
const VIEWER_EMAIL = "test-query-reply-viewer@example.com";

function urlFor(systemId: string, controlId: string, queryId: string) {
  return `http://localhost/api/systems/${systemId}/assessments/${controlId}/queries/${queryId}/messages`;
}

function requestAs(
  systemId: string,
  controlId: string,
  queryId: string,
  userId: string | null,
  body?: unknown,
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(systemId, controlId, queryId), {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(systemId: string, controlId: string, queryId: string) {
  return { params: Promise.resolve({ id: systemId, controlId, queryId }) };
}

describe("POST .../queries/[queryId]/messages", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let reviewerId: string;
  let viewerId: string;
  let systemId: string;
  let controlId: string;
  let queryId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Query Reply Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Query Reply Other Owner", role: "SYSTEM_OWNER" },
    });
    const reviewer = await prisma.user.upsert({
      where: { email: REVIEWER_EMAIL },
      update: {},
      create: { email: REVIEWER_EMAIL, name: "Query Reply Reviewer", role: "REVIEWER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Query Reply Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    reviewerId = reviewer.id;
    viewerId = viewer.id;

    const system = await prisma.system.create({
      data: { name: `Query Reply System ${Date.now()}`, ownerId, status: "IN_REVIEW" },
    });
    systemId = system.id;

    const control = await prisma.control.create({
      data: {
        code: `QUERY-REPLY-${Date.now()}`,
        title: "Reply Target",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    controlId = control.id;
  });

  beforeEach(async () => {
    const query = await raiseQuery(
      { id: systemId },
      controlId,
      reviewerId,
      "Question for this round",
      NAMED,
    );
    queryId = query.id;
  });

  afterAll(async () => {
    await prisma.assessmentQuery.deleteMany({ where: { controlAssessment: { systemId } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.user.deleteMany({
      where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, REVIEWER_EMAIL, VIEWER_EMAIL] } },
    });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await POST(
      requestAs(systemId, controlId, queryId, null, { body: "Reply" }),
      ctxFor(systemId, controlId, queryId),
    );
    expect(response.status).toBe(401);
  });

  it("lets the System's own owner reply", async () => {
    const response = await POST(
      requestAs(systemId, controlId, queryId, ownerId, { body: "Here's the answer" }),
      ctxFor(systemId, controlId, queryId),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.query.messages.at(-1).author.id).toBe(ownerId);
    // The raw ids never leave the server: the view is built field by field.
    expect(body.query).not.toHaveProperty("lastMessageAuthorId");
    expect(body.query.messages).toHaveLength(2);
  });

  it("lets a REVIEWER reply (follow-up on their own thread)", async () => {
    const response = await POST(
      requestAs(systemId, controlId, queryId, reviewerId, { body: "Following up" }),
      ctxFor(systemId, controlId, queryId),
    );
    expect(response.status).toBe(201);
  });

  it("forbids a SYSTEM_OWNER who doesn't own this System (once it's visible to them, i.e. Onboarded)", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED" } });
    try {
      const response = await POST(
        requestAs(systemId, controlId, queryId, otherOwnerId, { body: "Not mine" }),
        ctxFor(systemId, controlId, queryId),
      );
      expect(response.status).toBe(403);
    } finally {
      await prisma.system.update({ where: { id: systemId }, data: { status: "IN_REVIEW" } });
    }
  });

  it("forbids a VIEWER (once the System is visible to them, i.e. Onboarded)", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED" } });
    try {
      const response = await POST(
        requestAs(systemId, controlId, queryId, viewerId, { body: "Not allowed" }),
        ctxFor(systemId, controlId, queryId),
      );
      expect(response.status).toBe(403);
    } finally {
      await prisma.system.update({ where: { id: systemId }, data: { status: "IN_REVIEW" } });
    }
  });

  it("returns 404 (not 403) for a role that can't even see this IN_REVIEW System", async () => {
    const response = await POST(
      requestAs(systemId, controlId, queryId, viewerId, { body: "Not allowed" }),
      ctxFor(systemId, controlId, queryId),
    );
    expect(response.status).toBe(404);
  });

  it("reopens a resolved Query on any new reply", async () => {
    await prisma.assessmentQuery.update({ where: { id: queryId }, data: { resolved: true } });

    const response = await POST(
      requestAs(systemId, controlId, queryId, ownerId, { body: "One more thing" }),
      ctxFor(systemId, controlId, queryId),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.query.resolved).toBe(false);
  });

  it("returns 404 for a Query that doesn't belong to this Control/System", async () => {
    const otherControl = await prisma.control.create({
      data: {
        code: `QUERY-REPLY-OTHER-${Date.now()}`,
        title: "Other",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });

    const response = await POST(
      requestAs(systemId, otherControl.id, queryId, ownerId, { body: "Wrong control" }),
      ctxFor(systemId, otherControl.id, queryId),
    );
    expect(response.status).toBe(404);

    await prisma.control.delete({ where: { id: otherControl.id } });
  });
});

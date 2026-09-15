import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { POST } from "../route";

const OWNER_EMAIL = "test-raise-query-owner@example.com";
const REVIEWER_EMAIL = "test-raise-query-reviewer@example.com";
const VIEWER_EMAIL = "test-raise-query-viewer@example.com";

function urlFor(systemId: string, requirementId: string) {
  return `http://localhost/api/systems/${systemId}/assessments/${requirementId}/queries`;
}

function requestAs(systemId: string, requirementId: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(systemId, requirementId), {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(systemId: string, requirementId: string) {
  return { params: Promise.resolve({ id: systemId, requirementId }) };
}

describe("POST /api/systems/[id]/assessments/[requirementId]/queries", () => {
  let ownerId: string;
  let reviewerId: string;
  let viewerId: string;
  let systemId: string;
  let requirementId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Raise Query Owner", role: "SYSTEM_OWNER" },
    });
    const reviewer = await prisma.user.upsert({
      where: { email: REVIEWER_EMAIL },
      update: {},
      create: { email: REVIEWER_EMAIL, name: "Raise Query Reviewer", role: "REVIEWER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Raise Query Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    reviewerId = reviewer.id;
    viewerId = viewer.id;

    const system = await prisma.system.create({
      data: { name: `Raise Query System ${Date.now()}`, ownerId, status: "IN_REVIEW" },
    });
    systemId = system.id;

    const requirement = await prisma.requirement.create({
      data: {
        code: `RAISE-QUERY-${Date.now()}`,
        title: "Raise Query Target",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    requirementId = requirement.id;
  });

  afterAll(async () => {
    await prisma.requirementQuery.deleteMany({ where: { requirementAssessment: { systemId } } });
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({ where: { id: requirementId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, REVIEWER_EMAIL, VIEWER_EMAIL] } } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await POST(
      requestAs(systemId, requirementId, null, { body: "Why?" }),
      ctxFor(systemId, requirementId),
    );
    expect(response.status).toBe(401);
  });

  it("forbids the System Owner from raising a question on their own System", async () => {
    const response = await POST(
      requestAs(systemId, requirementId, ownerId, { body: "Why?" }),
      ctxFor(systemId, requirementId),
    );
    expect(response.status).toBe(403);
  });

  it("forbids a VIEWER", async () => {
    const response = await POST(
      requestAs(systemId, requirementId, viewerId, { body: "Why?" }),
      ctxFor(systemId, requirementId),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an empty body", async () => {
    const response = await POST(
      requestAs(systemId, requirementId, reviewerId, { body: "" }),
      ctxFor(systemId, requirementId),
    );
    expect(response.status).toBe(400);
  });

  it("lets a REVIEWER raise a question", async () => {
    const response = await POST(
      requestAs(systemId, requirementId, reviewerId, { body: "Please clarify the evidence." }),
      ctxFor(systemId, requirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.query.resolved).toBe(false);
    expect(body.query.messages).toHaveLength(1);
    expect(body.query.messages[0].author.id).toBe(reviewerId);
  });

  it("returns 404 for a Requirement that isn't applicable to this System", async () => {
    const orgRequirement = await prisma.requirement.create({
      data: {
        code: `RAISE-QUERY-ORG-${Date.now()}`,
        title: "Org only",
        description: "desc",
        category: "Security",
        applicability: "ORGANIZATIONAL",
      },
    });

    const response = await POST(
      requestAs(systemId, orgRequirement.id, reviewerId, { body: "Why?" }),
      ctxFor(systemId, orgRequirement.id),
    );
    expect(response.status).toBe(404);

    await prisma.requirement.delete({ where: { id: orgRequirement.id } });
  });
});

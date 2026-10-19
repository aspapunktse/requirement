import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { raiseQuery, NAMED } from "@/lib/assessment-queries";
import { POST } from "../route";

const OWNER_EMAIL = "test-query-resolve-owner@example.com";
const REVIEWER_EMAIL = "test-query-resolve-reviewer@example.com";
const RISK_OWNER_EMAIL = "test-query-resolve-risk-owner@example.com";

function urlFor(systemId: string, controlId: string, queryId: string) {
  return `http://localhost/api/systems/${systemId}/assessments/${controlId}/queries/${queryId}/resolve`;
}

function requestAs(systemId: string, controlId: string, queryId: string, userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(systemId, controlId, queryId), { method: "POST", headers });
}

function ctxFor(systemId: string, controlId: string, queryId: string) {
  return { params: Promise.resolve({ id: systemId, controlId, queryId }) };
}

describe("POST .../queries/[queryId]/resolve", () => {
  let ownerId: string;
  let reviewerId: string;
  let riskOwnerId: string;
  let systemId: string;
  let controlId: string;
  let queryId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Query Resolve Owner", role: "SYSTEM_OWNER" },
    });
    const reviewer = await prisma.user.upsert({
      where: { email: REVIEWER_EMAIL },
      update: {},
      create: { email: REVIEWER_EMAIL, name: "Query Resolve Reviewer", role: "REVIEWER" },
    });
    const riskOwner = await prisma.user.upsert({
      where: { email: RISK_OWNER_EMAIL },
      update: {},
      create: { email: RISK_OWNER_EMAIL, name: "Query Resolve Risk Owner", role: "RISK_OWNER" },
    });
    ownerId = owner.id;
    reviewerId = reviewer.id;
    riskOwnerId = riskOwner.id;

    const system = await prisma.system.create({
      data: { name: `Query Resolve System ${Date.now()}`, ownerId, status: "IN_REVIEW" },
    });
    systemId = system.id;

    const control = await prisma.control.create({
      data: {
        code: `QUERY-RESOLVE-${Date.now()}`,
        title: "Resolve Target",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    controlId = control.id;
  });

  beforeEach(async () => {
    const query = await raiseQuery({ id: systemId }, controlId, reviewerId, "Please clarify", NAMED);
    queryId = query.id;
  });

  afterAll(async () => {
    await prisma.assessmentQuery.deleteMany({ where: { controlAssessment: { systemId } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, REVIEWER_EMAIL, RISK_OWNER_EMAIL] } } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await POST(requestAs(systemId, controlId, queryId, null), ctxFor(systemId, controlId, queryId));
    expect(response.status).toBe(401);
  });

  it("forbids the System Owner from resolving their own Query", async () => {
    const response = await POST(
      requestAs(systemId, controlId, queryId, ownerId),
      ctxFor(systemId, controlId, queryId),
    );
    expect(response.status).toBe(403);
  });

  it("lets a REVIEWER resolve a Query they didn't raise themselves", async () => {
    const response = await POST(
      requestAs(systemId, controlId, queryId, riskOwnerId),
      ctxFor(systemId, controlId, queryId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.query.resolved).toBe(true);
    expect(body.query.resolvedBy.id).toBe(riskOwnerId);
    expect(body.query).not.toHaveProperty("resolvedById");
    expect((await prisma.assessmentQuery.findUniqueOrThrow({ where: { id: queryId } })).resolvedById).toBe(riskOwnerId);
  });

  it("lets the original asker resolve their own Query too", async () => {
    const response = await POST(
      requestAs(systemId, controlId, queryId, reviewerId),
      ctxFor(systemId, controlId, queryId),
    );
    expect(response.status).toBe(200);
  });
});

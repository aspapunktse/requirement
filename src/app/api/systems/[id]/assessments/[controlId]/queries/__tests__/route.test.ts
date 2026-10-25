import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { POST } from "../route";

const OWNER_EMAIL = "test-raise-query-owner@example.com";
const REVIEWER_EMAIL = "test-raise-query-reviewer@example.com";
const VIEWER_EMAIL = "test-raise-query-viewer@example.com";

function urlFor(systemId: string, controlId: string) {
  return `http://localhost/api/systems/${systemId}/assessments/${controlId}/queries`;
}

function requestAs(systemId: string, controlId: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(systemId, controlId), {
    method: "POST",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(systemId: string, controlId: string) {
  return { params: Promise.resolve({ id: systemId, controlId }) };
}

describe("POST /api/systems/[id]/assessments/[controlId]/queries", () => {
  let ownerId: string;
  let reviewerId: string;
  let viewerId: string;
  let systemId: string;
  let controlId: string;
  let facetId: string;

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

    // A fixture Facet scopes the Control to this file's System: unscoped, on the base, it would apply to other
    // files' Systems too (#231).
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test Raise Query Facet ${Date.now()}` } })).id;
    const system = await prisma.system.create({
      data: { name: `Raise Query System ${Date.now()}`, ownerId, status: "IN_REVIEW", deploymentFacets: { connect: [{ id: facetId }] } },
    });
    systemId = system.id;

    const control = await prisma.control.create({
      data: {
        code: `RAISE-QUERY-${Date.now()}`,
        title: "Raise Query Target",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: facetId }] },
      },
    });
    controlId = control.id;
    await mapControlsToBase([controlId]);
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    await prisma.assessmentQuery.deleteMany({ where: { controlAssessment: { systemId } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, REVIEWER_EMAIL, VIEWER_EMAIL] } } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await POST(
      requestAs(systemId, controlId, null, { body: "Why?" }),
      ctxFor(systemId, controlId),
    );
    expect(response.status).toBe(401);
  });

  it("forbids the System Owner from raising a question on their own System", async () => {
    const response = await POST(
      requestAs(systemId, controlId, ownerId, { body: "Why?" }),
      ctxFor(systemId, controlId),
    );
    expect(response.status).toBe(403);
  });

  it("forbids a VIEWER", async () => {
    const response = await POST(
      requestAs(systemId, controlId, viewerId, { body: "Why?" }),
      ctxFor(systemId, controlId),
    );
    expect(response.status).toBe(403);
  });

  it("rejects an empty body", async () => {
    const response = await POST(
      requestAs(systemId, controlId, reviewerId, { body: "" }),
      ctxFor(systemId, controlId),
    );
    expect(response.status).toBe(400);
  });

  it("lets a REVIEWER raise a question", async () => {
    const response = await POST(
      requestAs(systemId, controlId, reviewerId, { body: "Please clarify the evidence." }),
      ctxFor(systemId, controlId),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.query.resolved).toBe(false);
    expect(body.query.messages).toHaveLength(1);
    expect(body.query.messages[0].author.id).toBe(reviewerId);
  });

  it("returns 404 for a Control that isn't applicable to this System", async () => {
    const orgControl = await prisma.control.create({
      data: {
        code: `RAISE-QUERY-ORG-${Date.now()}`,
        title: "Org only",
        description: "desc",
        category: "Security",
        applicability: "ORGANIZATIONAL",
      },
    });

    const response = await POST(
      requestAs(systemId, orgControl.id, reviewerId, { body: "Why?" }),
      ctxFor(systemId, orgControl.id),
    );
    expect(response.status).toBe(404);

    await prisma.control.delete({ where: { id: orgControl.id } });
  });
});

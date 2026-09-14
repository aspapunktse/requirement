import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, PATCH } from "../route";

const ADMIN_EMAIL = "test-requirement-mapping-admin@example.com";
const VIEWER_EMAIL = "test-requirement-mapping-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/requirements/${id}`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { ...init, headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/requirements/[id]", () => {
  let adminId: string;
  let viewerId: string;
  let perSystemRequirementId: string;
  let organizationalRequirementId: string;
  let systemTypeAId: string;
  let systemTypeBId: string;
  let capabilityId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Requirement Mapping Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Requirement Mapping Viewer", role: "VIEWER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;

    const systemTypeA = await prisma.deploymentFacet.create({
      data: { name: `Test Type A ${Date.now()}` },
    });
    const systemTypeB = await prisma.deploymentFacet.create({
      data: { name: `Test Type B ${Date.now()}` },
    });
    systemTypeAId = systemTypeA.id;
    systemTypeBId = systemTypeB.id;

    const capability = await prisma.capability.create({
      data: { name: `Test Capability ${Date.now()}` },
    });
    capabilityId = capability.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [systemTypeAId, systemTypeBId] } } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
  });

  beforeEach(async () => {
    const perSystem = await prisma.requirement.create({
      data: {
        code: `TEST-MAP-SYS-${Date.now()}`,
        title: "Test per-system requirement",
        description: "For mapping tests.",
        category: "Test",
        applicability: "BOTH",
        question: "Does it do the thing?",
      },
    });
    perSystemRequirementId = perSystem.id;

    const organizational = await prisma.requirement.create({
      data: {
        code: `TEST-MAP-ORG-${Date.now()}`,
        title: "Test organizational requirement",
        description: "For mapping tests.",
        category: "Test",
        applicability: "ORGANIZATIONAL",
      },
    });
    organizationalRequirementId = organizational.id;
  });

  afterEach(async () => {
    await prisma.requirement.deleteMany({
      where: { id: { in: [perSystemRequirementId, organizationalRequirementId] } },
    });
  });

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(perSystemRequirementId, null), ctxFor(perSystemRequirementId));
    expect(response.status).toBe(401);
  });

  it("GET returns 404 for a Requirement that doesn't exist", async () => {
    const response = await GET(requestAs("does-not-exist", viewerId), ctxFor("does-not-exist"));
    expect(response.status).toBe(404);
  });

  it("PATCH rejects a non-admin", async () => {
    const response = await PATCH(
      requestAs(perSystemRequirementId, viewerId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [systemTypeAId] }),
      }),
      ctxFor(perSystemRequirementId),
    );
    expect(response.status).toBe(403);
  });

  it("PATCH lets an admin scope a requirement to Deployment Facets", async () => {
    const response = await PATCH(
      requestAs(perSystemRequirementId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [systemTypeAId, systemTypeBId] }),
      }),
      ctxFor(perSystemRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requirement.deploymentFacets.map((t: { id: string }) => t.id).sort()).toEqual(
      [systemTypeAId, systemTypeBId].sort(),
    );

    const getResponse = await GET(requestAs(perSystemRequirementId, viewerId), ctxFor(perSystemRequirementId));
    const getBody = await getResponse.json();
    expect(getBody.requirement.deploymentFacets).toHaveLength(2);
  });

  it("PATCH lets an admin map Capabilities to a requirement", async () => {
    const response = await PATCH(
      requestAs(perSystemRequirementId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ capabilityIds: [capabilityId] }),
      }),
      ctxFor(perSystemRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requirement.capabilities).toMatchObject([{ id: capabilityId }]);
  });

  it("PATCH clears a mapping when given an empty array (applies regardless of facet)", async () => {
    await PATCH(
      requestAs(perSystemRequirementId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [systemTypeAId] }),
      }),
      ctxFor(perSystemRequirementId),
    );

    const response = await PATCH(
      requestAs(perSystemRequirementId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [] }),
      }),
      ctxFor(perSystemRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requirement.deploymentFacets).toEqual([]);
  });

  it("PATCH rejects scoping an ORGANIZATIONAL requirement to Deployment Facets", async () => {
    const response = await PATCH(
      requestAs(organizationalRequirementId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [systemTypeAId] }),
      }),
      ctxFor(organizationalRequirementId),
    );
    expect(response.status).toBe(400);
  });

  it("PATCH rejects an empty update body", async () => {
    const response = await PATCH(
      requestAs(perSystemRequirementId, adminId, { method: "PATCH", body: JSON.stringify({}) }),
      ctxFor(perSystemRequirementId),
    );
    expect(response.status).toBe(400);
  });

  it("PATCH returns 404 for a Requirement that doesn't exist", async () => {
    const response = await PATCH(
      requestAs("does-not-exist", adminId, {
        method: "PATCH",
        body: JSON.stringify({ capabilityIds: [] }),
      }),
      ctxFor("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("PATCH lets an admin edit core fields, including a multi-value framework list", async () => {
    const response = await PATCH(
      requestAs(perSystemRequirementId, adminId, {
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated title",
          framework: ["ISO27001:2022 Annex A", "CSA CCM 4.0"],
        }),
      }),
      ctxFor(perSystemRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requirement).toMatchObject({
      title: "Updated title",
      framework: ["ISO27001:2022 Annex A", "CSA CCM 4.0"],
    });
  });

  it("PATCH rejects an unknown Deployment Facet id", async () => {
    const response = await PATCH(
      requestAs(perSystemRequirementId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: ["does-not-exist"] }),
      }),
      ctxFor(perSystemRequirementId),
    );
    expect(response.status).toBe(400);
  });
});

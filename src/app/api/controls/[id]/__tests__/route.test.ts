import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, PATCH } from "../route";

const ADMIN_EMAIL = "test-control-library-admin@example.com";
const VIEWER_EMAIL = "test-control-library-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/controls/${id}`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { ...init, headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/controls/[id]", () => {
  let adminId: string;
  let viewerId: string;
  let perSystemControlId: string;
  let organizationalControlId: string;
  let systemTypeAId: string;
  let systemTypeBId: string;
  let capabilityId: string;
  let frameworkAId: string;
  let frameworkBId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Control Library Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Control Library Viewer", role: "VIEWER" },
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

    const frameworkA = await prisma.framework.create({ data: { name: `Test Framework A ${Date.now()}` } });
    const frameworkB = await prisma.framework.create({ data: { name: `Test Framework B ${Date.now()}` } });
    frameworkAId = frameworkA.id;
    frameworkBId = frameworkB.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [systemTypeAId, systemTypeBId] } } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
    await prisma.framework.deleteMany({ where: { id: { in: [frameworkAId, frameworkBId] } } });
  });

  beforeEach(async () => {
    const perSystem = await prisma.control.create({
      data: {
        code: `TEST-MAP-SYS-${Date.now()}`,
        title: "Test per-system control",
        description: "For mapping tests.",
        category: "Test",
        applicability: "BOTH",
        question: "Does it do the thing?",
      },
    });
    perSystemControlId = perSystem.id;

    const organizational = await prisma.control.create({
      data: {
        code: `TEST-MAP-ORG-${Date.now()}`,
        title: "Test organizational control",
        description: "For mapping tests.",
        category: "Test",
        applicability: "ORGANIZATIONAL",
      },
    });
    organizationalControlId = organizational.id;
  });

  afterEach(async () => {
    await prisma.control.deleteMany({
      where: { id: { in: [perSystemControlId, organizationalControlId] } },
    });
  });

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(perSystemControlId, null), ctxFor(perSystemControlId));
    expect(response.status).toBe(401);
  });

  it("GET returns 404 for a Control that doesn't exist", async () => {
    const response = await GET(requestAs("does-not-exist", viewerId), ctxFor("does-not-exist"));
    expect(response.status).toBe(404);
  });

  it("PATCH rejects a non-admin", async () => {
    const response = await PATCH(
      requestAs(perSystemControlId, viewerId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [systemTypeAId] }),
      }),
      ctxFor(perSystemControlId),
    );
    expect(response.status).toBe(403);
  });

  it("PATCH lets an admin scope a control to Deployment Facets", async () => {
    const response = await PATCH(
      requestAs(perSystemControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [systemTypeAId, systemTypeBId] }),
      }),
      ctxFor(perSystemControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.control.deploymentFacets.map((t: { id: string }) => t.id).sort()).toEqual(
      [systemTypeAId, systemTypeBId].sort(),
    );

    const getResponse = await GET(requestAs(perSystemControlId, viewerId), ctxFor(perSystemControlId));
    const getBody = await getResponse.json();
    expect(getBody.control.deploymentFacets).toHaveLength(2);
  });

  it("PATCH lets an admin map Capabilities to a control", async () => {
    const response = await PATCH(
      requestAs(perSystemControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ capabilityIds: [capabilityId] }),
      }),
      ctxFor(perSystemControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.control.capabilities).toMatchObject([{ id: capabilityId }]);
  });

  it("PATCH clears a mapping when given an empty array (applies regardless of facet)", async () => {
    await PATCH(
      requestAs(perSystemControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [systemTypeAId] }),
      }),
      ctxFor(perSystemControlId),
    );

    const response = await PATCH(
      requestAs(perSystemControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [] }),
      }),
      ctxFor(perSystemControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.control.deploymentFacets).toEqual([]);
  });

  it("PATCH rejects scoping an ORGANIZATIONAL control to Deployment Facets", async () => {
    const response = await PATCH(
      requestAs(organizationalControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: [systemTypeAId] }),
      }),
      ctxFor(organizationalControlId),
    );
    expect(response.status).toBe(400);
  });

  it("PATCH rejects an empty update body", async () => {
    const response = await PATCH(
      requestAs(perSystemControlId, adminId, { method: "PATCH", body: JSON.stringify({}) }),
      ctxFor(perSystemControlId),
    );
    expect(response.status).toBe(400);
  });

  it("PATCH returns 404 for a Control that doesn't exist", async () => {
    const response = await PATCH(
      requestAs("does-not-exist", adminId, {
        method: "PATCH",
        body: JSON.stringify({ capabilityIds: [] }),
      }),
      ctxFor("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("PATCH lets an admin edit core fields, including tagging more than one Framework", async () => {
    const response = await PATCH(
      requestAs(perSystemControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({
          title: "Updated title",
          frameworkIds: [frameworkAId, frameworkBId],
        }),
      }),
      ctxFor(perSystemControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.control.title).toBe("Updated title");
    expect(body.control.frameworks.map((f: { id: string }) => f.id).sort()).toEqual(
      [frameworkAId, frameworkBId].sort(),
    );
  });

  it("PATCH rejects an unknown Deployment Facet id", async () => {
    const response = await PATCH(
      requestAs(perSystemControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ deploymentFacetIds: ["does-not-exist"] }),
      }),
      ctxFor(perSystemControlId),
    );
    expect(response.status).toBe(400);
  });
});

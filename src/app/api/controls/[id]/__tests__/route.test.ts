import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, PATCH } from "../route";

const ADMIN_EMAIL = "test-control-library-admin@example.com";
const VIEWER_EMAIL = "test-control-library-viewer@example.com";
const CM_EMAIL = "test-control-library-cm@example.com";
const OWNER_EMAIL = "test-control-library-system-owner@example.com";

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
  let complianceManagerId: string;
  let systemOwnerId: string;
  let perSystemControlId: string;
  let organizationalControlId: string;
  let systemTypeAId: string;
  let systemTypeBId: string;
  let frameworkAId: string;
  let frameworkBId: string;
  let requirementAId: string;
  let requirementBId: string;

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
    const complianceManager = await prisma.user.upsert({
      where: { email: CM_EMAIL },
      update: {},
      create: { email: CM_EMAIL, name: "Control Library Compliance Manager", role: "COMPLIANCE_MANAGER" },
    });
    const systemOwner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Control Library System Owner", role: "SYSTEM_OWNER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;
    complianceManagerId = complianceManager.id;
    systemOwnerId = systemOwner.id;

    const systemTypeA = await prisma.deploymentFacet.create({
      data: { name: `Test Type A ${Date.now()}` },
    });
    const systemTypeB = await prisma.deploymentFacet.create({
      data: { name: `Test Type B ${Date.now()}` },
    });
    systemTypeAId = systemTypeA.id;
    systemTypeBId = systemTypeB.id;

    const frameworkA = await prisma.framework.create({ data: { name: `Test Framework A ${Date.now()}`, version: "1" } });
    const frameworkB = await prisma.framework.create({ data: { name: `Test Framework B ${Date.now()}`, version: "2" } });
    frameworkAId = frameworkA.id;
    frameworkBId = frameworkB.id;
    requirementAId = (
      await prisma.requirement.create({
        data: { frameworkId: frameworkAId, code: "TA.1", section: "TA", title: "Req A", text: "text" },
      })
    ).id;
    requirementBId = (
      await prisma.requirement.create({
        data: { frameworkId: frameworkBId, code: "TB.1", section: "TB", title: "Req B", text: "text" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL, CM_EMAIL, OWNER_EMAIL] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [systemTypeAId, systemTypeBId] } } });
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
        body: JSON.stringify({ title: "x" }),
      }),
      ctxFor("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("PATCH lets an admin edit core fields and returns the Control's Control Mappings", async () => {
    await prisma.controlMapping.createMany({
      data: [
        { requirementId: requirementAId, controlId: perSystemControlId, coverage: "FULL" },
        { requirementId: requirementBId, controlId: perSystemControlId, coverage: "PARTIAL" },
      ],
    });

    const response = await PATCH(
      requestAs(perSystemControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ title: "Updated title" }),
      }),
      ctxFor(perSystemControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.control.title).toBe("Updated title");
    expect(
      body.control.mappings
        .map((m: { coverage: string; requirement: { id: string } }) => [m.requirement.id, m.coverage])
        .sort(),
    ).toEqual(
      [
        [requirementAId, "FULL"],
        [requirementBId, "PARTIAL"],
      ].sort(),
    );
  });

  it("PATCH no longer tags a Control with Frameworks directly: frameworkIds is ignored", async () => {
    const response = await PATCH(
      requestAs(perSystemControlId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ title: "Still updated", frameworkIds: [frameworkAId] }),
      }),
      ctxFor(perSystemControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.control.frameworks).toBeUndefined();
    expect(body.control.mappings).toEqual([]);
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

  describe("minimum Sensitivity Level", () => {
    const patchLevel = (userId: string, value: unknown) =>
      PATCH(
        requestAs(perSystemControlId, userId, { method: "PATCH", body: JSON.stringify({ minSensitivityLevel: value }) }),
        ctxFor(perSystemControlId),
      );
    const stored = async () => (await prisma.control.findUniqueOrThrow({ where: { id: perSystemControlId } })).minSensitivityLevel;

    it("lets a Compliance Manager and an Admin set it, and clear it", async () => {
      const set = await patchLevel(complianceManagerId, 4);
      expect(set.status).toBe(200);
      expect((await set.json()).control).toMatchObject({ minSensitivityLevel: 4, minSensitivity: { label: "Highly Sensitive" } });
      expect(await stored()).toBe(4);

      expect((await patchLevel(adminId, 5)).status).toBe(200);
      expect(await stored()).toBe(5);
      expect((await patchLevel(adminId, null)).status).toBe(200);
      expect(await stored()).toBeNull();
    });

    it.each([0, 6, 1.5, "HIGH", "4"])("rejects %j with 400 and changes nothing", async (value) => {
      await prisma.control.update({ where: { id: perSystemControlId }, data: { minSensitivityLevel: 3 } });
      expect((await patchLevel(adminId, value)).status).toBe(400);
      expect(await stored()).toBe(3);
    });

    it("refuses a System Owner, a Viewer and an unauthenticated request with 403/401, and changes nothing", async () => {
      await prisma.control.update({ where: { id: perSystemControlId }, data: { minSensitivityLevel: 3 } });
      expect((await patchLevel(systemOwnerId, 5)).status).toBe(403);
      expect((await patchLevel(viewerId, 5)).status).toBe(403);
      const anonymous = await PATCH(
        requestAs(perSystemControlId, null, { method: "PATCH", body: JSON.stringify({ minSensitivityLevel: 5 }) }),
        ctxFor(perSystemControlId),
      );
      expect(anonymous.status).toBe(401);
      expect(await stored()).toBe(3);
    });

    it("rejects a minimum on an ORGANIZATIONAL Control and changes nothing", async () => {
      const response = await PATCH(
        requestAs(organizationalControlId, adminId, { method: "PATCH", body: JSON.stringify({ minSensitivityLevel: 4 }) }),
        ctxFor(organizationalControlId),
      );
      expect(response.status).toBe(400);
      expect((await prisma.control.findUniqueOrThrow({ where: { id: organizationalControlId } })).minSensitivityLevel).toBeNull();
    });
  });
});

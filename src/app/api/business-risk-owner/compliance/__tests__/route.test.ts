import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

const suffix = Date.now();
const OWNER_EMAIL = `test-bro-compliance-owner-${suffix}@example.com`;
const BRO_EMAIL = `test-bro-compliance-bro-${suffix}@example.com`;
const VIEWER_EMAIL = `test-bro-compliance-viewer-${suffix}@example.com`;
const ADMIN_EMAIL = `test-bro-compliance-admin-${suffix}@example.com`;

function requestAs(userId: string | null, query = "") {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/business-risk-owner/compliance${query}`, { headers });
}

describe("GET /api/business-risk-owner/compliance", () => {
  let ownerId: string;
  let broId: string;
  let viewerId: string;
  let adminId: string;
  let businessUnitId: string;
  let otherBusinessUnitId: string;
  let controlId: string;
  let systemId: string;
  let facetId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "BRO Compliance Owner", role: "SYSTEM_OWNER" },
    });
    const bro = await prisma.user.upsert({
      where: { email: BRO_EMAIL },
      update: {},
      create: { email: BRO_EMAIL, name: "BRO Compliance BRO", role: "BUSINESS_RISK_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "BRO Compliance Viewer", role: "VIEWER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "BRO Compliance Admin", role: "ADMIN" },
    });
    ownerId = owner.id;
    broId = bro.id;
    viewerId = viewer.id;
    adminId = admin.id;

    const businessUnit = await prisma.businessUnit.create({ data: { name: `Test BRO Compliance BU ${suffix}` } });
    const otherBusinessUnit = await prisma.businessUnit.create({
      data: { name: `Test BRO Compliance Other BU ${suffix}` },
    });
    businessUnitId = businessUnit.id;
    otherBusinessUnitId = otherBusinessUnit.id;

    await prisma.user.update({ where: { id: broId }, data: { businessUnitScopes: { connect: { id: businessUnitId } } } });

    // Scope the fixture Control/System to a dedicated Deployment Facet
    // so it doesn't get diluted by the real seeded ISO 27001 catalog (which
    // applies to every unscoped System) — see the compliance.test.ts note.
    const facet = await prisma.deploymentFacet.create({ data: { name: `Test BRO Compliance Facet ${suffix}` } });
    facetId = facet.id;

    const control = await prisma.control.create({
      data: {
        code: `TEST-BRO-COMPLIANCE-${suffix}`,
        title: "Test control",
        description: "d",
        category: "Test",
        applicability: "BOTH",
        mandatory: true,
        deploymentFacets: { connect: { id: facetId } },
      },
    });
    controlId = control.id;
    await mapControlsToBase([controlId]);

    const system = await prisma.system.create({
      data: {
        name: `Test BRO Compliance System ${suffix}`,
        ownerId,
        deploymentFacets: { connect: { id: facetId } },
        businessUnits: { connect: { id: businessUnitId } },
      },
    });
    systemId = system.id;

    await prisma.controlAssessment.create({
      data: { systemId, controlId, status: "FULFILLED" },
    });
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.businessUnit.deleteMany({ where: { id: { in: [businessUnitId, otherBusinessUnitId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, BRO_EMAIL, VIEWER_EMAIL, ADMIN_EMAIL] } } });
  });

  it("rejects a role that isn't ADMIN or BUSINESS_RISK_OWNER", async () => {
    const response = await GET(requestAs(viewerId));
    expect(response.status).toBe(403);
  });

  it("computes compliance for the Business Risk Owner's assigned scope with no filter", async () => {
    const response = await GET(requestAs(broId));
    const body = await response.json();

    expect(response.status).toBe(200);
    // No frameworkId filter here means the real seeded Control Library's
    // own unscoped mandatory Controls are legitimately part of the mix
    // (that's correct product behavior, not test pollution — see
    // compliance.test.ts for exact-math assertions via a frameworkId
    // filter, which is what actually isolates fixture data). This route
    // test only needs to prove the fixture System and its one FULFILLED
    // Assessment are included in the scoped result.
    const fixtureSystem = body.compliance.bySystem.find((s: { systemId: string }) => s.systemId === systemId);
    expect(fixtureSystem).toBeTruthy();
    expect(fixtureSystem.resolved).toBeGreaterThanOrEqual(1);
    expect(fixtureSystem.total).toBeGreaterThanOrEqual(fixtureSystem.resolved);
  });

  it("rejects filtering by a Business Unit the Business Risk Owner isn't assigned to", async () => {
    const response = await GET(requestAs(broId, `?businessUnitId=${otherBusinessUnitId}`));
    expect(response.status).toBe(403);
  });

  it("accepts filtering by an assigned Business Unit", async () => {
    const response = await GET(requestAs(broId, `?businessUnitId=${businessUnitId}`));
    expect(response.status).toBe(200);
  });

  it("lets an ADMIN filter by any Business Unit unrestricted, including one no Business Risk Owner is assigned to", async () => {
    const response = await GET(requestAs(adminId, `?businessUnitId=${otherBusinessUnitId}`));
    expect(response.status).toBe(200);
  });
});

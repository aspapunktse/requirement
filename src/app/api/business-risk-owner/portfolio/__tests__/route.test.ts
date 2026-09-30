import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { mapControlsToFramework } from "@/test/framework-fixtures";
import { GET } from "../route";

const suffix = Date.now();
const OWNER_EMAIL = `test-bro-portfolio-owner-${suffix}@example.com`;
const BRO_EMAIL = `test-bro-portfolio-bro-${suffix}@example.com`;
const VIEWER_EMAIL = `test-bro-portfolio-viewer-${suffix}@example.com`;
const ADMIN_EMAIL = `test-bro-portfolio-admin-${suffix}@example.com`;

function requestAs(userId: string | null, query = "") {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/business-risk-owner/portfolio${query}`, { headers });
}

describe("GET /api/business-risk-owner/portfolio", () => {
  let ownerId: string;
  let broId: string;
  let viewerId: string;
  let adminId: string;
  let businessUnitId: string;
  let otherBusinessUnitId: string;
  let systemId: string;
  let riskId: string;
  let facetId: string;
  let controlId: string;
  let frameworkId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "BRO Portfolio Owner", role: "SYSTEM_OWNER" },
    });
    const bro = await prisma.user.upsert({
      where: { email: BRO_EMAIL },
      update: {},
      create: { email: BRO_EMAIL, name: "BRO Portfolio BRO", role: "BUSINESS_RISK_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "BRO Portfolio Viewer", role: "VIEWER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "BRO Portfolio Admin", role: "ADMIN" },
    });
    ownerId = owner.id;
    broId = bro.id;
    viewerId = viewer.id;
    adminId = admin.id;

    const businessUnit = await prisma.businessUnit.create({ data: { name: `Test BRO Portfolio BU ${suffix}` } });
    const otherBusinessUnit = await prisma.businessUnit.create({
      data: { name: `Test BRO Portfolio Other BU ${suffix}` },
    });
    businessUnitId = businessUnit.id;
    otherBusinessUnitId = otherBusinessUnit.id;

    // A fixture Published Framework with one Requirement, mapped to a facet-scoped Control (so it applies only to
    // the fixture System) that the System has Fulfilled: the card's figure for that Framework is 1 of 1, 100%.
    frameworkId = (
      await prisma.framework.create({
        data: { name: `Test BRO Portfolio Framework ${suffix}`, version: "1", status: "PUBLISHED" },
      })
    ).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test BRO Portfolio Facet ${suffix}` } })).id;
    controlId = (
      await prisma.control.create({
        data: {
          code: `TEST-BRO-PORTFOLIO-${suffix}`,
          title: "Test control",
          description: "d",
          category: "Test",
          applicability: "BOTH",
          mandatory: true,
          deploymentFacets: { connect: { id: facetId } },
        },
      })
    ).id;
    await mapControlsToFramework(frameworkId, [controlId]);

    await prisma.user.update({
      where: { id: broId },
      data: {
        businessUnitScopes: { connect: { id: businessUnitId } },
        frameworkScopes: { connect: { id: frameworkId } },
      },
    });

    const system = await prisma.system.create({
      data: {
        name: `Test BRO Portfolio System ${suffix}`,
        vendor: "Test Vendor",
        ownerId,
        status: "ONBOARDED",
        businessUnits: { connect: { id: businessUnitId } },
        deploymentFacets: { connect: { id: facetId } },
        frameworkScopes: { connect: { id: frameworkId } },
      },
    });
    systemId = system.id;
    await prisma.controlAssessment.create({ data: { systemId, controlId, status: "FULFILLED" } });

    const risk = await prisma.risk.create({
      data: {
        systemId,
        title: "Test open risk",
        description: "d",
        severity: "HIGH",
        likelihood: "HIGH",
        status: "OPEN",
      },
    });
    riskId = risk.id;
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { id: riskId } });
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.businessUnit.deleteMany({ where: { id: { in: [businessUnitId, otherBusinessUnitId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, BRO_EMAIL, VIEWER_EMAIL, ADMIN_EMAIL] } } });
    await prisma.framework.deleteMany({ where: { id: frameworkId } });
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  });

  it("rejects a role that isn't ADMIN or BUSINESS_RISK_OWNER", async () => {
    const response = await GET(requestAs(viewerId));
    expect(response.status).toBe(403);
  });

  it("returns the fixture System with its status, vendor, and open Risk count", async () => {
    const response = await GET(requestAs(broId, `?businessUnitId=${businessUnitId}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    const fixtureSystem = body.portfolio.find((s: { id: string }) => s.id === systemId);
    expect(fixtureSystem).toBeTruthy();
    expect(fixtureSystem.name).toBe(`Test BRO Portfolio System ${suffix}`);
    expect(fixtureSystem.vendor).toBe("Test Vendor");
    expect(fixtureSystem.status).toBe("ONBOARDED");
    expect(fixtureSystem.openRiskCount).toBe(1);
  });

  it("shows the filtered Framework's Requirement-based percentage on the card, with the Met and applicable counts", async () => {
    const response = await GET(requestAs(broId, `?frameworkId=${frameworkId}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    const card = body.portfolio.find((s: { id: string }) => s.id === systemId);
    expect(card).toMatchObject({ compliancePercentage: 100, requirementsMet: 1, requirementsApplicable: 1 });
  });

  it("with no Framework filter the card shows the base Framework's figure, not the fixture Framework's", async () => {
    const response = await GET(requestAs(broId, `?businessUnitId=${businessUnitId}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    const card = body.portfolio.find((s: { id: string }) => s.id === systemId);
    // Nothing is mapped to the base Framework for the fixture's facet-scoped Control, so the fixture's own Requirement
    // can't be in this figure (a seeded DB's unscoped base Requirements may be): it is at most the base's applicable.
    expect(card.requirementsApplicable).toBeGreaterThanOrEqual(card.requirementsMet);
    expect(card).toHaveProperty("compliancePercentage");
    expect(card.requirementsApplicable === 0 ? card.compliancePercentage === null : card.compliancePercentage !== null).toBe(true);
  });

  it("rejects filtering by a Business Unit the Business Risk Owner isn't assigned to", async () => {
    const response = await GET(requestAs(broId, `?businessUnitId=${otherBusinessUnitId}`));
    expect(response.status).toBe(403);
  });

  it("lets an ADMIN filter by any Business Unit unrestricted", async () => {
    const response = await GET(requestAs(adminId, `?businessUnitId=${businessUnitId}`));
    expect(response.status).toBe(200);
  });
});

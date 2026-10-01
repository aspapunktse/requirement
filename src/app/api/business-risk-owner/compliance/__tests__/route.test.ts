import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBaseFramework, mapControlsToBase, mapControlsToFramework } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

const suffix = Date.now();
const OWNER_EMAIL = `test-bro-compliance-owner-${suffix}@example.com`;
const BRO_EMAIL = `test-bro-compliance-bro-${suffix}@example.com`;
const BASE_BRO_EMAIL = `test-bro-compliance-basebro-${suffix}@example.com`;
const VIEWER_EMAIL = `test-bro-compliance-viewer-${suffix}@example.com`;
const ADMIN_EMAIL = `test-bro-compliance-admin-${suffix}@example.com`;

function requestAs(userId: string | null, query = "") {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/business-risk-owner/compliance${query}`, { headers });
}

type Body = {
  compliance: {
    framework: { id: string; isBase: boolean } | null;
    met: number;
    applicable: number;
    percentage: number | null;
    bySystem: { systemId: string; met: number; applicable: number; percentage: number | null }[];
  };
};

/**
 * The Requirement-based Compliance Percentage endpoint (#90). Fixtures: one
 * facet-scoped Control (so it only applies to the fixture System), mapped to a
 * fixture Requirement of the base Framework and of a fixture Published non-base
 * Framework that the System declares. The System is Fulfilled on that Control.
 */
describe("GET /api/business-risk-owner/compliance", () => {
  let ownerId: string;
  let broId: string;
  let baseBroId: string;
  let viewerId: string;
  let adminId: string;
  let businessUnitId: string;
  let otherBusinessUnitId: string;
  let controlId: string;
  let systemId: string;
  let facetId: string;
  let frameworkId: string;
  let unassignedFrameworkId: string;
  let baseId: string;

  beforeAll(async () => {
    const user = (email: string, name: string, role: "SYSTEM_OWNER" | "BUSINESS_RISK_OWNER" | "VIEWER" | "ADMIN") =>
      prisma.user.upsert({ where: { email }, update: {}, create: { email, name, role } });
    ownerId = (await user(OWNER_EMAIL, "BRO Compliance Owner", "SYSTEM_OWNER")).id;
    broId = (await user(BRO_EMAIL, "BRO Compliance BRO", "BUSINESS_RISK_OWNER")).id;
    baseBroId = (await user(BASE_BRO_EMAIL, "BRO Compliance Base BRO", "BUSINESS_RISK_OWNER")).id;
    viewerId = (await user(VIEWER_EMAIL, "BRO Compliance Viewer", "VIEWER")).id;
    adminId = (await user(ADMIN_EMAIL, "BRO Compliance Admin", "ADMIN")).id;

    const businessUnit = await prisma.businessUnit.create({ data: { name: `Test BRO Compliance BU ${suffix}` } });
    const otherBusinessUnit = await prisma.businessUnit.create({
      data: { name: `Test BRO Compliance Other BU ${suffix}` },
    });
    businessUnitId = businessUnit.id;
    otherBusinessUnitId = otherBusinessUnit.id;

    baseId = (await getBaseFramework()).id;
    frameworkId = (
      await prisma.framework.create({
        data: { name: `Test BRO Compliance Framework ${suffix}`, version: "1", status: "PUBLISHED" },
      })
    ).id;
    unassignedFrameworkId = (
      await prisma.framework.create({
        data: { name: `Test BRO Compliance Unassigned Framework ${suffix}`, version: "1", status: "PUBLISHED" },
      })
    ).id;

    // The first Business Risk Owner owns the Business Unit and the fixture Framework; the second only the base Framework.
    await prisma.user.update({
      where: { id: broId },
      data: {
        businessUnitScopes: { connect: { id: businessUnitId } },
        frameworkScopes: { connect: { id: frameworkId } },
      },
    });
    await prisma.user.update({ where: { id: baseBroId }, data: { frameworkScopes: { connect: { id: baseId } } } });

    // Scope the fixture Control/System to a dedicated Deployment Facet so the real seeded ISO 27001 catalog
    // (which applies to every unscoped System) can't dilute the fixture Requirements, see compliance.test.ts.
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test BRO Compliance Facet ${suffix}` } })).id;

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
    await mapControlsToFramework(frameworkId, [controlId]);
    await mapControlsToFramework(unassignedFrameworkId, [controlId]);

    // The System declares the fixture Frameworks but, like most real Systems, has no stored row for the base.
    const system = await prisma.system.create({
      data: {
        name: `Test BRO Compliance System ${suffix}`,
        ownerId,
        deploymentFacets: { connect: { id: facetId } },
        businessUnits: { connect: { id: businessUnitId } },
        frameworkScopes: { connect: [{ id: frameworkId }, { id: unassignedFrameworkId }] },
      },
    });
    systemId = system.id;

    await prisma.controlAssessment.create({ data: { systemId, controlId, status: "FULFILLED" } });
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.businessUnit.deleteMany({ where: { id: { in: [businessUnitId, otherBusinessUnitId] } } });
    await prisma.user.deleteMany({
      where: { email: { in: [OWNER_EMAIL, BRO_EMAIL, BASE_BRO_EMAIL, VIEWER_EMAIL, ADMIN_EMAIL] } },
    });
    await prisma.framework.deleteMany({ where: { id: { in: [frameworkId, unassignedFrameworkId] } } });
  });

  const fixtureRow = (body: Body) => body.compliance.bySystem.find((s) => s.systemId === systemId);

  it("rejects a role that isn't ADMIN or BUSINESS_RISK_OWNER", async () => {
    const response = await GET(requestAs(viewerId));
    expect(response.status).toBe(403);
  });

  it("with no filter reports the base Framework's Requirement-based figures for the assigned scope", async () => {
    const response = await GET(requestAs(broId, `?businessUnitId=${businessUnitId}`));
    const body: Body = await response.json();

    expect(response.status).toBe(200);
    // The headline is the base Framework, in scope of the System although it has no stored row for it. The seeded
    // catalog's unscoped Requirements may add to the figure on a seeded DB, so only the fixture's own
    // contribution (its Requirement is Met, being Fulfilled) is asserted: at least one Met of the applicable.
    expect(body.compliance.framework).toMatchObject({ id: baseId, isBase: true });
    const row = fixtureRow(body);
    expect(row).toBeTruthy();
    expect(row!.met).toBeGreaterThanOrEqual(1);
    expect(row!.applicable).toBeGreaterThanOrEqual(row!.met);
    expect(body.compliance.applicable).toBeGreaterThanOrEqual(row!.applicable);
    // The old Control-based keys are gone.
    expect(row).not.toHaveProperty("resolved");
    expect(row).not.toHaveProperty("total");
  });

  it("filtering by an assigned Framework gives exactly that Framework's figures (Met ÷ applicable, pooled)", async () => {
    const response = await GET(requestAs(broId, `?frameworkId=${frameworkId}`));
    const body: Body = await response.json();

    expect(response.status).toBe(200);
    expect(body.compliance.framework).toMatchObject({ id: frameworkId, isBase: false });
    // The fixture Framework has one Requirement, mapped to the one applicable Control, which is Fulfilled.
    expect(fixtureRow(body)).toMatchObject({ systemId, met: 1, applicable: 1, percentage: 100 });
    expect(body.compliance.bySystem.map((s) => s.systemId)).toContain(systemId);
  });

  it("rejects filtering by a Framework the Business Risk Owner isn't assigned to, even if the System declared it", async () => {
    const response = await GET(requestAs(broId, `?frameworkId=${unassignedFrameworkId}`));
    expect(response.status).toBe(403);
  });

  it("a Business Risk Owner assigned the base Framework sees every System, with or without a stored base scope row", async () => {
    for (const query of ["", `?frameworkId=${baseId}`]) {
      const response = await GET(requestAs(baseBroId, query));
      const body: Body = await response.json();
      expect(response.status).toBe(200);
      expect(body.compliance.framework).toMatchObject({ id: baseId, isBase: true });
      expect(fixtureRow(body), query || "no filter").toBeTruthy();
    }
  });

  it("rejects filtering by a Business Unit the Business Risk Owner isn't assigned to", async () => {
    const response = await GET(requestAs(broId, `?businessUnitId=${otherBusinessUnitId}`));
    expect(response.status).toBe(403);
  });

  it("accepts filtering by an assigned Business Unit", async () => {
    const response = await GET(requestAs(broId, `?businessUnitId=${businessUnitId}`));
    expect(response.status).toBe(200);
  });

  it("lets an ADMIN filter by any Business Unit or Framework unrestricted", async () => {
    const byUnit = await GET(requestAs(adminId, `?businessUnitId=${otherBusinessUnitId}`));
    expect(byUnit.status).toBe(200);

    const byFramework = await GET(requestAs(adminId, `?frameworkId=${unassignedFrameworkId}`));
    const body: Body = await byFramework.json();
    expect(byFramework.status).toBe(200);
    expect(fixtureRow(body)).toMatchObject({ systemId, met: 1, applicable: 1, percentage: 100 });
  });
});

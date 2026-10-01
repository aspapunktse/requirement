import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

/**
 * The row shape of GET /api/systems/[id]/assessments with inheritance (#121): the stored
 * `assessment` is the System's own row, unchanged, and each row also carries its `effective`
 * status and sources. Fixture Controls are scoped to a fixture Deployment Facet, so they only ever
 * apply to the fixture Systems.
 */
describe("GET /api/systems/[id]/assessments: effective status", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let ownerId: string;
  let facetId: string;
  let bothId: string;
  let bothNoRowId: string;
  let perSystemId: string;
  let systemId: string;

  const get = async () => {
    const headers = new Headers({ cookie: `${ACTING_USER_COOKIE}=${ownerId}` });
    const response = await GET(new NextRequest(`http://localhost/api/systems/${systemId}/assessments`, { headers }), {
      params: Promise.resolve({ id: systemId }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    return (controlId: string) => body.assessments.find((row: { control: { id: string } }) => row.control.id === controlId);
  };
  const setOrganization = (status: "NOT_STARTED" | "FULFILLED" | "WAIVED") =>
    prisma.organizationControlImplementation.upsert({
      where: { controlId: bothId },
      create: { controlId: bothId, status, description: status === "WAIVED" ? "Because" : null },
      update: { status, description: status === "WAIVED" ? "Because" : null },
    });

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `test-effapi-${suffix}@example.com`, name: "Test EffApi Owner", role: "SYSTEM_OWNER" } })).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test EffApi Facet ${suffix}` } })).id;
    const control = async (key: string, applicability: "BOTH" | "PER_SYSTEM") =>
      (
        await prisma.control.create({
          data: {
            code: `TEST-EFFAPI-${key}-${suffix}`,
            title: `Test EffApi ${key}`,
            description: "d",
            category: "Test",
            applicability,
            deploymentFacets: { connect: { id: facetId } },
          },
        })
      ).id;
    bothId = await control("both", "BOTH");
    bothNoRowId = await control("both-no-row", "BOTH");
    perSystemId = await control("per-system", "PER_SYSTEM");
    await mapControlsToBase([bothId, bothNoRowId, perSystemId]);
    systemId = (
      await prisma.system.create({
        data: { name: `Test EffApi System ${suffix}`, ownerId, status: "ONBOARDED", deploymentFacets: { connect: { id: facetId } } },
      })
    ).id;
    await prisma.controlAssessment.createMany({
      data: [
        { systemId, controlId: bothId },
        { systemId, controlId: perSystemId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: { in: [bothId, bothNoRowId, perSystemId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("shows the Organization as a source that gives no credit while it is not Fulfilled", async () => {
    await setOrganization("WAIVED");
    const row = (await get())(bothId);
    expect(row.assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });
    expect(row.effective).toEqual({
      status: "NOT_STARTED",
      source: { kind: "SYSTEM" },
      sources: [{ kind: "ORGANIZATION", type: "FULL", status: "WAIVED", givesCredit: false }],
      overridesInherited: false,
    });
  });

  it("carries the inherited status and its source once the Organization is Fulfilled, and leaves the stored row alone", async () => {
    await setOrganization("FULFILLED");
    const row = (await get())(bothId);
    expect(row.assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });
    expect(row.effective).toEqual({
      status: "FULFILLED",
      source: { kind: "ORGANIZATION", type: "FULL", status: "FULFILLED" },
      sources: [{ kind: "ORGANIZATION", type: "FULL", status: "FULFILLED", givesCredit: true }],
      overridesInherited: false,
    });
  });

  it("gives a Both Control with no Assessment row a null assessment and an effective status", async () => {
    await prisma.organizationControlImplementation.upsert({
      where: { controlId: bothNoRowId },
      create: { controlId: bothNoRowId, status: "FULFILLED" },
      update: { status: "FULFILLED" },
    });
    const row = (await get())(bothNoRowId);
    expect(row.assessment).toBeNull();
    expect(row.effective).toMatchObject({ status: "FULFILLED", source: { kind: "ORGANIZATION" } });
  });

  it("gives a Per-System Control no sources", async () => {
    const row = (await get())(perSystemId);
    expect(row.effective).toEqual({ status: "NOT_STARTED", source: { kind: "SYSTEM" }, sources: [], overridesInherited: false });
  });

  it("says a person-set Assessment overrides the Fulfilled Organization", async () => {
    await setOrganization("FULFILLED");
    await prisma.controlAssessment.update({
      where: { systemId_controlId: { systemId, controlId: bothId } },
      data: { status: "IN_PROGRESS", assessedById: ownerId, assessedAt: new Date() },
    });
    const row = (await get())(bothId);
    expect(row.assessment).toMatchObject({ status: "IN_PROGRESS" });
    expect(row.effective).toMatchObject({ status: "IN_PROGRESS", source: { kind: "SYSTEM" }, overridesInherited: true });
    expect(row.effective.sources).toEqual([{ kind: "ORGANIZATION", type: "FULL", status: "FULFILLED", givesCredit: true }]);
  });
});

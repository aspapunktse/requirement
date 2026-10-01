import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixtureFramework, mapControlsToBase, mapControlsToFramework } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { PATCH as patchAssessment } from "../../assessments/[controlId]/route";
import { POST as declareCapability } from "../../capabilities/route";
import { POST } from "../route";

/**
 * The seeded ISO 27001 catalog ships several mandatory Controls with no
 * System Type scoping, so they apply to every Type — including the one
 * created for this test. Satisfy all of them, not just the test's own
 * custom Control, so submission is only gated by what this test means
 * to gate it by.
 */
async function fulfillAllMandatoryControls(systemId: string, deploymentFacetIds: string[]) {
  const unaddressed = await getUnaddressedMandatoryControls({
    id: systemId,
    deploymentFacets: deploymentFacetIds.map((id) => ({ id })),
    frameworkScopes: [],
    confidentialityImpactLevel: null,
    integrityImpactLevel: null,
    availabilityImpactLevel: null,
  });
  await prisma.controlAssessment.createMany({
    data: unaddressed.map((control) => ({
      systemId,
      controlId: control.id,
      status: "FULFILLED" as const,
    })),
    skipDuplicates: true,
  });
}

const OWNER_EMAIL = "test-system-submit-owner@example.com";
const VIEWER_EMAIL = "test-system-submit-viewer@example.com";
const RISK_OWNER_EMAIL = "test-system-submit-risk-owner@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/submit`;
}

function requestAs(id: string, userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { method: "POST", headers });
}

function requestWith(url: string, method: string, userId: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/systems/[id]/submit", () => {
  let ownerId: string;
  let viewerId: string;
  let riskOwnerId: string;
  let systemTypeId: string;
  let systemId: string;
  let mandatoryControlId: string;
  let optionalControlId: string;
  let organizationalControlId: string;
  let organizationalFrameworkId: string;
  let capabilityId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "System Submit Owner", role: "SYSTEM_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "System Submit Viewer", role: "VIEWER" },
    });
    const riskOwner = await prisma.user.upsert({
      where: { email: RISK_OWNER_EMAIL },
      update: {},
      create: { email: RISK_OWNER_EMAIL, name: "System Submit Risk Owner", role: "RISK_OWNER" },
    });
    ownerId = owner.id;
    viewerId = viewer.id;
    riskOwnerId = riskOwner.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Submit Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const suffix = Date.now();
    const mandatory = await prisma.control.create({
      data: {
        code: `SUBMIT-MAND-${suffix}`,
        title: "Mandatory Gate Control",
        description: "Must be addressed before submission",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: true,
      },
    });
    const optional = await prisma.control.create({
      data: {
        code: `SUBMIT-OPT-${suffix}`,
        title: "Optional Control",
        description: "Never blocks submission",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: false,
      },
    });
    const organizational = await prisma.control.create({
      data: {
        code: `SUBMIT-ORG-${suffix}`,
        title: "Organizational Control",
        description: "Never blocks submission, even though mandatory",
        category: "Security",
        applicability: "ORGANIZATIONAL",
        mandatory: true,
      },
    });
    mandatoryControlId = mandatory.id;
    optionalControlId = optional.id;
    organizationalControlId = organizational.id;
    await mapControlsToBase([mandatoryControlId, optionalControlId]);
    // The Organizational Control goes to a fixture Framework this System declares, not to the base: it counts
    // on every System with its Framework in scope (#122).
    const organizationalFramework = await createFixtureFramework("Submit Org");
    organizationalFrameworkId = organizationalFramework.id;
    await mapControlsToFramework(organizationalFramework.id, [organizationalControlId]);

    const capability = await prisma.capability.create({
      data: { name: `Submit Test Capability ${suffix}`, controls: { connect: [{ id: mandatory.id }] } },
    });
    capabilityId = capability.id;

    const system = await prisma.system.create({
      data: {
        name: "Submit Test System",
        deploymentFacets: { connect: [{ id: systemTypeId }] },
        frameworkScopes: { connect: { id: organizationalFrameworkId } },
        ownerId,
        status: "DRAFT",
      },
    });
    systemId = system.id;
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
    await prisma.control.deleteMany({
      where: { id: { in: [mandatoryControlId, optionalControlId, organizationalControlId] } },
    });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, VIEWER_EMAIL, RISK_OWNER_EMAIL] } } });
  });

  afterEach(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.update({
      where: { id: systemId },
      data: { status: "DRAFT", capabilities: { disconnect: { id: capabilityId } } },
    }).catch(() => {});
  });

  it("rejects an unauthenticated request", async () => {
    const response = await POST(requestAs(systemId, null), ctxFor(systemId));
    expect(response.status).toBe(401);
  });

  it("returns 404 for a System the acting user cannot see", async () => {
    const response = await POST(requestAs(systemId, viewerId), ctxFor(systemId));
    expect(response.status).toBe(404);
  });

  it("rejects submission when a mandatory Control is unaddressed, naming it", async () => {
    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("SUBMIT-MAND");
  });

  it("does not require the optional Control to be addressed", async () => {
    await fulfillAllMandatoryControls(systemId, [systemTypeId]);

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    expect(response.status).toBe(200);
  });

  it("does not count a mandatory Control stuck at NOT_STARTED as addressed", async () => {
    await prisma.controlAssessment.create({
      data: { systemId, controlId: mandatoryControlId, status: "NOT_STARTED" },
    });

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("SUBMIT-MAND");
  });

  it("succeeds and moves the System to IN_REVIEW once every mandatory Control is addressed", async () => {
    await fulfillAllMandatoryControls(systemId, [systemTypeId]);

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.status).toBe("IN_REVIEW");

    const event = await prisma.changeEvent.findFirst({
      where: { systemId, action: "SYSTEM_SUBMITTED" },
      orderBy: { createdAt: "desc" },
    });
    expect(event?.actorId).toBe(ownerId);
  });

  it("rejects submitting a System that isn't Draft", async () => {
    await fulfillAllMandatoryControls(systemId, [systemTypeId]);
    await prisma.system.update({ where: { id: systemId }, data: { status: "IN_REVIEW" } });

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    expect(response.status).toBe(400);
  });

  it("counts a Waived mandatory Control (with justification) as addressed", async () => {
    const waiveResponse = await patchAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${mandatoryControlId}`,
        "PATCH",
        riskOwnerId,
        { status: "WAIVED", notes: "Accepted risk, documented in the Risk register" },
      ),
      { params: Promise.resolve({ id: systemId, controlId: mandatoryControlId }) },
    );
    expect(waiveResponse.status).toBe(200);

    await fulfillAllMandatoryControls(systemId, [systemTypeId]);

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    expect(response.status).toBe(200);
  });

  it("counts a mandatory Control auto-fulfilled via a declared Capability as addressed", async () => {
    const declareResponse = await declareCapability(
      requestWith(`http://localhost/api/systems/${systemId}/capabilities`, "POST", ownerId, {
        capabilityId,
      }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(declareResponse.status).toBe(201);

    const autoFulfilled = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: mandatoryControlId } },
    });
    expect(autoFulfilled).toMatchObject({ status: "FULFILLED", fulfilledByCapabilityId: capabilityId });

    const autoFulfillEvent = await prisma.changeEvent.findFirst({
      where: { systemId, action: "ASSESSMENT_STATUS_CHANGED", actorId: "system" },
      orderBy: { createdAt: "desc" },
    });
    expect(autoFulfillEvent?.detail).toContain("auto-fulfilled");

    await fulfillAllMandatoryControls(systemId, [systemTypeId]);

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    expect(response.status).toBe(200);
    // afterEach disconnects the Capability directly, so cleanup doesn't
    // depend on the route.
  });
});

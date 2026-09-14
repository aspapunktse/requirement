import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const OWNER_EMAIL = "test-assessment-patch-owner@example.com";
const RISK_OWNER_EMAIL = "test-assessment-patch-risk-owner@example.com";
const VIEWER_EMAIL = "test-assessment-patch-viewer@example.com";

function urlFor(systemId: string, requirementId: string) {
  return `http://localhost/api/systems/${systemId}/assessments/${requirementId}`;
}

function requestAs(
  systemId: string,
  requirementId: string,
  userId: string | null,
  body?: unknown,
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(systemId, requirementId), {
    method: "PATCH",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(systemId: string, requirementId: string) {
  return { params: Promise.resolve({ id: systemId, requirementId }) };
}

describe("PATCH /api/systems/[id]/assessments/[requirementId]", () => {
  let ownerId: string;
  let riskOwnerId: string;
  let viewerId: string;
  let systemTypeId: string;
  let otherTypeId: string;
  let systemId: string;
  let mandatoryRequirementId: string;
  let optionalRequirementId: string;
  let outOfScopeRequirementId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Assessment Patch Owner", role: "SYSTEM_OWNER" },
    });
    const riskOwner = await prisma.user.upsert({
      where: { email: RISK_OWNER_EMAIL },
      update: {},
      create: { email: RISK_OWNER_EMAIL, name: "Assessment Patch Risk Owner", role: "RISK_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Assessment Patch Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    riskOwnerId = riskOwner.id;
    viewerId = viewer.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Assessment Patch Type ${Date.now()}` },
    });
    const otherType = await prisma.deploymentFacet.create({
      data: { name: `Test Assessment Patch Other Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const system = await prisma.system.create({
      data: { name: "Assessment Patch System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    systemId = system.id;

    const suffix = Date.now();
    const mandatory = await prisma.requirement.create({
      data: {
        code: `MAND-${suffix}`,
        title: "Mandatory Requirement",
        description: "Must be justified to waive",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: true,
      },
    });
    const optional = await prisma.requirement.create({
      data: {
        code: `OPT-${suffix}`,
        title: "Optional Requirement",
        description: "No justification required",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: false,
      },
    });
    const outOfScope = await prisma.requirement.create({
      data: {
        code: `OOS-${suffix}`,
        title: "Out of Scope Requirement",
        description: "Scoped to a different Type",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: otherType.id }] },
      },
    });
    mandatoryRequirementId = mandatory.id;
    optionalRequirementId = optional.id;
    outOfScopeRequirementId = outOfScope.id;
    otherTypeId = otherType.id;
  });

  afterAll(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({
      where: { id: { in: [mandatoryRequirementId, optionalRequirementId, outOfScopeRequirementId] } },
    });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [systemTypeId, otherTypeId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, RISK_OWNER_EMAIL, VIEWER_EMAIL] } } });
  });

  afterEach(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, null, { status: "IN_PROGRESS" }),
      ctxFor(systemId, optionalRequirementId),
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 for a System the acting user cannot see", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, viewerId, { status: "IN_PROGRESS" }),
      ctxFor(systemId, optionalRequirementId),
    );
    expect(response.status).toBe(404);
  });

  it("returns 404 for a Requirement not applicable to this System", async () => {
    const response = await PATCH(
      requestAs(systemId, outOfScopeRequirementId, ownerId, { status: "IN_PROGRESS" }),
      ctxFor(systemId, outOfScopeRequirementId),
    );
    expect(response.status).toBe(404);
  });

  it("lets any user with access set Fulfilled / In Progress / Not Started", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, ownerId, {
        status: "FULFILLED",
        evidence: "https://example.com/proof",
      }),
      ctxFor(systemId, optionalRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment).toMatchObject({ status: "FULFILLED", evidence: "https://example.com/proof" });
  });

  it("forbids a SYSTEM_OWNER from setting Waived", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, ownerId, { status: "WAIVED", notes: "justification" }),
      ctxFor(systemId, optionalRequirementId),
    );
    expect(response.status).toBe(403);
  });

  it("forbids a SYSTEM_OWNER from waiving their own mandatory Requirement, even with a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, ownerId, {
        status: "WAIVED",
        notes: "I promise this is fine",
      }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    expect(response.status).toBe(403);
  });

  it("forbids a SYSTEM_OWNER from marking their own mandatory Requirement Not Applicable", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, ownerId, {
        status: "NOT_APPLICABLE",
        notes: "justification",
      }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a RISK_OWNER waiving a mandatory Requirement without a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, riskOwnerId, { status: "WAIVED" }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    expect(response.status).toBe(400);
  });

  it("lets a RISK_OWNER waive a mandatory Requirement with a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, riskOwnerId, {
        status: "WAIVED",
        notes: "Accepted risk per exec sign-off",
      }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment).toMatchObject({ status: "WAIVED", notes: "Accepted risk per exec sign-off" });
  });

  it("rejects a RISK_OWNER marking a mandatory Requirement Not Applicable without a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, riskOwnerId, { status: "NOT_APPLICABLE" }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    expect(response.status).toBe(400);
  });

  it("lets a RISK_OWNER mark a mandatory Requirement Not Applicable with a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, riskOwnerId, {
        status: "NOT_APPLICABLE",
        notes: "Legacy system, this control doesn't apply",
      }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment).toMatchObject({
      status: "NOT_APPLICABLE",
      notes: "Legacy system, this control doesn't apply",
    });
  });

  it("lets a RISK_OWNER mark a non-mandatory Requirement Not Applicable without a note", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, riskOwnerId, { status: "NOT_APPLICABLE" }),
      ctxFor(systemId, optionalRequirementId),
    );
    expect(response.status).toBe(200);
  });

  it("lets a stale (no-longer-applicable) Requirement's existing Assessment still be edited/resolved", async () => {
    await prisma.requirementAssessment.create({
      data: { systemId, requirementId: outOfScopeRequirementId, status: "IN_PROGRESS" },
    });

    const response = await PATCH(
      requestAs(systemId, outOfScopeRequirementId, ownerId, { status: "FULFILLED" }),
      ctxFor(systemId, outOfScopeRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment.status).toBe("FULFILLED");
  });
});

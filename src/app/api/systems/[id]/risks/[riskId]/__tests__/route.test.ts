import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const OWNER_EMAIL = "test-risk-patch-owner@example.com";
const RISK_OWNER_EMAIL = "test-risk-patch-risk-owner@example.com";

function urlFor(systemId: string, riskId: string) {
  return `http://localhost/api/systems/${systemId}/risks/${riskId}`;
}

function requestAs(systemId: string, riskId: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(systemId, riskId), {
    method: "PATCH",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(systemId: string, riskId: string) {
  return { params: Promise.resolve({ id: systemId, riskId }) };
}

describe("PATCH /api/systems/[id]/risks/[riskId]", () => {
  let ownerId: string;
  let riskOwnerId: string;
  let systemTypeId: string;
  let systemId: string;
  let riskId: string;
  let requirementId: string;
  let assessmentId: string;
  let originatedRiskId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Risk Patch Owner", role: "SYSTEM_OWNER" },
    });
    const riskOwner = await prisma.user.upsert({
      where: { email: RISK_OWNER_EMAIL },
      update: {},
      create: { email: RISK_OWNER_EMAIL, name: "Risk Patch Risk Owner", role: "RISK_OWNER" },
    });
    ownerId = owner.id;
    riskOwnerId = riskOwner.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Risk Patch Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const system = await prisma.system.create({
      data: { name: "Risk Patch System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    systemId = system.id;

    const requirement = await prisma.requirement.create({
      data: {
        code: `RISK-PATCH-${Date.now()}`,
        title: "Origin Requirement",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    requirementId = requirement.id;

    const assessment = await prisma.requirementAssessment.create({
      data: { systemId, requirementId, status: "IN_PROGRESS", selfAssessmentAnswer: "NO" },
    });
    assessmentId = assessment.id;

    const originatedRisk = await prisma.risk.create({
      data: {
        systemId,
        title: "Auto Risk",
        description: "auto",
        severity: "MEDIUM",
        likelihood: "MEDIUM",
        requirementAssessmentId: assessmentId,
      },
    });
    originatedRiskId = originatedRisk.id;
  });

  beforeEach(async () => {
    const risk = await prisma.risk.create({
      data: { systemId, title: "Ad-hoc Risk", description: "desc", severity: "HIGH", likelihood: "LOW" },
    });
    riskId = risk.id;
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { systemId } });
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({ where: { id: requirementId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, RISK_OWNER_EMAIL] } } });
  });

  afterEach(async () => {
    await prisma.risk.deleteMany({ where: { id: riskId } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await PATCH(requestAs(systemId, riskId, null, { status: "CLOSED" }), ctxFor(systemId, riskId));
    expect(response.status).toBe(401);
  });

  it("forbids a SYSTEM_OWNER from changing status, even for a Risk they logged", async () => {
    const response = await PATCH(
      requestAs(systemId, riskId, ownerId, { status: "CLOSED" }),
      ctxFor(systemId, riskId),
    );
    expect(response.status).toBe(403);
  });

  it("lets a RISK_OWNER change status", async () => {
    const response = await PATCH(
      requestAs(systemId, riskId, riskOwnerId, { status: "ACCEPTED" }),
      ctxFor(systemId, riskId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.risk.status).toBe("ACCEPTED");
  });

  it("rejects setting Mitigated without a mitigation plan", async () => {
    const response = await PATCH(
      requestAs(systemId, riskId, riskOwnerId, { status: "MITIGATED" }),
      ctxFor(systemId, riskId),
    );
    expect(response.status).toBe(400);
  });

  it("accepts setting Mitigated with a mitigation plan", async () => {
    const response = await PATCH(
      requestAs(systemId, riskId, riskOwnerId, { status: "MITIGATED", mitigationPlan: "Patch it" }),
      ctxFor(systemId, riskId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.risk).toMatchObject({ status: "MITIGATED", mitigationPlan: "Patch it" });
  });

  it("returns 404 for a Risk that doesn't belong to this System", async () => {
    const otherSystemType = await prisma.deploymentFacet.create({ data: { name: `Other ${Date.now()}` } });
    const otherSystem = await prisma.system.create({
      data: { name: "Other System", deploymentFacets: { connect: [{ id: otherSystemType.id }] }, ownerId, status: "DRAFT" },
    });

    const response = await PATCH(
      requestAs(otherSystem.id, riskId, riskOwnerId, { status: "CLOSED" }),
      ctxFor(otherSystem.id, riskId),
    );
    expect(response.status).toBe(404);

    await prisma.system.delete({ where: { id: otherSystem.id } });
    await prisma.deploymentFacet.delete({ where: { id: otherSystemType.id } });
  });

  it("an auto-created Risk shows its originating Requirement Assessment", async () => {
    const risk = await prisma.risk.findUnique({
      where: { id: originatedRiskId },
      include: { requirementAssessment: { include: { requirement: true } } },
    });
    expect(risk?.requirementAssessment?.requirement.id).toBe(requirementId);
  });
});

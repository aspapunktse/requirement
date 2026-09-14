import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const OWNER_EMAIL = "test-answer-owner@example.com";
const RISK_OWNER_EMAIL = "test-answer-risk-owner@example.com";
const VIEWER_EMAIL = "test-answer-viewer@example.com";

function urlFor(systemId: string, requirementId: string) {
  return `http://localhost/api/systems/${systemId}/assessments/${requirementId}/answer`;
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

describe("PATCH /api/systems/[id]/assessments/[requirementId]/answer", () => {
  let ownerId: string;
  let riskOwnerId: string;
  let viewerId: string;
  let systemTypeId: string;
  let systemId: string;
  let mandatoryRequirementId: string;
  let optionalRequirementId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Answer Owner", role: "SYSTEM_OWNER" },
    });
    const riskOwner = await prisma.user.upsert({
      where: { email: RISK_OWNER_EMAIL },
      update: {},
      create: { email: RISK_OWNER_EMAIL, name: "Answer Risk Owner", role: "RISK_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Answer Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    riskOwnerId = riskOwner.id;
    viewerId = viewer.id;

    const systemType = await prisma.systemType.create({
      data: { name: `Test Answer Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const system = await prisma.system.create({
      data: { name: "Answer Test System", systemTypeId, ownerId, status: "DRAFT" },
    });
    systemId = system.id;

    const suffix = Date.now();
    const mandatory = await prisma.requirement.create({
      data: {
        code: `ANSWER-MAND-${suffix}`,
        title: "Mandatory Answerable Requirement",
        description: "Has a self-assessment question",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: true,
        question: "Do you do the thing?",
      },
    });
    const optional = await prisma.requirement.create({
      data: {
        code: `ANSWER-OPT-${suffix}`,
        title: "Optional Answerable Requirement",
        description: "Has a self-assessment question",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: false,
        question: "Do you do the optional thing?",
      },
    });
    mandatoryRequirementId = mandatory.id;
    optionalRequirementId = optional.id;
  });

  afterAll(async () => {
    await prisma.risk.deleteMany({ where: { systemId } });
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({
      where: { id: { in: [mandatoryRequirementId, optionalRequirementId] } },
    });
    await prisma.systemType.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({
      where: { email: { in: [OWNER_EMAIL, RISK_OWNER_EMAIL, VIEWER_EMAIL] } },
    });
  });

  afterEach(async () => {
    await prisma.risk.deleteMany({ where: { systemId } });
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, null, { answer: "YES" }),
      ctxFor(systemId, optionalRequirementId),
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 for a System the acting user cannot see", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, viewerId, { answer: "YES" }),
      ctxFor(systemId, optionalRequirementId),
    );
    expect(response.status).toBe(404);
  });

  it("answering Yes sets the Assessment to Fulfilled and records the answer", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, ownerId, { answer: "YES" }),
      ctxFor(systemId, optionalRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment).toMatchObject({ status: "FULFILLED", selfAssessmentAnswer: "YES" });
  });

  it("answering No leaves the Assessment open (not Fulfilled), records the answer, and auto-opens a linked Risk", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, ownerId, { answer: "NO" }),
      ctxFor(systemId, optionalRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment.status).not.toBe("FULFILLED");
    expect(body.assessment.selfAssessmentAnswer).toBe("NO");

    const risks = await prisma.risk.findMany({
      where: { requirementAssessmentId: body.assessment.id },
    });
    expect(risks).toHaveLength(1);
    expect(risks[0].systemId).toBe(systemId);
  });

  it("does not open a second Risk when No is answered again for the same Assessment", async () => {
    const first = await PATCH(
      requestAs(systemId, optionalRequirementId, ownerId, { answer: "NO" }),
      ctxFor(systemId, optionalRequirementId),
    );
    const firstBody = await first.json();

    await PATCH(
      requestAs(systemId, optionalRequirementId, ownerId, { answer: "NO", notes: "still no" }),
      ctxFor(systemId, optionalRequirementId),
    );

    const risks = await prisma.risk.findMany({
      where: { requirementAssessmentId: firstBody.assessment.id },
    });
    expect(risks).toHaveLength(1);
  });

  it("forbids a SYSTEM_OWNER from answering N/A", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalRequirementId, ownerId, { answer: "NA" }),
      ctxFor(systemId, optionalRequirementId),
    );
    expect(response.status).toBe(403);
  });

  it("forbids a SYSTEM_OWNER from answering N/A on their own mandatory Requirement, even with a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, ownerId, {
        answer: "NA",
        notes: "I promise this is fine",
      }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a RISK_OWNER answering N/A on a mandatory Requirement without a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, riskOwnerId, { answer: "NA" }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    expect(response.status).toBe(400);
  });

  it("lets a RISK_OWNER answer N/A on a mandatory Requirement with a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryRequirementId, riskOwnerId, {
        answer: "NA",
        notes: "Legacy system, this control doesn't apply",
      }),
      ctxFor(systemId, mandatoryRequirementId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment).toMatchObject({ status: "NOT_APPLICABLE", selfAssessmentAnswer: "NA" });
  });

  it("returns 404 for a Requirement not applicable to this System", async () => {
    const otherType = await prisma.systemType.create({
      data: { name: `Test Answer Other Type ${Date.now()}` },
    });
    const scoped = await prisma.requirement.create({
      data: {
        code: `ANSWER-OOS-${Date.now()}`,
        title: "Out of scope",
        description: "Scoped elsewhere",
        category: "Security",
        applicability: "PER_SYSTEM",
        systemTypes: { connect: [{ id: otherType.id }] },
      },
    });

    const response = await PATCH(
      requestAs(systemId, scoped.id, ownerId, { answer: "YES" }),
      ctxFor(systemId, scoped.id),
    );
    expect(response.status).toBe(404);

    await prisma.requirement.delete({ where: { id: scoped.id } });
    await prisma.systemType.delete({ where: { id: otherType.id } });
  });
});

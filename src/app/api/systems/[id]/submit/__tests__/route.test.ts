import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getUnaddressedMandatoryRequirements } from "@/lib/requirement-assessments";
import { POST } from "../route";

/**
 * The seeded ISO 27001 catalog ships several mandatory Requirements with no
 * System Type scoping, so they apply to every Type — including the one
 * created for this test. Satisfy all of them, not just the test's own
 * custom Requirement, so submission is only gated by what this test means
 * to gate it by.
 */
async function fulfillAllMandatoryRequirements(systemId: string, systemTypeId: string) {
  const unaddressed = await getUnaddressedMandatoryRequirements({ id: systemId, systemTypeId });
  await prisma.requirementAssessment.createMany({
    data: unaddressed.map((requirement) => ({
      systemId,
      requirementId: requirement.id,
      status: "FULFILLED" as const,
    })),
    skipDuplicates: true,
  });
}

const OWNER_EMAIL = "test-system-submit-owner@example.com";
const VIEWER_EMAIL = "test-system-submit-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/submit`;
}

function requestAs(id: string, userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { method: "POST", headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/systems/[id]/submit", () => {
  let ownerId: string;
  let viewerId: string;
  let systemTypeId: string;
  let systemId: string;
  let mandatoryRequirementId: string;
  let optionalRequirementId: string;
  let organizationalRequirementId: string;

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
    ownerId = owner.id;
    viewerId = viewer.id;

    const systemType = await prisma.systemType.create({
      data: { name: `Test Submit Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const suffix = Date.now();
    const mandatory = await prisma.requirement.create({
      data: {
        code: `SUBMIT-MAND-${suffix}`,
        title: "Mandatory Gate Requirement",
        description: "Must be addressed before submission",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: true,
      },
    });
    const optional = await prisma.requirement.create({
      data: {
        code: `SUBMIT-OPT-${suffix}`,
        title: "Optional Requirement",
        description: "Never blocks submission",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: false,
      },
    });
    const organizational = await prisma.requirement.create({
      data: {
        code: `SUBMIT-ORG-${suffix}`,
        title: "Organizational Requirement",
        description: "Never blocks submission, even though mandatory",
        category: "Security",
        applicability: "ORGANIZATIONAL",
        mandatory: true,
      },
    });
    mandatoryRequirementId = mandatory.id;
    optionalRequirementId = optional.id;
    organizationalRequirementId = organizational.id;

    const system = await prisma.system.create({
      data: { name: "Submit Test System", systemTypeId, ownerId, status: "DRAFT" },
    });
    systemId = system.id;
  });

  afterAll(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({
      where: { id: { in: [mandatoryRequirementId, optionalRequirementId, organizationalRequirementId] } },
    });
    await prisma.systemType.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, VIEWER_EMAIL] } } });
  });

  afterEach(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.update({ where: { id: systemId }, data: { status: "DRAFT" } }).catch(() => {});
  });

  it("rejects an unauthenticated request", async () => {
    const response = await POST(requestAs(systemId, null), ctxFor(systemId));
    expect(response.status).toBe(401);
  });

  it("returns 404 for a System the acting user cannot see", async () => {
    const response = await POST(requestAs(systemId, viewerId), ctxFor(systemId));
    expect(response.status).toBe(404);
  });

  it("rejects submission when a mandatory Requirement is unaddressed, naming it", async () => {
    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("SUBMIT-MAND");
  });

  it("does not require the optional Requirement to be addressed", async () => {
    await fulfillAllMandatoryRequirements(systemId, systemTypeId);

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    expect(response.status).toBe(200);
  });

  it("does not count a mandatory Requirement stuck at NOT_STARTED as addressed", async () => {
    await prisma.requirementAssessment.create({
      data: { systemId, requirementId: mandatoryRequirementId, status: "NOT_STARTED" },
    });

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain("SUBMIT-MAND");
  });

  it("succeeds and moves the System to IN_REVIEW once every mandatory Requirement is addressed", async () => {
    await fulfillAllMandatoryRequirements(systemId, systemTypeId);

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.status).toBe("IN_REVIEW");
  });

  it("rejects submitting a System that isn't Draft", async () => {
    await fulfillAllMandatoryRequirements(systemId, systemTypeId);
    await prisma.system.update({ where: { id: systemId }, data: { status: "IN_REVIEW" } });

    const response = await POST(requestAs(systemId, ownerId), ctxFor(systemId));
    expect(response.status).toBe(400);
  });
});

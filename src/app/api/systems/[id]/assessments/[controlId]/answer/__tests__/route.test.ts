import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase, cleanupFixtureRequirements, deleteFixtureRequirement } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const OWNER_EMAIL = "test-answer-owner@example.com";
const RISK_OWNER_EMAIL = "test-answer-risk-owner@example.com";
const VIEWER_EMAIL = "test-answer-viewer@example.com";
const OTHER_RISK_OWNER_EMAIL = "test-answer-other-risk-owner@example.com";
const ADMIN_EMAIL = "test-answer-admin@example.com";

function urlFor(systemId: string, controlId: string) {
  return `http://localhost/api/systems/${systemId}/assessments/${controlId}/answer`;
}

function requestAs(
  systemId: string,
  controlId: string,
  userId: string | null,
  body?: unknown,
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(systemId, controlId), {
    method: "PATCH",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(systemId: string, controlId: string) {
  return { params: Promise.resolve({ id: systemId, controlId }) };
}

describe("PATCH /api/systems/[id]/assessments/[controlId]/answer", () => {
  let ownerId: string;
  let riskOwnerId: string;
  let viewerId: string;
  let otherRiskOwnerId: string;
  let adminId: string;
  // A System the Risk Owner owns, and one the Admin owns (#97).
  let riskOwnedSystemId: string;
  let adminOwnedSystemId: string;
  let systemTypeId: string;
  let systemId: string;
  let mandatoryControlId: string;
  let optionalControlId: string;

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
    const otherRiskOwner = await prisma.user.upsert({
      where: { email: OTHER_RISK_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_RISK_OWNER_EMAIL, name: "Answer Other Risk Owner", role: "RISK_OWNER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Answer Admin", role: "ADMIN" },
    });
    otherRiskOwnerId = otherRiskOwner.id;
    adminId = admin.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Answer Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const system = await prisma.system.create({
      data: { name: "Answer Test System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    systemId = system.id;
    const riskOwned = await prisma.system.create({
      data: {
        name: "Answer Risk-Owned System",
        deploymentFacets: { connect: [{ id: systemTypeId }] },
        ownerId: riskOwnerId,
        status: "DRAFT",
      },
    });
    const adminOwned = await prisma.system.create({
      data: {
        name: "Answer Admin-Owned System",
        deploymentFacets: { connect: [{ id: systemTypeId }] },
        ownerId: adminId,
        status: "DRAFT",
      },
    });
    riskOwnedSystemId = riskOwned.id;
    adminOwnedSystemId = adminOwned.id;

    const suffix = Date.now();
    const mandatory = await prisma.control.create({
      data: {
        code: `ANSWER-MAND-${suffix}`,
        title: "Mandatory Answerable Control",
        description: "Has a self-assessment question",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: systemTypeId }] }, // scoped, so it doesn't apply to other files' Systems (#231)
        mandatory: true,
        question: "Do you do the thing?",
      },
    });
    const optional = await prisma.control.create({
      data: {
        code: `ANSWER-OPT-${suffix}`,
        title: "Optional Answerable Control",
        description: "Has a self-assessment question",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: systemTypeId }] }, // scoped, so it doesn't apply to other files' Systems (#231)
        mandatory: false,
        question: "Do you do the optional thing?",
      },
    });
    mandatoryControlId = mandatory.id;
    optionalControlId = optional.id;
    await mapControlsToBase([mandatoryControlId, optionalControlId]);
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    const systemIds = [systemId, riskOwnedSystemId, adminOwnedSystemId];
    await prisma.risk.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({
      where: { id: { in: [mandatoryControlId, optionalControlId] } },
    });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({
      where: { email: { in: [OWNER_EMAIL, RISK_OWNER_EMAIL, VIEWER_EMAIL, OTHER_RISK_OWNER_EMAIL, ADMIN_EMAIL] } },
    });
  });

  afterEach(async () => {
    const systemIds = [systemId, riskOwnedSystemId, adminOwnedSystemId];
    await prisma.risk.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalControlId, null, { answer: "YES" }),
      ctxFor(systemId, optionalControlId),
    );
    expect(response.status).toBe(401);
  });

  it("returns 404 for a System the acting user cannot see", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalControlId, viewerId, { answer: "YES" }),
      ctxFor(systemId, optionalControlId),
    );
    expect(response.status).toBe(404);
  });

  it("answering Yes sets the Assessment to Fulfilled and records the answer", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalControlId, ownerId, { answer: "YES" }),
      ctxFor(systemId, optionalControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment).toMatchObject({ status: "FULFILLED", selfAssessmentAnswer: "YES" });
  });

  it("answering No leaves the Assessment open (not Fulfilled), records the answer, and auto-opens a linked Risk", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalControlId, ownerId, { answer: "NO" }),
      ctxFor(systemId, optionalControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment.status).not.toBe("FULFILLED");
    expect(body.assessment.selfAssessmentAnswer).toBe("NO");

    const risks = await prisma.risk.findMany({
      where: { controlAssessmentId: body.assessment.id },
    });
    expect(risks).toHaveLength(1);
    expect(risks[0].systemId).toBe(systemId);
  });

  it("records the auto-opened Risk as one RISK_LOGGED event by the system, instead of a RISK_STATUS_CHANGED one (#245)", async () => {
    await PATCH(requestAs(systemId, optionalControlId, ownerId, { answer: "NO" }), ctxFor(systemId, optionalControlId));
    await PATCH(requestAs(systemId, optionalControlId, ownerId, { answer: "NO", notes: "again" }), ctxFor(systemId, optionalControlId));

    const logged = await prisma.changeEvent.findMany({ where: { systemId, action: "RISK_LOGGED" } });
    expect(logged).toHaveLength(1);
    expect(logged[0].actorId).toBe("system");
    expect(logged[0].detail).toContain('"No" Self-Assessment answer');
    expect(logged[0].detail).toContain("severity: Medium");
    expect(await prisma.changeEvent.count({ where: { systemId, action: "RISK_STATUS_CHANGED" } })).toBe(0);
  });

  it("opens no Risk and writes no RISK_LOGGED event for a Yes answer or a refused No", async () => {
    await PATCH(requestAs(systemId, optionalControlId, ownerId, { answer: "YES" }), ctxFor(systemId, optionalControlId));
    const refused = await PATCH(requestAs(systemId, optionalControlId, null, { answer: "NO" }), ctxFor(systemId, optionalControlId));

    expect(refused.status).toBe(401);
    expect(await prisma.risk.count({ where: { systemId } })).toBe(0);
    expect(await prisma.changeEvent.count({ where: { systemId, action: "RISK_LOGGED" } })).toBe(0);
  });

  it("does not open a second Risk when No is answered again for the same Assessment", async () => {
    const first = await PATCH(
      requestAs(systemId, optionalControlId, ownerId, { answer: "NO" }),
      ctxFor(systemId, optionalControlId),
    );
    const firstBody = await first.json();

    await PATCH(
      requestAs(systemId, optionalControlId, ownerId, { answer: "NO", notes: "still no" }),
      ctxFor(systemId, optionalControlId),
    );

    const risks = await prisma.risk.findMany({
      where: { controlAssessmentId: firstBody.assessment.id },
    });
    expect(risks).toHaveLength(1);
  });

  it("forbids a SYSTEM_OWNER from answering N/A", async () => {
    const response = await PATCH(
      requestAs(systemId, optionalControlId, ownerId, { answer: "NA" }),
      ctxFor(systemId, optionalControlId),
    );
    expect(response.status).toBe(403);
  });

  it("forbids a SYSTEM_OWNER from answering N/A on their own mandatory Control, even with a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryControlId, ownerId, {
        answer: "NA",
        notes: "I promise this is fine",
      }),
      ctxFor(systemId, mandatoryControlId),
    );
    expect(response.status).toBe(403);
  });

  it("rejects a RISK_OWNER answering N/A on a mandatory Control without a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryControlId, riskOwnerId, { answer: "NA" }),
      ctxFor(systemId, mandatoryControlId),
    );
    expect(response.status).toBe(400);
  });

  it("lets a RISK_OWNER answer N/A on a mandatory Control with a justification note", async () => {
    const response = await PATCH(
      requestAs(systemId, mandatoryControlId, riskOwnerId, {
        answer: "NA",
        notes: "Legacy system, this control doesn't apply",
      }),
      ctxFor(systemId, mandatoryControlId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.assessment).toMatchObject({ status: "NOT_APPLICABLE", selfAssessmentAnswer: "NA" });
  });

  it("returns 404 for a Control not applicable to this System", async () => {
    const otherType = await prisma.deploymentFacet.create({
      data: { name: `Test Answer Other Type ${Date.now()}` },
    });
    const scoped = await prisma.control.create({
      data: {
        code: `ANSWER-OOS-${Date.now()}`,
        title: "Out of scope",
        description: "Scoped elsewhere",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: otherType.id }] },
      },
    });

    const scopedRequirementId = await mapControlsToBase([scoped.id]); // so it's the Deployment Facet scoping that makes it inapplicable
    const response = await PATCH(
      requestAs(systemId, scoped.id, ownerId, { answer: "YES" }),
      ctxFor(systemId, scoped.id),
    );
    expect(response.status).toBe(404);

    await deleteFixtureRequirement(scopedRequirementId); // before its Control, or it is left unmapped (#231)
    await prisma.control.delete({ where: { id: scoped.id } });
    await prisma.deploymentFacet.delete({ where: { id: otherType.id } });
  });

  describe("a Risk Owner who owns the System can't answer N/A on its mandatory Controls (#97)", () => {
    it("refuses the owning RISK_OWNER an N/A answer on a mandatory Control with 403, even with a note, changing nothing", async () => {
      const response = await PATCH(
        requestAs(riskOwnedSystemId, mandatoryControlId, riskOwnerId, { answer: "NA", notes: "Because I say so" }),
        ctxFor(riskOwnedSystemId, mandatoryControlId),
      );
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toMatch(/You own this System, so another Risk Owner or an Admin must waive/);
      expect(await prisma.controlAssessment.count({ where: { systemId: riskOwnedSystemId } })).toBe(0);
      expect(await prisma.changeEvent.count({ where: { systemId: riskOwnedSystemId } })).toBe(0);
    });

    it("still lets the owning RISK_OWNER answer N/A on a non-mandatory Control", async () => {
      const response = await PATCH(
        requestAs(riskOwnedSystemId, optionalControlId, riskOwnerId, { answer: "NA" }),
        ctxFor(riskOwnedSystemId, optionalControlId),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.assessment).toMatchObject({ status: "NOT_APPLICABLE", selfAssessmentAnswer: "NA" });
    });

    it.each([
      ["YES", "FULFILLED"],
      ["NO", "IN_PROGRESS"],
    ] as const)("still lets the owning RISK_OWNER answer %s on a mandatory Control", async (answer, status) => {
      const response = await PATCH(
        requestAs(riskOwnedSystemId, mandatoryControlId, riskOwnerId, { answer }),
        ctxFor(riskOwnedSystemId, mandatoryControlId),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.assessment).toMatchObject({ status, selfAssessmentAnswer: answer });
    });

    it("lets a different RISK_OWNER answer N/A on the mandatory Control of that System", async () => {
      const response = await PATCH(
        requestAs(riskOwnedSystemId, mandatoryControlId, otherRiskOwnerId, { answer: "NA", notes: "Not relevant here" }),
        ctxFor(riskOwnedSystemId, mandatoryControlId),
      );
      expect(response.status).toBe(200);
    });

    it("lets an ADMIN who owns the System answer N/A on its mandatory Control", async () => {
      const response = await PATCH(
        requestAs(adminOwnedSystemId, mandatoryControlId, adminId, { answer: "NA", notes: "Own exception" }),
        ctxFor(adminOwnedSystemId, mandatoryControlId),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.assessment.status).toBe("NOT_APPLICABLE");
    });
  });
});

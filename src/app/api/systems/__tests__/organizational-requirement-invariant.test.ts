import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH as changeSystemType } from "@/app/api/systems/[id]/route";
import { POST as declareCapability } from "@/app/api/systems/[id]/capabilities/route";
import { DELETE as undeclareCapability } from "@/app/api/systems/[id]/capabilities/[capabilityId]/route";
import { PATCH as patchAssessment } from "@/app/api/systems/[id]/assessments/[requirementId]/route";
import { PATCH as answerAssessment } from "@/app/api/systems/[id]/assessments/[requirementId]/answer/route";

// Invariant #18: an ORGANIZATIONAL-scoped Requirement is never assessed per
// System — no RequirementAssessment row is ever created for it, no matter
// which Assessment-generating path is exercised.

const ADMIN_EMAIL = "test-org-invariant-admin@example.com";

function requestWith(url: string, method: string, userId: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function assertNoAssessment(systemId: string, requirementId: string) {
  const assessment = await prisma.requirementAssessment.findUnique({
    where: { systemId_requirementId: { systemId, requirementId } },
  });
  expect(assessment).toBeNull();
}

describe("Invariant: an ORGANIZATIONAL Requirement never gets a RequirementAssessment", () => {
  let adminId: string;
  let typeAId: string;
  let typeBId: string;
  let capabilityId: string;
  let orgRequirementId: string;
  let systemId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Org Invariant Admin", role: "ADMIN" },
    });
    adminId = admin.id;

    const suffix = Date.now();
    const typeA = await prisma.systemType.create({ data: { name: `Org Invariant Type A ${suffix}` } });
    const typeB = await prisma.systemType.create({ data: { name: `Org Invariant Type B ${suffix}` } });
    typeAId = typeA.id;
    typeBId = typeB.id;

    const capability = await prisma.capability.create({ data: { name: `Org Invariant Capability ${suffix}` } });
    capabilityId = capability.id;

    // Deliberately mapped to a Capability and left unscoped to any System
    // Type, to make sure neither mapping makes it assessable — an
    // ORGANIZATIONAL Requirement is excluded by applicability alone.
    const orgRequirement = await prisma.requirement.create({
      data: {
        code: `ORG-INV-${suffix}`,
        title: "Organizational-only Requirement",
        description: "Satisfied centrally; never assessed per System.",
        category: "Security",
        applicability: "ORGANIZATIONAL",
        mandatory: true,
        capabilities: { connect: [{ id: capabilityId }] },
      },
    });
    orgRequirementId = orgRequirement.id;
  });

  afterAll(async () => {
    await prisma.requirement.deleteMany({ where: { id: orgRequirementId } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
    await prisma.systemType.deleteMany({ where: { id: { in: [typeAId, typeBId] } } });
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  });

  afterEach(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("stays unassessed across System creation, Type change, Capability declare/undeclare, and direct edit attempts", async () => {
    const system = await prisma.system.create({
      data: { name: "Org Invariant System", systemTypeId: typeAId, ownerId: adminId, status: "DRAFT" },
    });
    systemId = system.id;

    // 1. System creation never creates a row for it.
    await assertNoAssessment(systemId, orgRequirementId);

    // 2. Changing System Type (which recomputes the applicable set) never
    // creates one either.
    const typeChangeResponse = await changeSystemType(
      requestWith(`http://localhost/api/systems/${systemId}`, "PATCH", adminId, { systemTypeId: typeBId }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(typeChangeResponse.status).toBe(200);
    await assertNoAssessment(systemId, orgRequirementId);

    // 3. Declaring a Capability mapped to it never auto-fulfills it.
    const declareResponse = await declareCapability(
      requestWith(`http://localhost/api/systems/${systemId}/capabilities`, "POST", adminId, {
        capabilityId,
      }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(declareResponse.status).toBe(201);
    await assertNoAssessment(systemId, orgRequirementId);

    // 4. Undeclaring it again is a no-op with respect to this Requirement.
    const undeclareResponse = await undeclareCapability(
      requestWith(
        `http://localhost/api/systems/${systemId}/capabilities/${capabilityId}`,
        "DELETE",
        adminId,
      ),
      { params: Promise.resolve({ id: systemId, capabilityId }) },
    );
    expect(undeclareResponse.status).toBe(200);
    await assertNoAssessment(systemId, orgRequirementId);

    // 5. A direct manual Assessment edit is rejected outright (the
    // Requirement isn't "applicable", so it's treated as not found) rather
    // than creating a row.
    const patchResponse = await patchAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${orgRequirementId}`,
        "PATCH",
        adminId,
        { status: "FULFILLED" },
      ),
      { params: Promise.resolve({ id: systemId, requirementId: orgRequirementId }) },
    );
    expect(patchResponse.status).toBe(404);
    await assertNoAssessment(systemId, orgRequirementId);

    // 6. Answering its (nonexistent) Self-Assessment Question is rejected
    // the same way.
    const answerResponse = await answerAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${orgRequirementId}/answer`,
        "PATCH",
        adminId,
        { answer: "YES" },
      ),
      { params: Promise.resolve({ id: systemId, requirementId: orgRequirementId }) },
    );
    expect(answerResponse.status).toBe(404);
    await assertNoAssessment(systemId, orgRequirementId);
  });
});

import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH as changeSystemType } from "@/app/api/systems/[id]/route";
import { PATCH as patchAssessment } from "@/app/api/systems/[id]/assessments/[requirementId]/route";
import { PATCH as answerAssessment } from "@/app/api/systems/[id]/assessments/[requirementId]/answer/route";

// Invariant #19: a Requirement scoped to a subset of System Types never
// generates a RequirementAssessment for a System whose Type isn't in that
// subset — including after a System Type change that still leaves it out
// of scope.

const ADMIN_EMAIL = "test-scope-invariant-admin@example.com";

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

describe("Invariant: an out-of-scope Requirement never gets a RequirementAssessment", () => {
  let adminId: string;
  let scopedTypeId: string;
  let outOfScopeTypeAId: string;
  let outOfScopeTypeBId: string;
  let scopedRequirementId: string;
  let systemId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Scope Invariant Admin", role: "ADMIN" },
    });
    adminId = admin.id;

    const suffix = Date.now();
    const scopedType = await prisma.systemType.create({ data: { name: `Scope Invariant Scoped ${suffix}` } });
    const outOfScopeA = await prisma.systemType.create({ data: { name: `Scope Invariant Out A ${suffix}` } });
    const outOfScopeB = await prisma.systemType.create({ data: { name: `Scope Invariant Out B ${suffix}` } });
    scopedTypeId = scopedType.id;
    outOfScopeTypeAId = outOfScopeA.id;
    outOfScopeTypeBId = outOfScopeB.id;

    // Scoped to scopedType only — neither out-of-scope Type is in this set.
    const scopedRequirement = await prisma.requirement.create({
      data: {
        code: `SCOPE-INV-${suffix}`,
        title: "Scoped Requirement",
        description: "Only applies to one System Type.",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: true,
        systemTypes: { connect: [{ id: scopedTypeId }] },
      },
    });
    scopedRequirementId = scopedRequirement.id;
  });

  afterAll(async () => {
    await prisma.requirement.deleteMany({ where: { id: scopedRequirementId } });
    await prisma.systemType.deleteMany({
      where: { id: { in: [scopedTypeId, outOfScopeTypeAId, outOfScopeTypeBId] } },
    });
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  });

  afterEach(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("stays unassessed for a System outside its scope, across creation, Type change, and direct edit attempts", async () => {
    const system = await prisma.system.create({
      data: { name: "Scope Invariant System", systemTypeId: outOfScopeTypeAId, ownerId: adminId, status: "DRAFT" },
    });
    systemId = system.id;

    // 1. System creation with an out-of-scope Type never creates a row.
    await assertNoAssessment(systemId, scopedRequirementId);

    // 2. Changing to a *different* out-of-scope Type still doesn't.
    const typeChangeResponse = await changeSystemType(
      requestWith(`http://localhost/api/systems/${systemId}`, "PATCH", adminId, {
        systemTypeId: outOfScopeTypeBId,
      }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(typeChangeResponse.status).toBe(200);
    await assertNoAssessment(systemId, scopedRequirementId);

    // 3. A direct manual Assessment edit is rejected as not found, not
    // created, while the System remains out of scope.
    const patchResponse = await patchAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${scopedRequirementId}`,
        "PATCH",
        adminId,
        { status: "FULFILLED" },
      ),
      { params: Promise.resolve({ id: systemId, requirementId: scopedRequirementId }) },
    );
    expect(patchResponse.status).toBe(404);
    await assertNoAssessment(systemId, scopedRequirementId);

    // 4. Same for answering its Self-Assessment Question.
    const answerResponse = await answerAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${scopedRequirementId}/answer`,
        "PATCH",
        adminId,
        { answer: "YES" },
      ),
      { params: Promise.resolve({ id: systemId, requirementId: scopedRequirementId }) },
    );
    expect(answerResponse.status).toBe(404);
    await assertNoAssessment(systemId, scopedRequirementId);

    // 5. Changing *into* scope does create it, proving the absence above
    // was genuinely about scope and not some unrelated bug.
    const intoScopeResponse = await changeSystemType(
      requestWith(`http://localhost/api/systems/${systemId}`, "PATCH", adminId, {
        systemTypeId: scopedTypeId,
      }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(intoScopeResponse.status).toBe(200);
    const assessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: scopedRequirementId } },
    });
    expect(assessment).not.toBeNull();
  });
});

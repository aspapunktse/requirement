import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH as changeSystemType } from "@/app/api/systems/[id]/route";
import { PATCH as patchAssessment } from "@/app/api/systems/[id]/assessments/[controlId]/route";
import { PATCH as answerAssessment } from "@/app/api/systems/[id]/assessments/[controlId]/answer/route";

// Invariant #19: a Control scoped to a subset of System Types never
// generates a ControlAssessment for a System whose Type isn't in that
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

async function assertNoAssessment(systemId: string, controlId: string) {
  const assessment = await prisma.controlAssessment.findUnique({
    where: { systemId_controlId: { systemId, controlId } },
  });
  expect(assessment).toBeNull();
}

describe("Invariant: an out-of-scope Control never gets a ControlAssessment", () => {
  let adminId: string;
  let scopedTypeId: string;
  let outOfScopeTypeAId: string;
  let outOfScopeTypeBId: string;
  let scopedControlId: string;
  let systemId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Scope Invariant Admin", role: "ADMIN" },
    });
    adminId = admin.id;

    const suffix = Date.now();
    const scopedType = await prisma.deploymentFacet.create({ data: { name: `Scope Invariant Scoped ${suffix}` } });
    const outOfScopeA = await prisma.deploymentFacet.create({ data: { name: `Scope Invariant Out A ${suffix}` } });
    const outOfScopeB = await prisma.deploymentFacet.create({ data: { name: `Scope Invariant Out B ${suffix}` } });
    scopedTypeId = scopedType.id;
    outOfScopeTypeAId = outOfScopeA.id;
    outOfScopeTypeBId = outOfScopeB.id;

    // Scoped to scopedType only — neither out-of-scope Type is in this set.
    const scopedControl = await prisma.control.create({
      data: {
        code: `SCOPE-INV-${suffix}`,
        title: "Scoped Control",
        description: "Only applies to one System Type.",
        category: "Security",
        applicability: "PER_SYSTEM",
        mandatory: true,
        deploymentFacets: { connect: [{ id: scopedTypeId }] },
      },
    });
    scopedControlId = scopedControl.id;
    await mapControlsToBase([scopedControlId]);
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: scopedControlId } });
    await prisma.deploymentFacet.deleteMany({
      where: { id: { in: [scopedTypeId, outOfScopeTypeAId, outOfScopeTypeBId] } },
    });
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  });

  afterEach(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("stays unassessed for a System outside its scope, across creation, Type change, and direct edit attempts", async () => {
    const system = await prisma.system.create({
      data: { name: "Scope Invariant System", deploymentFacets: { connect: [{ id: outOfScopeTypeAId }] }, ownerId: adminId, status: "DRAFT" },
    });
    systemId = system.id;

    // 1. System creation with an out-of-scope Type never creates a row.
    await assertNoAssessment(systemId, scopedControlId);

    // 2. Changing to a *different* out-of-scope Type still doesn't.
    const typeChangeResponse = await changeSystemType(
      requestWith(`http://localhost/api/systems/${systemId}`, "PATCH", adminId, {
        deploymentFacetIds: [outOfScopeTypeBId],
      }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(typeChangeResponse.status).toBe(200);
    await assertNoAssessment(systemId, scopedControlId);

    // 3. A direct manual Assessment edit is rejected as not found, not
    // created, while the System remains out of scope.
    const patchResponse = await patchAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${scopedControlId}`,
        "PATCH",
        adminId,
        { status: "FULFILLED" },
      ),
      { params: Promise.resolve({ id: systemId, controlId: scopedControlId }) },
    );
    expect(patchResponse.status).toBe(404);
    await assertNoAssessment(systemId, scopedControlId);

    // 4. Same for answering its Self-Assessment Question.
    const answerResponse = await answerAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${scopedControlId}/answer`,
        "PATCH",
        adminId,
        { answer: "YES" },
      ),
      { params: Promise.resolve({ id: systemId, controlId: scopedControlId }) },
    );
    expect(answerResponse.status).toBe(404);
    await assertNoAssessment(systemId, scopedControlId);

    // 5. Changing *into* scope does create it, proving the absence above
    // was genuinely about scope and not some unrelated bug.
    const intoScopeResponse = await changeSystemType(
      requestWith(`http://localhost/api/systems/${systemId}`, "PATCH", adminId, {
        deploymentFacetIds: [scopedTypeId],
      }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(intoScopeResponse.status).toBe(200);
    const assessment = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: scopedControlId } },
    });
    expect(assessment).not.toBeNull();
  });
});

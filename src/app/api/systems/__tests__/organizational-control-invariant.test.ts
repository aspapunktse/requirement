import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH as changeSystemType } from "@/app/api/systems/[id]/route";
import { POST as addOffering } from "@/app/api/systems/[id]/offerings/route";
import { POST as declareProviderDependency } from "@/app/api/systems/[id]/dependencies/route";
import { PATCH as patchAssessment } from "@/app/api/systems/[id]/assessments/[controlId]/route";
import { PATCH as answerAssessment } from "@/app/api/systems/[id]/assessments/[controlId]/answer/route";

// Invariant #18: an ORGANIZATIONAL-scoped Control is never assessed per
// System — no ControlAssessment row is ever created for it, no matter
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

async function assertNoAssessment(systemId: string, controlId: string) {
  const assessment = await prisma.controlAssessment.findUnique({
    where: { systemId_controlId: { systemId, controlId } },
  });
  expect(assessment).toBeNull();
}

describe("Invariant: an ORGANIZATIONAL Control never gets a ControlAssessment", () => {
  let adminId: string;
  let typeAId: string;
  let typeBId: string;
  let orgControlId: string;
  let systemId: string;
  let providerId: string | null = null;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Org Invariant Admin", role: "ADMIN" },
    });
    adminId = admin.id;

    const suffix = Date.now();
    const typeA = await prisma.deploymentFacet.create({ data: { name: `Org Invariant Type A ${suffix}` } });
    const typeB = await prisma.deploymentFacet.create({ data: { name: `Org Invariant Type B ${suffix}` } });
    typeAId = typeA.id;
    typeBId = typeB.id;

    // Deliberately left unscoped to any System Type, to make sure that doesn't
    // make it assessable — an ORGANIZATIONAL Control is excluded by applicability alone.
    const orgControl = await prisma.control.create({
      data: {
        code: `ORG-INV-${suffix}`,
        title: "Organizational-only Control",
        description: "Satisfied centrally; never assessed per System.",
        category: "Security",
        applicability: "ORGANIZATIONAL",
        mandatory: true,
      },
    });
    orgControlId = orgControl.id;
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: orgControlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [typeAId, typeBId] } } });
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  });

  afterEach(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    if (providerId) await prisma.system.deleteMany({ where: { id: providerId } });
    providerId = null;
  });

  it("stays unassessed across System creation, Type change, an Offering attempt, a Provider dependency, and direct edit attempts", async () => {
    const system = await prisma.system.create({
      data: { name: "Org Invariant System", deploymentFacets: { connect: [{ id: typeAId }] }, ownerId: adminId, status: "DRAFT" },
    });
    systemId = system.id;

    // 1. System creation never creates a row for it.
    await assertNoAssessment(systemId, orgControlId);

    // 2. Changing Deployment Facets (which recomputes the applicable set)
    // never creates one either.
    const typeChangeResponse = await changeSystemType(
      requestWith(`http://localhost/api/systems/${systemId}`, "PATCH", adminId, { deploymentFacetIds: [typeBId] }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(typeChangeResponse.status).toBe(200);
    await assertNoAssessment(systemId, orgControlId);

    // 3. A Provider can't offer it (it applies to no System, so there is no Assessment to back an Offering)...
    const provider = await prisma.system.create({
      data: {
        name: "Org Invariant Provider",
        deploymentFacets: { connect: [{ id: typeBId }] },
        ownerId: adminId,
        status: "ONBOARDED",
        isProvider: true,
      },
    });
    providerId = provider.id;
    const offerResponse = await addOffering(
      requestWith(`http://localhost/api/systems/${providerId}/offerings`, "POST", adminId, {
        controlId: orgControlId,
        type: "FULL",
      }),
      { params: Promise.resolve({ id: providerId }) },
    );
    expect(offerResponse.status).toBe(409);
    expect(await prisma.controlOffering.count({ where: { providerId } })).toBe(0);
    await assertNoAssessment(providerId, orgControlId);

    // 4. ...and depending on a Provider never creates a row for it on the dependent.
    const dependencyResponse = await declareProviderDependency(
      requestWith(`http://localhost/api/systems/${systemId}/dependencies`, "POST", adminId, { providerId }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(dependencyResponse.status).toBe(201);
    await assertNoAssessment(systemId, orgControlId);

    // 5. A direct manual Assessment edit is rejected outright (the
    // Control isn't "applicable", so it's treated as not found) rather
    // than creating a row.
    const patchResponse = await patchAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${orgControlId}`,
        "PATCH",
        adminId,
        { status: "FULFILLED" },
      ),
      { params: Promise.resolve({ id: systemId, controlId: orgControlId }) },
    );
    expect(patchResponse.status).toBe(404);
    await assertNoAssessment(systemId, orgControlId);

    // 6. Answering its (nonexistent) Self-Assessment Question is rejected
    // the same way.
    const answerResponse = await answerAssessment(
      requestWith(
        `http://localhost/api/systems/${systemId}/assessments/${orgControlId}/answer`,
        "PATCH",
        adminId,
        { answer: "YES" },
      ),
      { params: Promise.resolve({ id: systemId, controlId: orgControlId }) },
    );
    expect(answerResponse.status).toBe(404);
    await assertNoAssessment(systemId, orgControlId);
  });
});

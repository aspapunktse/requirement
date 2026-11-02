import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const OWNER_EMAIL = "test-impact-change-owner@example.com";
const OTHER_OWNER_EMAIL = "test-impact-change-other-owner@example.com";
const CM_EMAIL = "test-impact-change-compliance-manager@example.com";
const ADMIN_EMAIL = "test-impact-change-admin@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}`;
}

function requestAs(id: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), {
    method: "PATCH",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/systems/[id] (Sensitivity Level and Impact Level change)", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let complianceManagerId: string;
  let adminId: string;
  let facetId: string;
  let systemId: string;
  let stepUpControlId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Impact Change Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Impact Change Other Owner", role: "SYSTEM_OWNER" },
    });
    const complianceManager = await prisma.user.upsert({
      where: { email: CM_EMAIL },
      update: {},
      create: { email: CM_EMAIL, name: "Impact Change Compliance Manager", role: "COMPLIANCE_MANAGER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Impact Change Admin", role: "ADMIN" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    complianceManagerId = complianceManager.id;
    adminId = admin.id;

    const facet = await prisma.deploymentFacet.create({ data: { name: `Impact Test Facet ${Date.now()}` } });
    facetId = facet.id;

    const control = await prisma.control.create({
      data: {
        code: `IMP-RECOMPUTE-${Date.now()}`,
        title: "Test Step-up authentication (Highly Sensitive and above)",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: facetId }] }, // scoped, so it doesn't apply to other files' Systems (#231)
        minSensitivityLevel: 4,
      },
    });
    stepUpControlId = control.id;
    await mapControlsToBase([stepUpControlId]);
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    await prisma.control.deleteMany({ where: { id: stepUpControlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, CM_EMAIL, ADMIN_EMAIL] } } });
  });

  beforeEach(async () => {
    const system = await prisma.system.create({
      data: { name: "Impact Change System", deploymentFacets: { connect: [{ id: facetId }] }, ownerId, status: "DRAFT" },
    });
    systemId = system.id;
  });

  afterEach(async () => {
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await PATCH(
      requestAs(systemId, null, { sensitivityLevel: 4 }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(401);
  });

  it("forbids a SYSTEM_OWNER who doesn't own this System", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED" } });
    const response = await PATCH(
      requestAs(systemId, otherOwnerId, { sensitivityLevel: 4 }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(403);
    expect(await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).toMatchObject({ sensitivityLevel: null });
    expect(await prisma.controlAssessment.count({ where: { systemId } })).toBe(0);
    expect(await prisma.changeEvent.count({ where: { systemId, action: "CLASSIFICATION_CHANGED" } })).toBe(0);
  });

  // ADR 0006 removed the Draft-only lock (#51): Impact Levels change at any lifecycle stage, and never move the status.
  it.each(["IN_REVIEW", "APPROVED", "ONBOARDED"] as const)(
    "lets the owner change the Sensitivity Level on a %s System: the Assessments recompute and the status is unchanged",
    async (status) => {
      await prisma.system.update({ where: { id: systemId }, data: { status } });
      const response = await PATCH(
        requestAs(systemId, ownerId, { sensitivityLevel: 4 }),
        ctxFor(systemId),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ added: 1, removed: 0 });
      expect((await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).status).toBe(status);
      const assessment = await prisma.controlAssessment.findUnique({
        where: { systemId_controlId: { systemId, controlId: stepUpControlId } },
      });
      expect(assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });
    },
  );

  it("is read-only for a Compliance Manager: 403, and nothing changes", async () => {
    const response = await PATCH(requestAs(systemId, complianceManagerId, { sensitivityLevel: 5 }), ctxFor(systemId));
    expect(response.status).toBe(403);
    expect(await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).toMatchObject({ sensitivityLevel: null });
    expect(await prisma.controlAssessment.count({ where: { systemId } })).toBe(0);
    expect(await prisma.changeEvent.count({ where: { systemId, action: "CLASSIFICATION_CHANGED" } })).toBe(0);
  });

  it.each([0, 6, 2.5, "HIGH", "4", false])("rejects the Sensitivity Level %j with 400 and changes nothing", async (value) => {
    const response = await PATCH(requestAs(systemId, ownerId, { sensitivityLevel: value }), ctxFor(systemId));
    expect(response.status).toBe(400);
    expect(await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).toMatchObject({ sensitivityLevel: null });
    expect(await prisma.changeEvent.count({ where: { systemId, action: "CLASSIFICATION_CHANGED" } })).toBe(0);
  });

  it("rejects the old confidentialityImpactLevel field (it is gone)", async () => {
    const response = await PATCH(requestAs(systemId, ownerId, { confidentialityImpactLevel: "HIGH" }), ctxFor(systemId));
    expect(response.status).toBe(400);
  });

  it("lets an Admin set the level on a System they do not own", async () => {
    const response = await PATCH(requestAs(systemId, adminId, { sensitivityLevel: 3 }), ctxFor(systemId));
    expect(response.status).toBe(200);
    expect(await prisma.system.findUniqueOrThrow({ where: { id: systemId } })).toMatchObject({ sensitivityLevel: 3 });
  });

  // The step-up authentication example: a minimum of 4 (Highly Sensitive) applies at 4 and 5, not at 3, 2, 1 or unset.
  it.each([
    [null, false],
    [1, false],
    [2, false],
    [3, false],
    [4, true],
    [5, true],
  ])("the Control with minimum Highly Sensitive: a System at level %s gets it = %s", async (level, applies) => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: level } });
    const { getApplicableControls } = await import("@/lib/control-assessments");
    const system = await prisma.system.findUniqueOrThrow({
      where: { id: systemId },
      include: { deploymentFacets: { select: { id: true } }, frameworkScopes: { select: { id: true } } },
    });
    const ids = (await getApplicableControls(system)).map((control) => control.id);
    expect(ids.includes(stepUpControlId)).toBe(applies);
  });

  it("writes one CLASSIFICATION_CHANGED Change Event with the old and new level, and none when the level does not change", async () => {
    await PATCH(requestAs(systemId, ownerId, { sensitivityLevel: 3 }), ctxFor(systemId));
    await PATCH(requestAs(systemId, adminId, { sensitivityLevel: 4 }), ctxFor(systemId));
    const events = await prisma.changeEvent.findMany({
      where: { systemId, action: "CLASSIFICATION_CHANGED" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ actorId: ownerId });
    expect(events[0].detail).toContain("Sensitivity Level: not set → Sensitive");
    expect(events[1]).toMatchObject({ actorId: adminId });
    expect(events[1].detail).toContain("Sensitivity Level: Sensitive → Highly Sensitive");
    expect(events[1].detail).toContain("+1/-0 Control Assessment(s)");

    // Same level again: a Change Event is still written for the classification save, but names no level change.
    await PATCH(requestAs(systemId, ownerId, { sensitivityLevel: 4 }), ctxFor(systemId));
    const latest = await prisma.changeEvent.findFirstOrThrow({
      where: { systemId, action: "CLASSIFICATION_CHANGED" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(latest.detail).not.toContain("Sensitivity Level:");
  });

  it("rejects an empty body", async () => {
    const response = await PATCH(requestAs(systemId, ownerId, {}), ctxFor(systemId));
    expect(response.status).toBe(400);
  });

  it("lets the owning SYSTEM_OWNER set the Sensitivity Level independently of the Impact Levels", async () => {
    const response = await PATCH(
      requestAs(systemId, ownerId, { sensitivityLevel: 4 }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system).toMatchObject({
      sensitivityLevel: 4,
      integrityImpactLevel: null,
      availabilityImpactLevel: null,
    });
  });

  it("lets the Sensitivity Level be cleared back to null", async () => {
    await PATCH(requestAs(systemId, ownerId, { sensitivityLevel: 4 }), ctxFor(systemId));
    const response = await PATCH(
      requestAs(systemId, ownerId, { sensitivityLevel: null }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.sensitivityLevel).toBeNull();
  });

  it("can combine an Impact Level change with a Deployment Facet change in one request", async () => {
    const otherFacet = await prisma.deploymentFacet.create({
      data: { name: `Impact Test Other Facet ${Date.now()}` },
    });

    const response = await PATCH(
      requestAs(systemId, ownerId, {
        deploymentFacetIds: [otherFacet.id],
        availabilityImpactLevel: "CRITICAL",
      }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.deploymentFacets.map((f: { id: string }) => f.id)).toEqual([otherFacet.id]);
    expect(body.system.availabilityImpactLevel).toBe("CRITICAL");

    await prisma.deploymentFacet.delete({ where: { id: otherFacet.id } });
  });

  it("raising the Sensitivity Level creates a NOT_STARTED Assessment for a newly-applicable Control", async () => {
    const response = await PATCH(
      requestAs(systemId, ownerId, { sensitivityLevel: 4 }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.added).toBe(1);

    const assessment = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: stepUpControlId } },
    });
    expect(assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });
  });

  it("lowering the Sensitivity Level keeps a manually-touched Assessment that's no longer applicable (stale)", async () => {
    await PATCH(requestAs(systemId, ownerId, { sensitivityLevel: 5 }), ctxFor(systemId));

    await prisma.controlAssessment.update({
      where: { systemId_controlId: { systemId, controlId: stepUpControlId } },
      data: { status: "FULFILLED", assessedById: ownerId, assessedAt: new Date() },
    });

    const response = await PATCH(
      requestAs(systemId, ownerId, { sensitivityLevel: 2 }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.removed).toBe(0);

    const stillPresent = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: stepUpControlId } },
    });
    expect(stillPresent).toMatchObject({ status: "FULFILLED", assessedById: ownerId });
  });
});

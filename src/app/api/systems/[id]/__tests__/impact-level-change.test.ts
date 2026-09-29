import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const OWNER_EMAIL = "test-impact-change-owner@example.com";
const OTHER_OWNER_EMAIL = "test-impact-change-other-owner@example.com";

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

describe("PATCH /api/systems/[id] (Impact Level change)", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let facetId: string;
  let systemId: string;
  let highConfidentialityControlId: string;

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
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;

    const facet = await prisma.deploymentFacet.create({ data: { name: `Impact Test Facet ${Date.now()}` } });
    facetId = facet.id;

    const control = await prisma.control.create({
      data: {
        code: `IMP-RECOMPUTE-${Date.now()}`,
        title: "Requires High Confidentiality",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        minConfidentialityImpactLevel: "HIGH",
      },
    });
    highConfidentialityControlId = control.id;
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: highConfidentialityControlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL] } } });
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
      requestAs(systemId, null, { confidentialityImpactLevel: "HIGH" }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(401);
  });

  it("forbids a SYSTEM_OWNER who doesn't own this System", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED" } });
    const response = await PATCH(
      requestAs(systemId, otherOwnerId, { confidentialityImpactLevel: "HIGH" }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(403);
  });

  it("rejects changing Impact Levels on a System that isn't Draft", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "IN_REVIEW" } });
    const response = await PATCH(
      requestAs(systemId, ownerId, { confidentialityImpactLevel: "HIGH" }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(400);
  });

  it("rejects changing Impact Levels on an Onboarded System (#51)", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED" } });
    const response = await PATCH(
      requestAs(systemId, ownerId, { confidentialityImpactLevel: "HIGH" }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const response = await PATCH(requestAs(systemId, ownerId, {}), ctxFor(systemId));
    expect(response.status).toBe(400);
  });

  it("lets the owning SYSTEM_OWNER set an Impact Level axis independently of the others", async () => {
    const response = await PATCH(
      requestAs(systemId, ownerId, { confidentialityImpactLevel: "HIGH" }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system).toMatchObject({
      confidentialityImpactLevel: "HIGH",
      integrityImpactLevel: null,
      availabilityImpactLevel: null,
    });
  });

  it("lets an axis be cleared back to null", async () => {
    await PATCH(requestAs(systemId, ownerId, { confidentialityImpactLevel: "HIGH" }), ctxFor(systemId));
    const response = await PATCH(
      requestAs(systemId, ownerId, { confidentialityImpactLevel: null }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.confidentialityImpactLevel).toBeNull();
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

  it("raising an Impact Level axis creates a NOT_STARTED Assessment for a newly-applicable Control", async () => {
    const response = await PATCH(
      requestAs(systemId, ownerId, { confidentialityImpactLevel: "HIGH" }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.added).toBe(1);

    const assessment = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: highConfidentialityControlId } },
    });
    expect(assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });
  });

  it("lowering an Impact Level axis removes an untouched Assessment that's no longer applicable, but keeps a manually-touched one", async () => {
    await PATCH(requestAs(systemId, ownerId, { confidentialityImpactLevel: "CRITICAL" }), ctxFor(systemId));

    await prisma.controlAssessment.update({
      where: { systemId_controlId: { systemId, controlId: highConfidentialityControlId } },
      data: { status: "FULFILLED", assessedById: ownerId, assessedAt: new Date() },
    });

    const response = await PATCH(
      requestAs(systemId, ownerId, { confidentialityImpactLevel: "LOW" }),
      ctxFor(systemId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.removed).toBe(0);

    const stillPresent = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId, controlId: highConfidentialityControlId } },
    });
    expect(stillPresent).toMatchObject({ status: "FULFILLED", assessedById: ownerId });
  });
});

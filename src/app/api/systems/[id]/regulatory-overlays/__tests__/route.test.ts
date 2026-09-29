import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";
import { DELETE } from "../[overlayId]/route";

const OWNER_EMAIL = "test-sys-overlays-owner@example.com";
const OTHER_OWNER_EMAIL = "test-sys-overlays-other-owner@example.com";
const ADMIN_EMAIL = "test-sys-overlays-admin@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/regulatory-overlays`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), {
    method: init?.method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

function ctxForDelete(id: string, overlayId: string) {
  return { params: Promise.resolve({ id, overlayId }) };
}

describe("/api/systems/[id]/regulatory-overlays", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let adminId: string;
  let facetId: string;
  let overlayId: string;
  let draftSystemId: string;
  let inReviewSystemId: string;

  // Control scoped only to the overlay under test.
  let overlayScopedControlId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Sys Overlays Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Sys Overlays Other Owner", role: "SYSTEM_OWNER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Sys Overlays Admin", role: "ADMIN" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    adminId = admin.id;

    const suffix = Date.now();
    const facet = await prisma.deploymentFacet.create({ data: { name: `Overlay Test Facet ${suffix}` } });
    facetId = facet.id;

    const overlay = await prisma.regulatoryOverlay.create({ data: { name: `GDPR ${suffix}` } });
    overlayId = overlay.id;

    const overlayScoped = await prisma.control.create({
      data: {
        code: `OV-${suffix}`,
        title: "Only for this overlay",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        regulatoryOverlays: { connect: [{ id: overlayId }] },
      },
    });
    overlayScopedControlId = overlayScoped.id;
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: overlayScopedControlId } });
    await prisma.regulatoryOverlay.deleteMany({ where: { id: overlayId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, ADMIN_EMAIL] } } });
  });

  beforeEach(async () => {
    const draft = await prisma.system.create({
      data: { name: "Draft System", deploymentFacets: { connect: [{ id: facetId }] }, ownerId, status: "DRAFT" },
    });
    draftSystemId = draft.id;
    const inReview = await prisma.system.create({
      data: {
        name: "In Review System",
        deploymentFacets: { connect: [{ id: facetId }] },
        ownerId,
        status: "IN_REVIEW",
      },
    });
    inReviewSystemId = inReview.id;
  });

  afterEach(async () => {
    await prisma.controlAssessment.deleteMany({
      where: { systemId: { in: [draftSystemId, inReviewSystemId] } },
    });
    await prisma.system.deleteMany({ where: { id: { in: [draftSystemId, inReviewSystemId] } } });
  });

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(draftSystemId, null), ctxFor(draftSystemId));
    expect(response.status).toBe(401);
  });

  it("POST forbids a SYSTEM_OWNER who doesn't own this System (but can see it)", async () => {
    const onboarded = await prisma.system.create({
      data: { name: "Onboarded System", deploymentFacets: { connect: [{ id: facetId }] }, ownerId, status: "ONBOARDED" },
    });

    const response = await POST(
      requestAs(onboarded.id, otherOwnerId, { method: "POST", body: { regulatoryOverlayId: overlayId } }),
      ctxFor(onboarded.id),
    );
    expect(response.status).toBe(403);

    await prisma.system.delete({ where: { id: onboarded.id } });
  });

  it("POST forbids declaring on a System that isn't Draft", async () => {
    const response = await POST(
      requestAs(inReviewSystemId, ownerId, { method: "POST", body: { regulatoryOverlayId: overlayId } }),
      ctxFor(inReviewSystemId),
    );
    expect(response.status).toBe(403);
  });

  it("POST forbids declaring on an Onboarded System (#51)", async () => {
    await prisma.system.update({ where: { id: inReviewSystemId }, data: { status: "ONBOARDED" } });
    const response = await POST(
      requestAs(inReviewSystemId, ownerId, { method: "POST", body: { regulatoryOverlayId: overlayId } }),
      ctxFor(inReviewSystemId),
    );
    expect(response.status).toBe(403);
    await prisma.system.update({ where: { id: inReviewSystemId }, data: { status: "IN_REVIEW" } });
  });

  it("POST rejects an unknown regulatoryOverlayId", async () => {
    const response = await POST(
      requestAs(draftSystemId, ownerId, { method: "POST", body: { regulatoryOverlayId: "does-not-exist" } }),
      ctxFor(draftSystemId),
    );
    expect(response.status).toBe(400);
  });

  it("POST lets the owning SYSTEM_OWNER declare a Regulatory Overlay, creating a NOT_STARTED Assessment for a newly-applicable Control", async () => {
    const response = await POST(
      requestAs(draftSystemId, ownerId, { method: "POST", body: { regulatoryOverlayId: overlayId } }),
      ctxFor(draftSystemId),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.regulatoryOverlays.map((o: { id: string }) => o.id)).toContain(overlayId);

    const assessment = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId: draftSystemId, controlId: overlayScopedControlId } },
    });
    expect(assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });
  });

  it("POST lets an ADMIN declare a Regulatory Overlay on any Draft System", async () => {
    const response = await POST(
      requestAs(draftSystemId, adminId, { method: "POST", body: { regulatoryOverlayId: overlayId } }),
      ctxFor(draftSystemId),
    );
    expect(response.status).toBe(201);
  });

  it("DELETE removes an untouched Assessment that's no longer applicable, but keeps a manually-touched one", async () => {
    await POST(
      requestAs(draftSystemId, ownerId, { method: "POST", body: { regulatoryOverlayId: overlayId } }),
      ctxFor(draftSystemId),
    );

    // Touch the overlay-scoped Assessment so it should be preserved as stale, not deleted.
    await prisma.controlAssessment.update({
      where: { systemId_controlId: { systemId: draftSystemId, controlId: overlayScopedControlId } },
      data: { status: "FULFILLED", assessedById: ownerId, assessedAt: new Date() },
    });

    const response = await DELETE(
      requestAs(draftSystemId, ownerId, { method: "DELETE" }),
      ctxForDelete(draftSystemId, overlayId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.regulatoryOverlays).toEqual([]);

    const stillPresent = await prisma.controlAssessment.findUnique({
      where: { systemId_controlId: { systemId: draftSystemId, controlId: overlayScopedControlId } },
    });
    expect(stillPresent).toMatchObject({ status: "FULFILLED", assessedById: ownerId });
  });

  it("DELETE forbids removal on a System that isn't Draft", async () => {
    await prisma.system.update({ where: { id: inReviewSystemId }, data: { status: "DRAFT" } });
    await POST(
      requestAs(inReviewSystemId, ownerId, { method: "POST", body: { regulatoryOverlayId: overlayId } }),
      ctxFor(inReviewSystemId),
    );
    await prisma.system.update({ where: { id: inReviewSystemId }, data: { status: "IN_REVIEW" } });

    const response = await DELETE(
      requestAs(inReviewSystemId, ownerId, { method: "DELETE" }),
      ctxForDelete(inReviewSystemId, overlayId),
    );
    expect(response.status).toBe(403);
  });
});

import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { DELETE, PATCH } from "../route";

const ADMIN_EMAIL = "test-regulatory-overlay-edit-admin@example.com";
const VIEWER_EMAIL = "test-regulatory-overlay-edit-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/regulatory-overlays/${id}`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { ...init, headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/regulatory-overlays/[id]", () => {
  let adminId: string;
  let viewerId: string;
  let overlayId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Regulatory Overlay Edit Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Regulatory Overlay Edit Viewer", role: "VIEWER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL] } } });
  });

  beforeEach(async () => {
    const overlay = await prisma.regulatoryOverlay.create({
      data: { name: `Test Edit Target ${Date.now()}`, description: "Before edit" },
    });
    overlayId = overlay.id;
  });

  afterEach(async () => {
    await prisma.regulatoryOverlay.deleteMany({ where: { id: overlayId } });
  });

  it("rejects a non-admin", async () => {
    const response = await PATCH(
      requestAs(overlayId, viewerId, {
        method: "PATCH",
        body: JSON.stringify({ description: "After edit" }),
      }),
      ctxFor(overlayId),
    );
    expect(response.status).toBe(403);
  });

  it("lets an admin edit the description", async () => {
    const response = await PATCH(
      requestAs(overlayId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: "After edit" }),
      }),
      ctxFor(overlayId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.regulatoryOverlay).toMatchObject({ id: overlayId, description: "After edit" });
  });

  it("returns 404 for a Regulatory Overlay that doesn't exist", async () => {
    const response = await PATCH(
      requestAs("does-not-exist", adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: "Doesn't matter" }),
      }),
      ctxFor("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("rejects an empty update body", async () => {
    const response = await PATCH(
      requestAs(overlayId, adminId, { method: "PATCH", body: JSON.stringify({}) }),
      ctxFor(overlayId),
    );
    expect(response.status).toBe(400);
  });
});

describe("DELETE /api/regulatory-overlays/[id]", () => {
  const OWNER_EMAIL = "test-regulatory-overlay-delete-owner@example.com";
  let adminId: string;
  let ownerId: string;
  let overlayId: string;
  let facetId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Regulatory Overlay Delete Admin", role: "ADMIN" },
    });
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Regulatory Overlay Delete Owner", role: "SYSTEM_OWNER" },
    });
    adminId = admin.id;
    ownerId = owner.id;

    const facet = await prisma.deploymentFacet.create({
      data: { name: `Test Overlay Delete Facet ${Date.now()}` },
    });
    facetId = facet.id;
  });

  afterAll(async () => {
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, OWNER_EMAIL] } } });
  });

  beforeEach(async () => {
    const overlay = await prisma.regulatoryOverlay.create({
      data: { name: `Test Delete Target ${Date.now()}` },
    });
    overlayId = overlay.id;
  });

  afterEach(async () => {
    await prisma.regulatoryOverlay.deleteMany({ where: { id: overlayId } });
  });

  it("rejects a non-admin", async () => {
    const response = await DELETE(requestAs(overlayId, ownerId, { method: "DELETE" }), ctxFor(overlayId));
    expect(response.status).toBe(403);
  });

  it("lets an admin retire an unused Regulatory Overlay", async () => {
    const response = await DELETE(requestAs(overlayId, adminId, { method: "DELETE" }), ctxFor(overlayId));
    expect(response.status).toBe(204);

    const found = await prisma.regulatoryOverlay.findUnique({ where: { id: overlayId } });
    expect(found).toBeNull();
  });

  it("returns 404 for a Regulatory Overlay that doesn't exist", async () => {
    const response = await DELETE(
      requestAs("does-not-exist", adminId, { method: "DELETE" }),
      ctxFor("does-not-exist"),
    );
    expect(response.status).toBe(404);
  });

  it("blocks retiring a Regulatory Overlay declared by a System", async () => {
    const system = await prisma.system.create({
      data: {
        name: "Declares The Overlay",
        deploymentFacets: { connect: [{ id: facetId }] },
        ownerId,
        status: "DRAFT",
        regulatoryOverlays: { connect: { id: overlayId } },
      },
    });

    const response = await DELETE(requestAs(overlayId, adminId, { method: "DELETE" }), ctxFor(overlayId));
    expect(response.status).toBe(409);

    await prisma.system.delete({ where: { id: system.id } });
  });

  it("blocks retiring a Regulatory Overlay mapped to a Control", async () => {
    const control = await prisma.control.create({
      data: {
        code: `OVERLAY-DELETE-${Date.now()}`,
        title: "Uses The Overlay",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        regulatoryOverlays: { connect: { id: overlayId } },
      },
    });

    const response = await DELETE(requestAs(overlayId, adminId, { method: "DELETE" }), ctxFor(overlayId));
    expect(response.status).toBe(409);

    await prisma.control.delete({ where: { id: control.id } });
  });
});

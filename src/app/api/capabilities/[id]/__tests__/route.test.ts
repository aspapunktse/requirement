import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { DELETE, PATCH } from "../route";

const ADMIN_EMAIL = "test-capability-edit-admin@example.com";
const VIEWER_EMAIL = "test-capability-edit-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/capabilities/${id}`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { ...init, headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/capabilities/[id]", () => {
  let adminId: string;
  let viewerId: string;
  let capabilityId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Capability Edit Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Capability Edit Viewer", role: "VIEWER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL] } } });
  });

  beforeEach(async () => {
    const capability = await prisma.capability.create({
      data: { name: `Test Edit Target ${Date.now()}`, description: "Before edit" },
    });
    capabilityId = capability.id;
  });

  afterEach(async () => {
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
  });

  it("rejects a non-admin", async () => {
    const response = await PATCH(
      requestAs(capabilityId, viewerId, {
        method: "PATCH",
        body: JSON.stringify({ description: "After edit" }),
      }),
      ctxFor(capabilityId),
    );
    expect(response.status).toBe(403);
  });

  it("lets an admin edit the description", async () => {
    const response = await PATCH(
      requestAs(capabilityId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: "After edit" }),
      }),
      ctxFor(capabilityId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.capability).toMatchObject({ id: capabilityId, description: "After edit" });
  });

  it("returns 404 for a Capability that doesn't exist", async () => {
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
      requestAs(capabilityId, adminId, { method: "PATCH", body: JSON.stringify({}) }),
      ctxFor(capabilityId),
    );
    expect(response.status).toBe(400);
  });

  it("lets an admin clear the description by setting it to null", async () => {
    const response = await PATCH(
      requestAs(capabilityId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: null }),
      }),
      ctxFor(capabilityId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.capability).toMatchObject({ id: capabilityId, description: null });
  });
});

describe("DELETE /api/capabilities/[id]", () => {
  const OWNER_EMAIL = "test-capability-delete-owner@example.com";
  let adminId: string;
  let ownerId: string;
  let capabilityId: string;
  let systemTypeId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Capability Delete Admin", role: "ADMIN" },
    });
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Capability Delete Owner", role: "SYSTEM_OWNER" },
    });
    adminId = admin.id;
    ownerId = owner.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Capability Delete Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;
  });

  afterAll(async () => {
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, OWNER_EMAIL] } } });
  });

  beforeEach(async () => {
    const capability = await prisma.capability.create({
      data: { name: `Test Delete Target ${Date.now()}` },
    });
    capabilityId = capability.id;
  });

  afterEach(async () => {
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
  });

  it("rejects a non-admin", async () => {
    const response = await DELETE(requestAs(capabilityId, ownerId, { method: "DELETE" }), ctxFor(capabilityId));
    expect(response.status).toBe(403);
  });

  it("lets an admin retire an unused Capability", async () => {
    const response = await DELETE(requestAs(capabilityId, adminId, { method: "DELETE" }), ctxFor(capabilityId));
    expect(response.status).toBe(204);

    const found = await prisma.capability.findUnique({ where: { id: capabilityId } });
    expect(found).toBeNull();
  });

  it("returns 404 for a Capability that doesn't exist", async () => {
    const response = await DELETE(requestAs("does-not-exist", adminId, { method: "DELETE" }), ctxFor("does-not-exist"));
    expect(response.status).toBe(404);
  });

  it("blocks retiring a Capability declared by a System", async () => {
    const system = await prisma.system.create({
      data: {
        name: "Declares The Capability",
        deploymentFacets: { connect: [{ id: systemTypeId }] },
        ownerId,
        status: "DRAFT",
        capabilities: { connect: { id: capabilityId } },
      },
    });

    const response = await DELETE(requestAs(capabilityId, adminId, { method: "DELETE" }), ctxFor(capabilityId));
    expect(response.status).toBe(409);

    await prisma.system.delete({ where: { id: system.id } });
  });

  it("blocks retiring a Capability mapped to a Control", async () => {
    const control = await prisma.control.create({
      data: {
        code: `CAP-DELETE-${Date.now()}`,
        title: "Uses The Capability",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        capabilities: { connect: { id: capabilityId } },
      },
    });

    const response = await DELETE(requestAs(capabilityId, adminId, { method: "DELETE" }), ctxFor(capabilityId));
    expect(response.status).toBe(409);

    await prisma.control.delete({ where: { id: control.id } });
  });
});

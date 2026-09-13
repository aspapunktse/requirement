import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const ADMIN_EMAIL = "test-system-type-edit-admin@example.com";
const VIEWER_EMAIL = "test-system-type-edit-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/system-types/${id}`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { ...init, headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/system-types/[id]", () => {
  let adminId: string;
  let viewerId: string;
  let systemTypeId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "System Type Edit Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "System Type Edit Viewer", role: "VIEWER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL] } } });
  });

  beforeEach(async () => {
    const systemType = await prisma.systemType.create({
      data: { name: `Test Edit Target ${Date.now()}`, description: "Before edit" },
    });
    systemTypeId = systemType.id;
  });

  afterEach(async () => {
    await prisma.systemType.deleteMany({ where: { id: systemTypeId } });
  });

  it("rejects a non-admin", async () => {
    const response = await PATCH(
      requestAs(systemTypeId, viewerId, {
        method: "PATCH",
        body: JSON.stringify({ description: "After edit" }),
      }),
      ctxFor(systemTypeId),
    );
    expect(response.status).toBe(403);
  });

  it("lets an admin edit the description", async () => {
    const response = await PATCH(
      requestAs(systemTypeId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: "After edit" }),
      }),
      ctxFor(systemTypeId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.systemType).toMatchObject({ id: systemTypeId, description: "After edit" });
  });

  it("returns 404 for a System Type that doesn't exist", async () => {
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
      requestAs(systemTypeId, adminId, { method: "PATCH", body: JSON.stringify({}) }),
      ctxFor(systemTypeId),
    );
    expect(response.status).toBe(400);
  });

  it("lets an admin clear the description by setting it to null", async () => {
    const response = await PATCH(
      requestAs(systemTypeId, adminId, {
        method: "PATCH",
        body: JSON.stringify({ description: null }),
      }),
      ctxFor(systemTypeId),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.systemType).toMatchObject({ id: systemTypeId, description: null });
  });
});

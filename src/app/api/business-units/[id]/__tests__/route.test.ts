import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { DELETE, PATCH } from "../route";

const ADMIN_EMAIL = "test-business-unit-edit-admin@example.com";
const VIEWER_EMAIL = "test-business-unit-edit-viewer@example.com";
const OWNER_EMAIL = "test-business-unit-edit-owner@example.com";

function urlFor(id: string) {
  return `http://localhost/api/business-units/${id}`;
}

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { ...init, headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/business-units/[id]", () => {
  let adminId: string;
  let viewerId: string;
  let ownerId: string;
  let businessUnitId: string;

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Business Unit Edit Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Business Unit Edit Viewer", role: "VIEWER" },
    });
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Business Unit Edit Owner", role: "SYSTEM_OWNER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;
    ownerId = owner.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN_EMAIL, VIEWER_EMAIL, OWNER_EMAIL] } } });
  });

  beforeEach(async () => {
    const businessUnit = await prisma.businessUnit.create({
      data: { name: `Test BU Edit Target ${Date.now()}`, description: "Before edit" },
    });
    businessUnitId = businessUnit.id;
  });

  afterEach(async () => {
    await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
  });

  it("PATCH rejects a non-admin", async () => {
    const response = await PATCH(
      requestAs(businessUnitId, viewerId, { method: "PATCH", body: JSON.stringify({ name: "x" }) }),
      ctxFor(businessUnitId),
    );
    expect(response.status).toBe(403);
  });

  it("PATCH lets an admin rename it", async () => {
    const response = await PATCH(
      requestAs(businessUnitId, adminId, { method: "PATCH", body: JSON.stringify({ name: "Test BU Renamed" }) }),
      ctxFor(businessUnitId),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.businessUnit.name).toBe("Test BU Renamed");
  });

  it("DELETE rejects a non-admin", async () => {
    const response = await DELETE(requestAs(businessUnitId, viewerId), ctxFor(businessUnitId));
    expect(response.status).toBe(403);
  });

  it("DELETE removes an unused Business Unit", async () => {
    const response = await DELETE(requestAs(businessUnitId, adminId), ctxFor(businessUnitId));
    expect(response.status).toBe(204);
  });

  it("DELETE refuses to retire a Business Unit assigned to a System", async () => {
    const facet = await prisma.deploymentFacet.create({ data: { name: `Test BU Edit Facet ${Date.now()}` } });
    const system = await prisma.system.create({
      data: {
        name: "Test BU Edit System",
        ownerId,
        deploymentFacets: { connect: { id: facet.id } },
        businessUnits: { connect: { id: businessUnitId } },
      },
    });

    const response = await DELETE(requestAs(businessUnitId, adminId), ctxFor(businessUnitId));
    expect(response.status).toBe(409);

    await prisma.system.deleteMany({ where: { id: system.id } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facet.id } });
  });
});

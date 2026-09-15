import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";

const OWNER_EMAIL = "test-sys-bu-owner@example.com";
const OTHER_OWNER_EMAIL = "test-sys-bu-other-owner@example.com";
const ADMIN_EMAIL = "test-sys-bu-admin@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/business-units`;
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

describe("/api/systems/[id]/business-units", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let adminId: string;
  let systemTypeId: string;
  let onboardedSystemId: string;
  let businessUnitId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Sys BU Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Sys BU Other Owner", role: "SYSTEM_OWNER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Sys BU Admin", role: "ADMIN" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    adminId = admin.id;

    const systemType = await prisma.deploymentFacet.create({ data: { name: `Test Sys BU Type ${Date.now()}` } });
    systemTypeId = systemType.id;

    const businessUnit = await prisma.businessUnit.create({ data: { name: `Test Sys BU ${Date.now()}` } });
    businessUnitId = businessUnit.id;
  });

  afterAll(async () => {
    await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, ADMIN_EMAIL] } } });
  });

  beforeEach(async () => {
    const onboarded = await prisma.system.create({
      data: {
        name: "Onboarded System",
        deploymentFacets: { connect: [{ id: systemTypeId }] },
        ownerId,
        status: "ONBOARDED",
      },
    });
    onboardedSystemId = onboarded.id;
  });

  afterEach(async () => {
    await prisma.system.deleteMany({ where: { id: onboardedSystemId } });
  });

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(onboardedSystemId, null), ctxFor(onboardedSystemId));
    expect(response.status).toBe(401);
  });

  it("POST lets the owning SYSTEM_OWNER declare a Business Unit even on an ONBOARDED System", async () => {
    const response = await POST(
      requestAs(onboardedSystemId, ownerId, { method: "POST", body: { businessUnitId } }),
      ctxFor(onboardedSystemId),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.businessUnits.map((b: { id: string }) => b.id)).toContain(businessUnitId);
  });

  it("POST forbids a SYSTEM_OWNER who doesn't own this System", async () => {
    const response = await POST(
      requestAs(onboardedSystemId, otherOwnerId, { method: "POST", body: { businessUnitId } }),
      ctxFor(onboardedSystemId),
    );
    expect(response.status).toBe(403);
  });

  it("POST lets an ADMIN declare a Business Unit on any System", async () => {
    const response = await POST(
      requestAs(onboardedSystemId, adminId, { method: "POST", body: { businessUnitId } }),
      ctxFor(onboardedSystemId),
    );
    expect(response.status).toBe(201);
  });

  it("POST rejects an unknown businessUnitId", async () => {
    const response = await POST(
      requestAs(onboardedSystemId, ownerId, { method: "POST", body: { businessUnitId: "does-not-exist" } }),
      ctxFor(onboardedSystemId),
    );
    expect(response.status).toBe(400);
  });
});

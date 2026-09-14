import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";

const OWNER_EMAIL = "test-sys-caps-owner@example.com";
const OTHER_OWNER_EMAIL = "test-sys-caps-other-owner@example.com";
const ADMIN_EMAIL = "test-sys-caps-admin@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/capabilities`;
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

describe("/api/systems/[id]/capabilities", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let adminId: string;
  let systemTypeId: string;
  let draftSystemId: string;
  let inReviewSystemId: string;
  let capabilityId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Sys Caps Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Sys Caps Other Owner", role: "SYSTEM_OWNER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Sys Caps Admin", role: "ADMIN" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    adminId = admin.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Sys Caps Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const capability = await prisma.capability.create({
      data: { name: `Test Sys Caps Capability ${Date.now()}` },
    });
    capabilityId = capability.id;
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: [draftSystemId, inReviewSystemId] } } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, ADMIN_EMAIL] } } });
  });

  beforeEach(async () => {
    const draft = await prisma.system.create({
      data: { name: "Draft System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    draftSystemId = draft.id;
    const inReview = await prisma.system.create({
      data: { name: "In Review System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "IN_REVIEW" },
    });
    inReviewSystemId = inReview.id;
  });

  afterEach(async () => {
    await prisma.system.deleteMany({ where: { id: { in: [draftSystemId, inReviewSystemId] } } });
  });

  it("GET rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(draftSystemId, null), ctxFor(draftSystemId));
    expect(response.status).toBe(401);
  });

  it("POST forbids a SYSTEM_OWNER who doesn't own this System (but can see it)", async () => {
    const onboarded = await prisma.system.create({
      data: { name: "Onboarded System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "ONBOARDED" },
    });

    const response = await POST(
      requestAs(onboarded.id, otherOwnerId, { method: "POST", body: { capabilityId } }),
      ctxFor(onboarded.id),
    );
    expect(response.status).toBe(403);

    await prisma.system.delete({ where: { id: onboarded.id } });
  });

  it("POST forbids declaring on a System that isn't Draft", async () => {
    const response = await POST(
      requestAs(inReviewSystemId, ownerId, { method: "POST", body: { capabilityId } }),
      ctxFor(inReviewSystemId),
    );
    expect(response.status).toBe(403);
  });

  it("POST lets the owning SYSTEM_OWNER declare a Capability", async () => {
    const response = await POST(
      requestAs(draftSystemId, ownerId, { method: "POST", body: { capabilityId } }),
      ctxFor(draftSystemId),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.capabilities.map((c: { id: string }) => c.id)).toContain(capabilityId);
  });

  it("POST lets an ADMIN declare a Capability on any Draft System", async () => {
    const response = await POST(
      requestAs(draftSystemId, adminId, { method: "POST", body: { capabilityId } }),
      ctxFor(draftSystemId),
    );
    expect(response.status).toBe(201);
  });

  it("POST rejects an unknown capabilityId", async () => {
    const response = await POST(
      requestAs(draftSystemId, ownerId, { method: "POST", body: { capabilityId: "does-not-exist" } }),
      ctxFor(draftSystemId),
    );
    expect(response.status).toBe(400);
  });

});

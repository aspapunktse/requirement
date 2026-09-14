import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

const OWNER_EMAIL = "test-system-detail-owner@example.com";
const OTHER_OWNER_EMAIL = "test-system-detail-other-owner@example.com";
const VIEWER_EMAIL = "test-system-detail-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}`;
}

function requestAs(id: string, userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/systems/[id]", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let viewerId: string;
  let systemTypeId: string;
  const createdSystemIds: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "System Detail Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "System Detail Other Owner", role: "SYSTEM_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "System Detail Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    viewerId = viewer.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test System Detail Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;
  });

  afterAll(async () => {
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({
      where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, VIEWER_EMAIL] } },
    });
  });

  afterEach(async () => {
    await prisma.system.deleteMany({ where: { id: { in: createdSystemIds } } });
    createdSystemIds.length = 0;
  });

  it("rejects an unauthenticated request", async () => {
    const response = await GET(requestAs("some-id", null), ctxFor("some-id"));
    expect(response.status).toBe(401);
  });

  it("returns 404 for a System that doesn't exist", async () => {
    const response = await GET(requestAs("does-not-exist", viewerId), ctxFor("does-not-exist"));
    expect(response.status).toBe(404);
  });

  it("lets the owner view their own Draft System", async () => {
    const system = await prisma.system.create({
      data: { name: "Owner's System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId, status: "DRAFT" },
    });
    createdSystemIds.push(system.id);

    const response = await GET(requestAs(system.id, ownerId), ctxFor(system.id));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.id).toBe(system.id);
    expect(body.system.deploymentFacets.map((f: { id: string }) => f.id)).toEqual([systemTypeId]);
  });

  it("returns 404 for a Draft System the acting user cannot see", async () => {
    const system = await prisma.system.create({
      data: { name: "Other Owner's Draft", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId: otherOwnerId, status: "DRAFT" },
    });
    createdSystemIds.push(system.id);

    const response = await GET(requestAs(system.id, viewerId), ctxFor(system.id));
    expect(response.status).toBe(404);
  });

  it("lets any authenticated user view an ONBOARDED System", async () => {
    const system = await prisma.system.create({
      data: { name: "Onboarded System", deploymentFacets: { connect: [{ id: systemTypeId }] }, ownerId: otherOwnerId, status: "ONBOARDED" },
    });
    createdSystemIds.push(system.id);

    const response = await GET(requestAs(system.id, viewerId), ctxFor(system.id));
    expect(response.status).toBe(200);
  });
});

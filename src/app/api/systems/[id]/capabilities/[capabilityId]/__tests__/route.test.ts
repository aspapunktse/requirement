import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { DELETE } from "../route";

const OWNER_EMAIL = "test-sys-caps-delete-owner@example.com";
const OTHER_OWNER_EMAIL = "test-sys-caps-delete-other-owner@example.com";

function urlFor(systemId: string, capabilityId: string) {
  return `http://localhost/api/systems/${systemId}/capabilities/${capabilityId}`;
}

function requestAs(systemId: string, capabilityId: string, userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(systemId, capabilityId), { method: "DELETE", headers });
}

function ctxFor(systemId: string, capabilityId: string) {
  return { params: Promise.resolve({ id: systemId, capabilityId }) };
}

describe("DELETE /api/systems/[id]/capabilities/[capabilityId]", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let systemTypeId: string;
  let systemId: string;
  let capabilityId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Sys Caps Delete Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Sys Caps Delete Other Owner", role: "SYSTEM_OWNER" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;

    const systemType = await prisma.deploymentFacet.create({
      data: { name: `Test Sys Caps Delete Type ${Date.now()}` },
    });
    systemTypeId = systemType.id;

    const capability = await prisma.capability.create({
      data: { name: `Test Sys Caps Delete Capability ${Date.now()}` },
    });
    capabilityId = capability.id;
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.capability.deleteMany({ where: { id: capabilityId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: systemTypeId } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL] } } });
  });

  beforeEach(async () => {
    const system = await prisma.system.create({
      data: {
        name: "Delete Test System",
        deploymentFacets: { connect: [{ id: systemTypeId }] },
        ownerId,
        status: "DRAFT",
        capabilities: { connect: { id: capabilityId } },
      },
    });
    systemId = system.id;
  });

  afterEach(async () => {
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await DELETE(requestAs(systemId, capabilityId, null), ctxFor(systemId, capabilityId));
    expect(response.status).toBe(401);
  });

  it("forbids a SYSTEM_OWNER who doesn't own this System (but can see it)", async () => {
    const onboarded = await prisma.system.create({
      data: {
        name: "Onboarded System",
        deploymentFacets: { connect: [{ id: systemTypeId }] },
        ownerId,
        status: "ONBOARDED",
        capabilities: { connect: { id: capabilityId } },
      },
    });

    const response = await DELETE(
      requestAs(onboarded.id, capabilityId, otherOwnerId),
      ctxFor(onboarded.id, capabilityId),
    );
    expect(response.status).toBe(403);

    await prisma.system.delete({ where: { id: onboarded.id } });
  });

  it("lets the owning SYSTEM_OWNER remove a declared Capability", async () => {
    const response = await DELETE(requestAs(systemId, capabilityId, ownerId), ctxFor(systemId, capabilityId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.capabilities).toHaveLength(0);
  });

  it("is idempotent when the Capability isn't currently declared", async () => {
    await DELETE(requestAs(systemId, capabilityId, ownerId), ctxFor(systemId, capabilityId));
    const response = await DELETE(requestAs(systemId, capabilityId, ownerId), ctxFor(systemId, capabilityId));
    expect(response.status).toBe(200);
  });
});

import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

const OWNER_EMAIL = "test-type-change-owner@example.com";
const OTHER_OWNER_EMAIL = "test-type-change-other-owner@example.com";
const ADMIN_EMAIL = "test-type-change-admin@example.com";

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

describe("PATCH /api/systems/[id] (System Type change)", () => {
  let ownerId: string;
  let otherOwnerId: string;
  let adminId: string;
  let typeAId: string;
  let typeBId: string;
  let systemId: string;

  // Requirement applicable only to Type A
  let onlyAId: string;
  // Requirement applicable only to Type B
  let onlyBId: string;
  // Requirement applicable to both (unscoped)
  let bothId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Type Change Owner", role: "SYSTEM_OWNER" },
    });
    const otherOwner = await prisma.user.upsert({
      where: { email: OTHER_OWNER_EMAIL },
      update: {},
      create: { email: OTHER_OWNER_EMAIL, name: "Type Change Other Owner", role: "SYSTEM_OWNER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Type Change Admin", role: "ADMIN" },
    });
    ownerId = owner.id;
    otherOwnerId = otherOwner.id;
    adminId = admin.id;

    const suffix = Date.now();
    const typeA = await prisma.systemType.create({ data: { name: `Type A ${suffix}` } });
    const typeB = await prisma.systemType.create({ data: { name: `Type B ${suffix}` } });
    typeAId = typeA.id;
    typeBId = typeB.id;

    const onlyA = await prisma.requirement.create({
      data: {
        code: `TC-A-${suffix}`,
        title: "Only for Type A",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        systemTypes: { connect: [{ id: typeAId }] },
      },
    });
    const onlyB = await prisma.requirement.create({
      data: {
        code: `TC-B-${suffix}`,
        title: "Only for Type B",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        systemTypes: { connect: [{ id: typeBId }] },
      },
    });
    const both = await prisma.requirement.create({
      data: {
        code: `TC-BOTH-${suffix}`,
        title: "Applies to every Type",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    onlyAId = onlyA.id;
    onlyBId = onlyB.id;
    bothId = both.id;
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({ where: { id: { in: [onlyAId, onlyBId, bothId] } } });
    await prisma.systemType.deleteMany({ where: { id: { in: [typeAId, typeBId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_OWNER_EMAIL, ADMIN_EMAIL] } } });
  });

  beforeEach(async () => {
    const system = await prisma.system.create({
      data: { name: "Type Change System", systemTypeId: typeAId, ownerId, status: "DRAFT" },
    });
    systemId = system.id;
  });

  afterEach(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await PATCH(requestAs(systemId, null, { systemTypeId: typeBId }), ctxFor(systemId));
    expect(response.status).toBe(401);
  });

  it("forbids a SYSTEM_OWNER who doesn't own this System", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED" } });
    const response = await PATCH(
      requestAs(systemId, otherOwnerId, { systemTypeId: typeBId }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(403);
  });

  it("rejects changing Type on a System that isn't Draft", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "IN_REVIEW" } });
    const response = await PATCH(requestAs(systemId, ownerId, { systemTypeId: typeBId }), ctxFor(systemId));
    expect(response.status).toBe(400);
  });

  it("rejects an unknown systemTypeId", async () => {
    const response = await PATCH(
      requestAs(systemId, ownerId, { systemTypeId: "does-not-exist" }),
      ctxFor(systemId),
    );
    expect(response.status).toBe(400);
  });

  it("creates NOT_STARTED rows for newly-applicable Requirements and removes untouched no-longer-applicable ones", async () => {
    const response = await PATCH(requestAs(systemId, ownerId, { systemTypeId: typeBId }), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.system.systemTypeId).toBe(typeBId);
    expect(body.added).toBe(1);
    expect(body.removed).toBe(0);

    const onlyBAssessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: onlyBId } },
    });
    expect(onlyBAssessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });

    const onlyAAssessment = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: onlyAId } },
    });
    expect(onlyAAssessment).toBeNull();
  });

  it("leaves a manually-touched no-longer-applicable Assessment in place instead of deleting it", async () => {
    await prisma.requirementAssessment.create({
      data: {
        systemId,
        requirementId: onlyAId,
        status: "FULFILLED",
        assessedById: ownerId,
        assessedAt: new Date(),
      },
    });

    const response = await PATCH(requestAs(systemId, ownerId, { systemTypeId: typeBId }), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.removed).toBe(0);

    const stillThere = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: onlyAId } },
    });
    expect(stillThere).not.toBeNull();
    expect(stillThere?.status).toBe("FULFILLED");
  });

  it("does not touch an Assessment for a Requirement applicable to both Types", async () => {
    await prisma.requirementAssessment.create({
      data: { systemId, requirementId: bothId, status: "IN_PROGRESS" },
    });

    await PATCH(requestAs(systemId, ownerId, { systemTypeId: typeBId }), ctxFor(systemId));

    const stillThere = await prisma.requirementAssessment.findUnique({
      where: { systemId_requirementId: { systemId, requirementId: bothId } },
    });
    expect(stillThere?.status).toBe("IN_PROGRESS");
  });

  it("lets an ADMIN change any Draft System's Type", async () => {
    const response = await PATCH(requestAs(systemId, adminId, { systemTypeId: typeBId }), ctxFor(systemId));
    expect(response.status).toBe(200);
  });
});

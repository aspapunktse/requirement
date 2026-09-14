import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

const OWNER_EMAIL = "test-system-assessments-owner@example.com";
const VIEWER_EMAIL = "test-system-assessments-viewer@example.com";

function urlFor(id: string) {
  return `http://localhost/api/systems/${id}/assessments`;
}

function requestAs(id: string, userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(urlFor(id), { headers });
}

function ctxFor(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/systems/[id]/assessments", () => {
  let ownerId: string;
  let viewerId: string;
  let matchingTypeId: string;
  let otherTypeId: string;
  let systemId: string;
  const requirementIds: string[] = [];

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "System Assessments Owner", role: "SYSTEM_OWNER" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "System Assessments Viewer", role: "VIEWER" },
    });
    ownerId = owner.id;
    viewerId = viewer.id;

    const matchingType = await prisma.systemType.create({
      data: { name: `Test Assessments Matching Type ${Date.now()}` },
    });
    const otherType = await prisma.systemType.create({
      data: { name: `Test Assessments Other Type ${Date.now()}` },
    });
    matchingTypeId = matchingType.id;
    otherTypeId = otherType.id;

    const system = await prisma.system.create({
      data: { name: "Assessments Test System", systemTypeId: matchingTypeId, ownerId, status: "DRAFT" },
    });
    systemId = system.id;

    const suffix = Date.now();
    const organizational = await prisma.requirement.create({
      data: {
        code: `ORG-${suffix}`,
        title: "Organizational Requirement",
        description: "Org scoped, never assessed per System",
        category: "Security",
        applicability: "ORGANIZATIONAL",
      },
    });
    const unscopedPerSystem = await prisma.requirement.create({
      data: {
        code: `PS-UNSCOPED-${suffix}`,
        title: "Unscoped Per-System Requirement",
        description: "Applies to every System Type",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    const matchingScoped = await prisma.requirement.create({
      data: {
        code: `PS-MATCH-${suffix}`,
        title: "Matching-Type Requirement",
        description: "Scoped to the matching Type",
        category: "Security",
        applicability: "BOTH",
        systemTypes: { connect: [{ id: matchingTypeId }] },
      },
    });
    const otherScoped = await prisma.requirement.create({
      data: {
        code: `PS-OTHER-${suffix}`,
        title: "Other-Type Requirement",
        description: "Scoped to a different Type",
        category: "Security",
        applicability: "PER_SYSTEM",
        systemTypes: { connect: [{ id: otherTypeId }] },
      },
    });
    requirementIds.push(organizational.id, unscopedPerSystem.id, matchingScoped.id, otherScoped.id);
  });

  afterAll(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({ where: { id: { in: requirementIds } } });
    await prisma.systemType.deleteMany({ where: { id: { in: [matchingTypeId, otherTypeId] } } });
    await prisma.user.deleteMany({ where: { email: { in: [OWNER_EMAIL, VIEWER_EMAIL] } } });
  });

  afterEach(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(systemId, null), ctxFor(systemId));
    expect(response.status).toBe(401);
  });

  it("returns 404 for a System the acting user cannot see", async () => {
    const response = await GET(requestAs(systemId, viewerId), ctxFor(systemId));
    expect(response.status).toBe(404);
  });

  it("lists only Requirements applicable to the System's Type, excluding ORGANIZATIONAL ones", async () => {
    const response = await GET(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();

    expect(response.status).toBe(200);
    const ids = body.assessments.map((a: { requirement: { id: string } }) => a.requirement.id);

    expect(ids).toContain(requirementIds[1]); // unscoped
    expect(ids).toContain(requirementIds[2]); // matching-type scoped
    expect(ids).not.toContain(requirementIds[0]); // organizational
    expect(ids).not.toContain(requirementIds[3]); // other-type scoped
  });

  it("defaults an untouched Requirement's assessment to NOT_STARTED with no assessment id", async () => {
    const response = await GET(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();
    const row = body.assessments.find(
      (a: { requirement: { id: string } }) => a.requirement.id === requirementIds[1],
    );

    expect(row.assessment).toBeNull();
  });

  it("surfaces a recorded Assessment for a no-longer-applicable Requirement as stale, not in the main list", async () => {
    const staleRequirementId = requirementIds[3]; // other-type scoped, not applicable to this System
    await prisma.requirementAssessment.create({
      data: { systemId, requirementId: staleRequirementId, status: "FULFILLED" },
    });

    const response = await GET(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();

    const mainIds = body.assessments.map((a: { requirement: { id: string } }) => a.requirement.id);
    expect(mainIds).not.toContain(staleRequirementId);

    const staleIds = body.staleAssessments.map((a: { requirement: { id: string } }) => a.requirement.id);
    expect(staleIds).toContain(staleRequirementId);
  });
});

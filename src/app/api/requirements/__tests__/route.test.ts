import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";

const URL = "http://localhost/api/requirements";
const VIEWER_EMAIL = "test-requirements-list-viewer@example.com";

function testRequirement(
  overrides: Partial<Prisma.RequirementCreateInput> & { code: string },
): Prisma.RequirementCreateInput {
  return {
    title: "Test requirement",
    description: "A requirement created for this test.",
    category: "Test",
    framework: ["ISO27001:2022 Annex A"],
    mandatory: true,
    applicability: "BOTH",
    question: null,
    intent: null,
    examples: [],
    ...overrides,
  };
}

function requestAs(userId: string | null) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(URL, { headers });
}

describe("GET /api/requirements", () => {
  const orgCode = "TEST-ORG-001";
  const perSystemCode = "TEST-SYS-001";
  let viewerId: string;

  beforeAll(async () => {
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Requirements List Viewer", role: "VIEWER" },
    });
    viewerId = viewer.id;

    const org = testRequirement({
      code: orgCode,
      applicability: "ORGANIZATIONAL",
    });
    const perSystem = testRequirement({
      code: perSystemCode,
      applicability: "BOTH",
      question: "Does your system do the thing?",
      intent: "Because the thing matters.",
      examples: ["An example way to do the thing"],
    });

    await prisma.requirement.upsert({ where: { code: orgCode }, update: {}, create: org });
    await prisma.requirement.upsert({
      where: { code: perSystemCode },
      update: {},
      create: perSystem,
    });
  });

  afterAll(async () => {
    await prisma.requirement.deleteMany({ where: { code: { in: [orgCode, perSystemCode] } } });
    await prisma.user.deleteMany({ where: { email: VIEWER_EMAIL } });
  });

  it("rejects an unauthenticated request", async () => {
    const response = await GET(requestAs(null));
    expect(response.status).toBe(401);
  });

  it("returns an ORGANIZATIONAL requirement with no question/intent/examples", async () => {
    const response = await GET(requestAs(viewerId));
    const body = await response.json();

    const org = body.requirements.find((r: { code: string }) => r.code === orgCode);
    expect(org).toMatchObject({
      code: orgCode,
      applicability: "ORGANIZATIONAL",
      question: null,
      intent: null,
      examples: [],
      deploymentFacets: [],
      capabilities: [],
    });
  });

  it("returns a PER_SYSTEM/BOTH requirement with its question, intent, and examples", async () => {
    const response = await GET(requestAs(viewerId));
    const body = await response.json();

    const perSystem = body.requirements.find((r: { code: string }) => r.code === perSystemCode);
    expect(perSystem).toMatchObject({
      code: perSystemCode,
      applicability: "BOTH",
      question: "Does your system do the thing?",
      intent: "Because the thing matters.",
      examples: ["An example way to do the thing"],
    });
  });
});

describe("POST /api/requirements", () => {
  const ADMIN_EMAIL = "test-requirements-create-admin@example.com";
  let adminId: string;
  let viewerId: string;
  const createdCodes: string[] = [];

  beforeAll(async () => {
    const admin = await prisma.user.upsert({
      where: { email: ADMIN_EMAIL },
      update: {},
      create: { email: ADMIN_EMAIL, name: "Requirements Create Admin", role: "ADMIN" },
    });
    const viewer = await prisma.user.upsert({
      where: { email: VIEWER_EMAIL },
      update: {},
      create: { email: VIEWER_EMAIL, name: "Requirements List Viewer", role: "VIEWER" },
    });
    adminId = admin.id;
    viewerId = viewer.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: ADMIN_EMAIL } });
  });

  afterEach(async () => {
    await prisma.requirement.deleteMany({ where: { code: { in: createdCodes } } });
    createdCodes.length = 0;
  });

  function requestPost(userId: string | null, body: unknown) {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
    return new NextRequest(URL, { method: "POST", headers, body: JSON.stringify(body) });
  }

  it("rejects a non-admin", async () => {
    const response = await POST(
      requestPost(viewerId, {
        code: "TEST-CREATE-001",
        title: "t",
        description: "d",
        category: "Security",
        applicability: "ORGANIZATIONAL",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("creates a Requirement with a multi-value framework list", async () => {
    const code = "TEST-CREATE-002";
    createdCodes.push(code);

    const response = await POST(
      requestPost(adminId, {
        code,
        title: "Encryption at rest",
        description: "desc",
        category: "Security",
        framework: ["ISO27001:2022 Annex A", "CSA CCM 4.0"],
        applicability: "ORGANIZATIONAL",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.requirement).toMatchObject({
      code,
      framework: ["ISO27001:2022 Annex A", "CSA CCM 4.0"],
      mandatory: true,
      examples: [],
    });
  });

  it("rejects a PER_SYSTEM/BOTH Requirement with no Self-Assessment Question", async () => {
    const response = await POST(
      requestPost(adminId, {
        code: "TEST-CREATE-003",
        title: "t",
        description: "d",
        category: "Security",
        applicability: "PER_SYSTEM",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a duplicate code", async () => {
    const code = "TEST-CREATE-004";
    createdCodes.push(code);
    const payload = {
      code,
      title: "t",
      description: "d",
      category: "Security",
      applicability: "ORGANIZATIONAL",
    };

    await POST(requestPost(adminId, payload));
    const response = await POST(requestPost(adminId, payload));
    expect(response.status).toBe(409);
  });
});

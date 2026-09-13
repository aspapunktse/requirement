import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

const URL = "http://localhost/api/requirements";
const VIEWER_EMAIL = "test-requirements-list-viewer@example.com";

function testRequirement(
  overrides: Partial<Prisma.RequirementCreateInput> & { code: string },
): Prisma.RequirementCreateInput {
  return {
    title: "Test requirement",
    description: "A requirement created for this test.",
    category: "Test",
    framework: "ISO27001:2022 Annex A",
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
      systemTypes: [],
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

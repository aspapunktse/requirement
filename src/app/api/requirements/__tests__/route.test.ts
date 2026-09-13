import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "../route";

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

describe("GET /api/requirements", () => {
  const orgCode = "TEST-ORG-001";
  const perSystemCode = "TEST-SYS-001";

  beforeAll(async () => {
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
  });

  it("returns an ORGANIZATIONAL requirement with no question/intent/examples", async () => {
    const response = await GET();
    const body = await response.json();

    const org = body.requirements.find((r: { code: string }) => r.code === orgCode);
    expect(org).toMatchObject({
      code: orgCode,
      applicability: "ORGANIZATIONAL",
      question: null,
      intent: null,
      examples: [],
    });
  });

  it("returns a PER_SYSTEM/BOTH requirement with its question, intent, and examples", async () => {
    const response = await GET();
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

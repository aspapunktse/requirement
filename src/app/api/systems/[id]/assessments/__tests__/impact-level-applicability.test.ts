import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

const OWNER_EMAIL = "test-impact-applicability-owner@example.com";

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

describe("Impact Level threshold applicability", () => {
  let ownerId: string;
  let facetId: string;
  let systemId: string;
  const requirementIds: string[] = [];
  let noThresholdId: string;
  let highConfidentialityId: string;
  let criticalAvailabilityId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {},
      create: { email: OWNER_EMAIL, name: "Impact Applicability Owner", role: "SYSTEM_OWNER" },
    });
    ownerId = owner.id;

    const facet = await prisma.deploymentFacet.create({
      data: { name: `Impact Applicability Facet ${Date.now()}` },
    });
    facetId = facet.id;

    const system = await prisma.system.create({
      data: {
        name: "Impact Applicability System",
        deploymentFacets: { connect: [{ id: facetId }] },
        ownerId,
        status: "DRAFT",
        confidentialityImpactLevel: "MODERATE",
      },
    });
    systemId = system.id;

    const suffix = Date.now();
    const noThreshold = await prisma.requirement.create({
      data: {
        code: `IMP-NONE-${suffix}`,
        title: "No Impact threshold",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
      },
    });
    const highConfidentiality = await prisma.requirement.create({
      data: {
        code: `IMP-CONF-${suffix}`,
        title: "Requires High Confidentiality",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        minConfidentialityImpactLevel: "HIGH",
      },
    });
    const criticalAvailability = await prisma.requirement.create({
      data: {
        code: `IMP-AVAIL-${suffix}`,
        title: "Requires Critical Availability",
        description: "desc",
        category: "Security",
        applicability: "PER_SYSTEM",
        minAvailabilityImpactLevel: "CRITICAL",
      },
    });
    noThresholdId = noThreshold.id;
    highConfidentialityId = highConfidentiality.id;
    criticalAvailabilityId = criticalAvailability.id;
    requirementIds.push(noThresholdId, highConfidentialityId, criticalAvailabilityId);
  });

  afterAll(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.requirement.deleteMany({ where: { id: { in: requirementIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { email: OWNER_EMAIL } });
  });

  afterEach(async () => {
    await prisma.requirementAssessment.deleteMany({ where: { systemId } });
  });

  it("includes a Requirement with no Impact threshold regardless of the System's declared levels", async () => {
    const response = await GET(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();
    const ids = body.assessments.map((a: { requirement: { id: string } }) => a.requirement.id);
    expect(ids).toContain(noThresholdId);
  });

  it("excludes a Requirement whose threshold on a null-classified axis isn't met", async () => {
    const response = await GET(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();
    const ids = body.assessments.map((a: { requirement: { id: string } }) => a.requirement.id);
    // System's availabilityImpactLevel is null (not yet classified) — a CRITICAL threshold isn't met.
    expect(ids).not.toContain(criticalAvailabilityId);
  });

  it("excludes a Requirement whose threshold exceeds the System's declared level on that axis", async () => {
    const response = await GET(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();
    const ids = body.assessments.map((a: { requirement: { id: string } }) => a.requirement.id);
    // System's confidentialityImpactLevel is MODERATE, Requirement needs HIGH.
    expect(ids).not.toContain(highConfidentialityId);
  });

  it("includes a Requirement once the System's declared level meets the threshold", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { confidentialityImpactLevel: "CRITICAL" } });

    const response = await GET(requestAs(systemId, ownerId), ctxFor(systemId));
    const body = await response.json();
    const ids = body.assessments.map((a: { requirement: { id: string } }) => a.requirement.id);
    expect(ids).toContain(highConfidentialityId);

    await prisma.system.update({ where: { id: systemId }, data: { confidentialityImpactLevel: "MODERATE" } });
  });
});

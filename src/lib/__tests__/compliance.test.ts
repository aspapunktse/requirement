import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getComplianceForSystems } from "../compliance";

describe("getComplianceForSystems", () => {
  const suffix = Date.now();
  let ownerId: string;
  let businessUnitId: string;
  let facetId: string;
  let lenientFrameworkId: string;
  let strictFrameworkId: string;
  let reqAId: string;
  let reqBId: string;
  let optionalId: string;
  let systemAId: string;
  let systemBId: string;

  beforeAll(async () => {
    const owner = await prisma.user.upsert({
      where: { email: `test-compliance-owner-${suffix}@example.com` },
      update: {},
      create: {
        email: `test-compliance-owner-${suffix}@example.com`,
        name: "Compliance Test Owner",
        role: "SYSTEM_OWNER",
      },
    });
    ownerId = owner.id;

    const businessUnit = await prisma.businessUnit.create({ data: { name: `Test Compliance BU ${suffix}` } });
    businessUnitId = businessUnit.id;

    // Every test below filters by frameworkId — that's what actually
    // isolates these fixtures from the real seeded ISO 27001 catalog (and
    // any other concurrently-running test file's fixtures), since an
    // *unscoped* mandatory Control applies to every System regardless
    // of facet, and this app has no per-test database. Only Controls
    // mapped to this test's own unique Framework rows can ever enter the
    // computation. A Control is "in" a Framework when it's mapped to one of
    // that Framework's Requirements (ADR 0005). See HANDOFF.md's note on
    // this exact isolation gotcha.
    const facet = await prisma.deploymentFacet.create({ data: { name: `Test Compliance Facet ${suffix}` } });
    facetId = facet.id;

    const lenientFramework = await prisma.framework.create({
      data: { name: `Test Lenient Framework ${suffix}`, version: "1", strictComplianceRequired: false },
    });
    const strictFramework = await prisma.framework.create({
      data: { name: `Test Strict Framework ${suffix}`, version: "1", strictComplianceRequired: true },
    });
    lenientFrameworkId = lenientFramework.id;
    strictFrameworkId = strictFramework.id;

    // reqA: unscoped on facet, so it applies to every System regardless of
    // declared facets (including System B, which declares none of ours).
    const reqA = await prisma.control.create({
      data: {
        code: `TEST-COMPLIANCE-A-${suffix}`,
        title: "Applies everywhere",
        description: "d",
        category: "Test",
        applicability: "BOTH",
        mandatory: true,
      },
    });
    // reqB: scoped to facetId, so it only applies to Systems that declare
    // it (System A) — gives A and B different applicable totals, which is
    // what actually distinguishes "pooled" from "averaged".
    const reqB = await prisma.control.create({
      data: {
        code: `TEST-COMPLIANCE-B-${suffix}`,
        title: "Applies only where facetId is declared",
        description: "d",
        category: "Test",
        applicability: "BOTH",
        mandatory: true,
        deploymentFacets: { connect: { id: facetId } },
      },
    });
    const optional = await prisma.control.create({
      data: {
        code: `TEST-COMPLIANCE-OPTIONAL-${suffix}`,
        title: "Optional, mapped but not mandatory",
        description: "d",
        category: "Test",
        applicability: "BOTH",
        mandatory: false,
        deploymentFacets: { connect: { id: facetId } },
      },
    });
    reqAId = reqA.id;
    reqBId = reqB.id;
    optionalId = optional.id;

    // One Requirement per Framework (plus a second lenient one), mapped to the Controls above.
    async function requirementOf(frameworkId: string, code: string) {
      return prisma.requirement.create({
        data: { frameworkId, code, section: "Test", title: code, text: "t" },
      });
    }
    const lenient1 = await requirementOf(lenientFrameworkId, "L.1");
    const lenient2 = await requirementOf(lenientFrameworkId, "L.2");
    const lenient3 = await requirementOf(lenientFrameworkId, "L.3");
    const strict1 = await requirementOf(strictFrameworkId, "S.1");
    await prisma.controlMapping.createMany({
      data: [
        { requirementId: lenient1.id, controlId: reqAId, coverage: "FULL" },
        // A PARTIAL mapping still puts the Control in the Framework's scope (like-for-like with the old tag).
        { requirementId: lenient2.id, controlId: reqBId, coverage: "PARTIAL" },
        { requirementId: lenient3.id, controlId: optionalId, coverage: "FULL" },
        { requirementId: strict1.id, controlId: reqBId, coverage: "FULL" },
      ],
    });

    const systemA = await prisma.system.create({
      data: {
        name: `Test Compliance System A ${suffix}`,
        ownerId,
        deploymentFacets: { connect: { id: facetId } },
        businessUnits: { connect: { id: businessUnitId } },
      },
    });
    const systemB = await prisma.system.create({
      data: { name: `Test Compliance System B ${suffix}`, ownerId },
    });
    systemAId = systemA.id;
    systemBId = systemB.id;

    await prisma.controlAssessment.createMany({
      data: [
        { systemId: systemAId, controlId: reqAId, status: "FULFILLED" },
        { systemId: systemAId, controlId: reqBId, status: "WAIVED" },
        { systemId: systemAId, controlId: optionalId, status: "FULFILLED" },
        // systemB's reqA is left with no Assessment row at all (NOT_STARTED by default).
        // systemB never declares facetId, so reqB isn't applicable to it at all.
      ],
    });
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: [systemAId, systemBId] } } });
    await prisma.system.deleteMany({ where: { id: { in: [systemAId, systemBId] } } });
    await prisma.control.deleteMany({ where: { id: { in: [reqAId, reqBId, optionalId] } } });
    await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
    await prisma.framework.deleteMany({ where: { id: { in: [lenientFrameworkId, strictFrameworkId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("counts Fulfilled and Waived as resolved (lenient), ignores non-mandatory Controls", async () => {
    const result = await getComplianceForSystems({ id: systemAId }, { frameworkId: lenientFrameworkId });

    // reqA + reqB; optional excluded despite being mapped, since it's not mandatory.
    expect(result.total).toBe(2);
    expect(result.resolved).toBe(2); // FULFILLED + WAIVED both count
    expect(result.percentage).toBe(100);
    expect(result.bySystem).toEqual([
      { systemId: systemAId, systemName: expect.any(String), resolved: 2, total: 2, percentage: 100 },
    ]);
  });

  it("pools resolved/total across every System rather than averaging their percentages", async () => {
    const result = await getComplianceForSystems(
      { id: { in: [systemAId, systemBId] } },
      { frameworkId: lenientFrameworkId },
    );

    // A: reqA FULFILLED + reqB WAIVED = 2/2 (100%). B: only reqA applies (no facetId
    // declared), left NOT_STARTED = 0/1 (0%). A simple average of the two systems'
    // percentages would be (100+0)/2 = 50 — pooling instead gives 2 resolved of 3 total.
    expect(result.total).toBe(3);
    expect(result.resolved).toBe(2);
    expect(result.percentage).toBe(66.7);
  });

  it("a strictComplianceRequired Framework only counts Fulfilled, not Waived", async () => {
    const result = await getComplianceForSystems({ id: systemAId }, { frameworkId: strictFrameworkId });

    // Only reqB is mapped to a Requirement of the strict Framework; it's WAIVED, which doesn't count under strict.
    expect(result.total).toBe(1);
    expect(result.resolved).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it("narrows to Controls mapped to a Requirement of the Framework, not another Framework's", async () => {
    // reqA is mapped only to the lenient Framework, so the strict one doesn't see it (and vice versa for
    // nothing here: reqB is mapped to both).
    const strict = await getComplianceForSystems({ id: systemBId }, { frameworkId: strictFrameworkId });
    // System B never declares facetId, so reqB (the only strict-mapped Control) isn't applicable to it.
    expect(strict.total).toBe(0);
    expect(strict.percentage).toBeNull();

    const lenient = await getComplianceForSystems({ id: systemBId }, { frameworkId: lenientFrameworkId });
    expect(lenient.total).toBe(1); // reqA only
  });

  it("stops counting a Control once its Control Mapping is removed", async () => {
    const mapping = await prisma.controlMapping.findFirstOrThrow({
      where: { controlId: reqAId, requirement: { frameworkId: lenientFrameworkId } },
    });
    await prisma.controlMapping.delete({ where: { id: mapping.id } });
    try {
      const result = await getComplianceForSystems({ id: systemAId }, { frameworkId: lenientFrameworkId });
      expect(result.total).toBe(1); // reqB only
    } finally {
      await prisma.controlMapping.create({
        data: { requirementId: mapping.requirementId, controlId: reqAId, coverage: "FULL" },
      });
    }
  });

  it("filters by Business Unit membership via the where clause", async () => {
    const result = await getComplianceForSystems(
      { businessUnits: { some: { id: businessUnitId } } },
      { frameworkId: lenientFrameworkId },
    );
    expect(result.bySystem.map((s) => s.systemId)).toEqual([systemAId]);
  });

  it("returns null percentage when there's nothing applicable to measure", async () => {
    const result = await getComplianceForSystems({ id: { in: [] } });
    expect(result).toEqual({ resolved: 0, total: 0, percentage: null, bySystem: [] });
  });
});

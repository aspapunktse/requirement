import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getComplianceForSystems } from "../compliance";

/**
 * The Requirement-based Compliance Percentage (#90): Met ÷ applicable Requirements
 * of one Framework, pooled across Systems. Fixtures (CI's DB is migrated, not
 * seeded): two Published non-base Frameworks (one lenient, one strict) whose
 * Requirements map to Deployment-Facet-scoped and Organizational Controls, four
 * Systems, and Assessments on one of them. Every figure is asserted for those
 * fixture Frameworks, which only the fixture Systems declare, so other files'
 * fixtures and the seeded catalog can't move them. Only the headline-is-the-base
 * test touches the base Framework: it asserts a delta on it inside one Repeatable
 * Read transaction that it rolls back, so concurrent base fixtures can't move it.
 *
 * Layout (Lenient Framework L / Strict Framework S):
 *   Controls:  cA (Facet 1), cB (Facet 2), cC (Facet 2), cOrg (Organizational, no
 *              implementation row: Not Started)
 *   L1 <- cA   L2 <- cB   L3 <- cA + cC   L4 <- cOrg      S1 <- cB   S2 <- cA
 *   System A: Facets 1+2; cA Fulfilled, cB Waived, cC In Progress
 *   System B: Facet 1 only; no Assessments
 *   System C: no Facets (no Per-System/Both Control applies); System D: declares neither Framework
 * Since #122 L4 counts on every System that has L in scope (A, B and C), as Not Met
 * while the Organization hasn't implemented cOrg.
 */
describe("getComplianceForSystems", () => {
  const suffix = Date.now();
  let ownerId: string;
  let businessUnitId: string;
  let facet1Id: string;
  let facet2Id: string;
  let lenientId: string;
  let strictId: string;
  let cA: string;
  let cB: string;
  let cC: string;
  let cOrg: string;
  let l1Id: string;
  let systemAId: string;
  let systemBId: string;
  let systemCId: string;
  let systemDId: string;
  const controlIds: string[] = [];

  beforeAll(async () => {
    ownerId = (
      await prisma.user.create({
        data: { email: `test-compliance-owner-${suffix}@example.com`, name: "Compliance Test Owner", role: "SYSTEM_OWNER" },
      })
    ).id;
    businessUnitId = (await prisma.businessUnit.create({ data: { name: `Test Compliance BU ${suffix}` } })).id;
    facet1Id = (await prisma.deploymentFacet.create({ data: { name: `Test Compliance Facet 1 ${suffix}` } })).id;
    facet2Id = (await prisma.deploymentFacet.create({ data: { name: `Test Compliance Facet 2 ${suffix}` } })).id;

    lenientId = (
      await prisma.framework.create({
        data: { name: `Test Lenient Framework ${suffix}`, version: "1", strictComplianceRequired: false, status: "PUBLISHED" },
      })
    ).id;
    strictId = (
      await prisma.framework.create({
        data: { name: `Test Strict Framework ${suffix}`, version: "1", strictComplianceRequired: true, status: "PUBLISHED" },
      })
    ).id;

    async function control(key: string, facetIds: string[], applicability: "BOTH" | "ORGANIZATIONAL") {
      const created = await prisma.control.create({
        data: {
          code: `TEST-COMPLIANCE-${key}-${suffix}`,
          title: `Test compliance ${key}`,
          description: "d",
          category: "Test",
          applicability,
          mandatory: true,
          deploymentFacets: { connect: facetIds.map((id) => ({ id })) },
        },
      });
      controlIds.push(created.id);
      return created.id;
    }
    cA = await control("A", [facet1Id], "BOTH");
    cB = await control("B", [facet2Id], "BOTH");
    cC = await control("C", [facet2Id], "BOTH");
    cOrg = await control("ORG", [], "ORGANIZATIONAL");

    async function requirement(frameworkId: string, code: string, mapped: string[]) {
      const created = await prisma.requirement.create({
        data: {
          frameworkId,
          code,
          section: "Test",
          title: code,
          text: "t",
          mappings: { create: mapped.map((controlId) => ({ controlId, coverage: "FULL" as const })) },
        },
      });
      return created.id;
    }
    l1Id = await requirement(lenientId, "L.1", [cA]);
    await requirement(lenientId, "L.2", [cB]);
    await requirement(lenientId, "L.3", [cA, cC]);
    await requirement(lenientId, "L.4", [cOrg]);
    await requirement(strictId, "S.1", [cB]);
    await requirement(strictId, "S.2", [cA]);

    const scopes = { connect: [{ id: lenientId }, { id: strictId }] };
    const system = async (name: string, data: Record<string, unknown>) =>
      (await prisma.system.create({ data: { name: `Test Compliance System ${name} ${suffix}`, ownerId, ...data } })).id;
    systemAId = await system("A", {
      frameworkScopes: scopes,
      deploymentFacets: { connect: [{ id: facet1Id }, { id: facet2Id }] },
      businessUnits: { connect: { id: businessUnitId } },
    });
    systemBId = await system("B", { frameworkScopes: scopes, deploymentFacets: { connect: { id: facet1Id } } });
    systemCId = await system("C", { frameworkScopes: scopes });
    systemDId = await system("D", { deploymentFacets: { connect: [{ id: facet1Id }, { id: facet2Id }] } });

    await prisma.controlAssessment.createMany({
      data: [
        { systemId: systemAId, controlId: cA, status: "FULFILLED" },
        { systemId: systemAId, controlId: cB, status: "WAIVED" },
        { systemId: systemAId, controlId: cC, status: "IN_PROGRESS" },
      ],
    });
  });

  afterAll(async () => {
    const systemIds = [systemAId, systemBId, systemCId, systemDId];
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.framework.deleteMany({ where: { id: { in: [lenientId, strictId] } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.businessUnit.deleteMany({ where: { id: businessUnitId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facet1Id, facet2Id] } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  const figure = (result: Awaited<ReturnType<typeof getComplianceForSystems>>, systemId: string) => {
    const s = result.bySystem.find((x) => x.systemId === systemId);
    return s && { met: s.met, applicable: s.applicable, percentage: s.percentage };
  };

  it("is Met ÷ applicable Requirements: Waived counts (lenient), Partially Met does not, Not Applicable is left out", async () => {
    const result = await getComplianceForSystems({ id: systemAId }, { frameworkId: lenientId });

    // A: L1 Met (cA Fulfilled), L2 Met (cB Waived, lenient), L3 Partially Met (cA Fulfilled, cC In Progress),
    // L4 Not Met (only an Organizational Control, Not Started; counted since #122). Met 2 of 4 applicable;
    // the Partially Met one is not Met. Nothing is Not Applicable here.
    expect(result.framework).toMatchObject({ id: lenientId, isBase: false, strictComplianceRequired: false });
    expect(result.met).toBe(2);
    expect(result.applicable).toBe(4);
    expect(result.percentage).toBe(50);
    expect(result.bySystem).toEqual([
      { systemId: systemAId, systemName: expect.any(String), met: 2, applicable: 4, percentage: 50 },
    ]);
  });

  it("pools Met and applicable across Systems rather than averaging their percentages", async () => {
    const result = await getComplianceForSystems({ id: { in: [systemAId, systemBId] } }, { frameworkId: lenientId });

    // A: 2 of 4 (50%). B (Facet 1 only, no Assessments): L1 Not Met, L2 Not Applicable (cB needs Facet 2),
    // L3 Not Met (only cA applies, not started), L4 Not Met (the Organizational Control counts): 0 of 3.
    // Pooled 2 of 7 = 28.6%; an average of the two percentages would be 25%.
    expect(figure(result, systemAId)).toEqual({ met: 2, applicable: 4, percentage: 50 });
    expect(figure(result, systemBId)).toEqual({ met: 0, applicable: 3, percentage: 0 });
    expect(result.met).toBe(2);
    expect(result.applicable).toBe(7);
    expect(result.percentage).toBe(28.6);
  });

  it("a strictComplianceRequired Framework does not count Waived as fulfilled", async () => {
    const result = await getComplianceForSystems({ id: systemAId }, { frameworkId: strictId });

    // S1's only Control (cB) is Waived: Not Met under strict (it was Met under the lenient Framework's L2). S2 is Met.
    expect(result.framework?.strictComplianceRequired).toBe(true);
    expect(result.met).toBe(1);
    expect(result.applicable).toBe(2);
    expect(result.percentage).toBe(50);
  });

  it("is null, not 0, when no Requirement is applicable to a System, and such a System adds nothing to the pool", async () => {
    // C has both Frameworks in scope but no Facet, so every Per-System/Both Control mapped to the strict Framework
    // (it has no Organizational Control, which would count on C) is out of scope for it.
    const alone = await getComplianceForSystems({ id: systemCId }, { frameworkId: strictId });
    expect(alone).toMatchObject({ met: 0, applicable: 0, percentage: null });
    expect(figure(alone, systemCId)).toEqual({ met: 0, applicable: 0, percentage: null });

    // A: S1 Not Met (cB Waived, strict), S2 Met: 1 of 2.
    const pooled = await getComplianceForSystems({ id: { in: [systemAId, systemCId] } }, { frameworkId: strictId });
    expect(pooled.percentage).toBe(50);
    expect(figure(pooled, systemCId)?.percentage).toBeNull();
  });

  it("leaves a System without the Framework in its scope out of the figures, listing it with a null percentage", async () => {
    // D has the Facets but never declared L, so none of L's Requirements is in scope there (not a 0%).
    const result = await getComplianceForSystems({ id: { in: [systemAId, systemDId] } }, { frameworkId: lenientId });
    expect(figure(result, systemDId)).toEqual({ met: 0, applicable: 0, percentage: null });
    expect(result.met).toBe(2);
    expect(result.applicable).toBe(4);
  });

  it("keeps a Requirement whose mappings were all removed in the denominator, as Not Met", async () => {
    const mapping = await prisma.controlMapping.findFirstOrThrow({ where: { requirementId: l1Id, controlId: cA } });
    await prisma.controlMapping.delete({ where: { id: mapping.id } });
    try {
      const result = await getComplianceForSystems({ id: systemAId }, { frameworkId: lenientId });
      // L1 has no mapped Controls at all: Not Met (an unmapped Framework must not look compliant). L2 is still Met.
      expect(result.met).toBe(1);
      expect(result.applicable).toBe(4);
    } finally {
      await prisma.controlMapping.create({ data: { requirementId: l1Id, controlId: cA, coverage: "FULL" } });
    }
  });

  it("filters the Systems by the where clause (Business Unit membership)", async () => {
    const result = await getComplianceForSystems(
      { businessUnits: { some: { id: businessUnitId } } },
      { frameworkId: lenientId },
    );
    expect(result.bySystem.map((s) => s.systemId)).toEqual([systemAId]);
  });

  it("with no Framework filter the figures are for the base Framework, which is in every System's scope", async () => {
    // Both reads and the extra base Requirement share one Repeatable Read snapshot, so other test files' base
    // fixtures, committed meanwhile, can't move the delta (#231). The transaction is rolled back at the end.
    const rolledBack = new Error("roll back the fixture base Requirement");
    await expect(
      prisma.$transaction(
        async (tx) => {
          const base = await tx.framework.findFirstOrThrow({ where: { isBase: true } });
          const systems = { id: { in: [systemAId, systemBId, systemDId] } };
          const before = await getComplianceForSystems(systems, {}, tx);
          expect(before.framework).toMatchObject({ id: base.id, isBase: true });
          // No stored scope row for the base on any fixture System, yet all three are measured against it.
          expect(before.bySystem.map((s) => s.systemId).sort()).toEqual([systemAId, systemBId, systemDId].sort());

          // One more base Requirement, mapped to cA (Facet 1): applicable on A, B and D, Met only on A (Fulfilled).
          await tx.requirement.create({
            data: {
              frameworkId: base.id,
              code: `TEST-COMPLIANCE-BASE-${suffix}`,
              section: "Test",
              title: "Test compliance base Requirement",
              text: "t",
              mappings: { create: [{ controlId: cA, coverage: "FULL" }] },
            },
          });
          const after = await getComplianceForSystems(systems, {}, tx);
          expect(figure(after, systemAId)!.applicable).toBe(figure(before, systemAId)!.applicable + 1);
          expect(figure(after, systemAId)!.met).toBe(figure(before, systemAId)!.met + 1);
          expect(figure(after, systemBId)!.applicable).toBe(figure(before, systemBId)!.applicable + 1);
          expect(figure(after, systemBId)!.met).toBe(figure(before, systemBId)!.met);
          expect(figure(after, systemDId)!.applicable).toBe(figure(before, systemDId)!.applicable + 1);
          expect(after.applicable).toBe(before.applicable + 3);
          expect(after.met).toBe(before.met + 1);
          throw rolledBack;
        },
        { isolationLevel: "RepeatableRead", timeout: 30_000 },
      ),
    ).rejects.toBe(rolledBack);
  });

  it("returns an empty, null-percentage result for no Systems, and for an unknown Framework", async () => {
    const none = await getComplianceForSystems({ id: { in: [] } });
    expect(none).toMatchObject({ met: 0, applicable: 0, percentage: null, bySystem: [] });
    expect(none.framework?.isBase).toBe(true);

    const unknown = await getComplianceForSystems({ id: systemAId }, { frameworkId: "no-such-framework" });
    expect(unknown).toMatchObject({ framework: null, met: 0, applicable: 0, percentage: null });
    expect(unknown.bySystem).toHaveLength(1);
  });
});

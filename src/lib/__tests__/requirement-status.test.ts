import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getApplicableControls } from "@/lib/control-assessments";
import {
  addDerivedStatusCounts,
  countRowStatuses,
  deriveFrameworkStatusesForSystems,
  getSystemFrameworkRequirements,
  isFrameworkInEffectiveScope,
  type DerivationSystem,
  type DerivedRequirementRow,
} from "@/lib/requirement-status";
import { mapControlsToFramework } from "@/test/framework-fixtures";

/**
 * Derived Requirement status against real Postgres (#89). CI's DB is migrated
 * but NOT seeded, so everything here is a fixture with a unique `Test …` name:
 * a Published non-base Framework whose Requirements are mapped to Deployment
 * Facet-scoped (or Organizational) fixture Controls, put in the scope of the
 * fixture Systems. Nothing touches the seeded base Framework or its mappings,
 * and every assertion is by fixture id.
 */
describe("derived Requirement status", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let ownerId: string;
  let facetId: string;
  let frameworkId: string;
  let draftFrameworkId: string;
  let controlIds: { a1: string; a2: string; org: string; high: string };
  const requirementIds = {} as Record<"r1" | "r2" | "r3" | "r4" | "r5" | "r6" | "r7", string>;
  const systemIds = {} as Record<"with" | "without" | "noScope" | "high", string>;

  async function classification(id: string): Promise<DerivationSystem> {
    return prisma.system.findUniqueOrThrow({
      where: { id },
      include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
    });
  }

  async function rowsFor(systemKey: keyof typeof systemIds) {
    const result = await deriveFrameworkStatusesForSystems(frameworkId, [await classification(systemIds[systemKey])]);
    const rows = result!.bySystem.get(systemIds[systemKey])!;
    return new Map(rows.map((row) => [row.requirementId, row]));
  }

  beforeAll(async () => {
    const owner = await prisma.user.create({
      data: { email: `test-reqstatus-${suffix}@example.com`, name: "Test ReqStatus Owner", role: "SYSTEM_OWNER" },
    });
    ownerId = owner.id;
    const facet = await prisma.deploymentFacet.create({ data: { name: `Test ReqStatus Facet ${suffix}` } });
    facetId = facet.id;

    const framework = await prisma.framework.create({
      data: { name: `Test ReqStatus Framework ${suffix}`, version: "1", status: "PUBLISHED" },
    });
    frameworkId = framework.id;
    const draft = await prisma.framework.create({
      data: { name: `Test ReqStatus Draft ${suffix}`, version: "1", status: "DRAFT" },
    });
    draftFrameworkId = draft.id;

    const control = (code: string, extra: object = {}) =>
      prisma.control.create({
        data: {
          code: `TEST-REQSTATUS-${code}-${suffix}`,
          title: `Test ReqStatus ${code}`,
          description: "d",
          category: "Test",
          applicability: "PER_SYSTEM",
          ...extra,
        },
      });
    // Facet-scoped, so they only ever apply to Systems declaring the fixture facet (no leak into other test files).
    const a1 = await control("A1", { deploymentFacets: { connect: { id: facetId } } });
    const a2 = await control("A2", { deploymentFacets: { connect: { id: facetId } } });
    const high = await control("HIGH", {
      deploymentFacets: { connect: { id: facetId } },
      minConfidentialityImpactLevel: "HIGH",
    });
    const org = await control("ORG", { applicability: "ORGANIZATIONAL" });
    controlIds = { a1: a1.id, a2: a2.id, org: org.id, high: high.id };

    // R1: one Full mapping. R2: two Full mappings.
    requirementIds.r1 = await mapControlsToFramework(frameworkId, [a1.id]);
    requirementIds.r2 = await mapControlsToFramework(frameworkId, [a1.id, a2.id]);
    // R3: only a Partial mapping. R5: Partial mapping plus an accepted gap.
    const partial = async (code: string, gapAcceptedAt: Date | null) =>
      (
        await prisma.requirement.create({
          data: {
            frameworkId,
            code: `TEST-RS-${code}-${suffix}`,
            section: "Test",
            title: `Test ${code}`,
            text: "t",
            gapAcceptedAt,
            gapJustification: gapAcceptedAt ? "Accepted in test" : null,
            mappings: { create: [{ controlId: a1.id, coverage: "PARTIAL" }] },
          },
        })
      ).id;
    requirementIds.r3 = await partial("R3", null);
    requirementIds.r5 = await partial("R5", new Date());
    // R4: no mappings at all. R6: only an Organizational Control. R7: a Control with an Impact Level threshold.
    requirementIds.r4 = (
      await prisma.requirement.create({
        data: { frameworkId, code: `TEST-RS-R4-${suffix}`, section: "Test", title: "Test R4", text: "t" },
      })
    ).id;
    requirementIds.r6 = await mapControlsToFramework(frameworkId, [org.id]);
    requirementIds.r7 = await mapControlsToFramework(frameworkId, [high.id]);

    const scopes = { connect: [{ id: frameworkId }] };
    const mk = (name: string, data: object) =>
      prisma.system.create({ data: { name: `Test ReqStatus ${name} ${suffix}`, ownerId, ...data } });
    systemIds.with = (await mk("with", { frameworkScopes: { connect: [{ id: frameworkId }, { id: draftFrameworkId }] }, deploymentFacets: { connect: { id: facetId } } })).id;
    systemIds.without = (await mk("without", { frameworkScopes: scopes })).id;
    systemIds.noScope = (await mk("noScope", { deploymentFacets: { connect: { id: facetId } } })).id;
    systemIds.high = (
      await mk("high", {
        frameworkScopes: scopes,
        deploymentFacets: { connect: { id: facetId } },
        confidentialityImpactLevel: "HIGH",
      })
    ).id;

    await prisma.controlAssessment.createMany({
      data: [
        { systemId: systemIds.with, controlId: a1.id, status: "FULFILLED" },
        { systemId: systemIds.with, controlId: a2.id, status: "IN_PROGRESS" },
        // "high" System: a1 Fulfilled, a2 has no Assessment row, the threshold Control is not started.
        { systemId: systemIds.high, controlId: a1.id, status: "FULFILLED" },
        { systemId: systemIds.high, controlId: high.id, status: "NOT_STARTED" },
        // Would-be Assessments on Systems where the Controls don't apply are ignored.
        { systemId: systemIds.without, controlId: a1.id, status: "FULFILLED" },
      ],
    });
  });

  afterAll(async () => {
    const systems = Object.values(systemIds);
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systems } } });
    await prisma.system.deleteMany({ where: { id: { in: systems } } });
    // Deleting the Frameworks cascades to their Requirements and Control Mappings.
    await prisma.framework.deleteMany({ where: { id: { in: [frameworkId, draftFrameworkId] } } });
    await prisma.control.deleteMany({ where: { id: { in: Object.values(controlIds) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("on a System that declares the facet: derived statuses from the Assessments", async () => {
    const rows = await rowsFor("with");
    const status = (key: keyof typeof requirementIds) => rows.get(requirementIds[key])!.status;

    expect(status("r1")).toBe("MET"); // a1 Fulfilled, Full coverage
    expect(status("r2")).toBe("PARTIALLY_MET"); // a1 Fulfilled, a2 In Progress
    expect(status("r3")).toBe("PARTIALLY_MET"); // a1 Fulfilled but only Partial coverage
    expect(rows.get(requirementIds.r3)!.basis).toBe("PARTIAL_COVERAGE");
    expect(status("r5")).toBe("PARTIALLY_MET"); // accepted gap: never Met
    expect(rows.get(requirementIds.r5)!.basis).toBe("ACCEPTED_GAP");
    expect(status("r4")).toBe("NOT_MET"); // no mapped Controls: the flagged default
    expect(status("r6")).toBe("NOT_APPLICABLE"); // Organizational Control never applies per System
    expect(status("r7")).toBe("NOT_APPLICABLE"); // threshold Control: System has no Confidentiality level
  });

  it("on a System without the facet: Requirements mapped only to facet-scoped Controls are Not Applicable", async () => {
    const rows = await rowsFor("without");
    for (const key of ["r1", "r2", "r3", "r5", "r6", "r7"] as const) {
      expect(rows.get(requirementIds[key])!.status, key).toBe("NOT_APPLICABLE");
    }
    // Controls are listed (mapped) but none applies, and the stray Assessment is not consulted.
    const r1 = rows.get(requirementIds.r1)!;
    expect(r1.controls).toHaveLength(1);
    expect(r1.controls[0]).toMatchObject({ applicable: false, assessmentStatus: null });
    // No mappings at all is still Not Met, never Not Applicable.
    expect(rows.get(requirementIds.r4)!.status).toBe("NOT_MET");
  });

  it("Not Started where the Assessment row is missing, and Impact Level thresholds apply", async () => {
    const rows = await rowsFor("high");
    expect(rows.get(requirementIds.r1)!.status).toBe("MET");
    // a1 Fulfilled, a2 without a row (Not Started).
    const r2 = rows.get(requirementIds.r2)!;
    expect(r2.status).toBe("PARTIALLY_MET");
    expect(r2.controls.find((c) => c.controlId === controlIds.a2)!.assessmentStatus).toBe("NOT_STARTED");
    // The threshold Control applies here (Confidentiality HIGH) and is Not Started.
    expect(rows.get(requirementIds.r7)!.status).toBe("NOT_MET");
  });

  it("a Framework that is not in the System's effective scope is Not Applicable there", async () => {
    const rows = await rowsFor("noScope");
    expect(rows.get(requirementIds.r1)!.status).toBe("NOT_APPLICABLE");
    expect(rows.get(requirementIds.r2)!.status).toBe("NOT_APPLICABLE");
    expect(isFrameworkInEffectiveScope({ id: frameworkId, status: "PUBLISHED", isBase: false }, [])).toBe(false);
    expect(isFrameworkInEffectiveScope({ id: frameworkId, status: "PUBLISHED", isBase: false }, [{ id: frameworkId }])).toBe(true);
    expect(isFrameworkInEffectiveScope({ id: frameworkId, status: "DRAFT", isBase: false }, [{ id: frameworkId }])).toBe(false);
    expect(isFrameworkInEffectiveScope({ id: "any", status: "PUBLISHED", isBase: true }, [])).toBe(true);
  });

  it("agrees with getApplicableControls on which mapped Controls apply (the in-memory rules can't drift)", async () => {
    const fixtureControlIds = Object.values(controlIds);
    for (const key of Object.keys(systemIds) as (keyof typeof systemIds)[]) {
      const system = await classification(systemIds[key]);
      const expected = (await getApplicableControls(system))
        .map((c) => c.id)
        .filter((id) => fixtureControlIds.includes(id))
        .sort();
      const rows = (await deriveFrameworkStatusesForSystems(frameworkId, [system]))!.bySystem.get(system.id)!;
      const actual = [
        ...new Set(rows.flatMap((row) => row.controls.filter((c) => c.applicable).map((c) => c.controlId))),
      ].sort();
      expect(actual, key).toEqual(expected);
    }
  });

  it("derives many Systems x one Framework in one call, and counts pool across Systems", async () => {
    const systems = await Promise.all(Object.values(systemIds).map(classification));
    const result = (await deriveFrameworkStatusesForSystems(frameworkId, systems))!;
    expect(result.framework.id).toBe(frameworkId);
    expect([...result.bySystem.keys()].sort()).toEqual(Object.values(systemIds).sort());

    const perSystem = (key: keyof typeof systemIds) => countRowStatuses(result.bySystem.get(systemIds[key])!);
    // "with": R1 Met; R2, R3, R5 Partially Met; R4 Not Met; R6, R7 Not Applicable.
    expect(perSystem("with")).toMatchObject({ MET: 1, PARTIALLY_MET: 3, NOT_MET: 1, NOT_APPLICABLE: 2, total: 7, applicable: 5 });

    const pooled = Object.keys(systemIds)
      .map((key) => perSystem(key as keyof typeof systemIds))
      .reduce(addDerivedStatusCounts);
    expect(pooled.total).toBe(7 * 4);
    expect(pooled.MET + pooled.PARTIALLY_MET + pooled.NOT_MET + pooled.NOT_APPLICABLE).toBe(pooled.total);
  });

  it("an empty list of Systems, or an unknown Framework, is handled", async () => {
    const none = await deriveFrameworkStatusesForSystems(frameworkId, []);
    expect(none!.bySystem.size).toBe(0);
    expect(await deriveFrameworkStatusesForSystems("no-such-framework", [])).toBeNull();
  });

  it("strictComplianceRequired: Waived no longer counts as fulfilled", async () => {
    await prisma.controlAssessment.update({
      where: { systemId_controlId: { systemId: systemIds.with, controlId: controlIds.a2 } },
      data: { status: "WAIVED" },
    });
    try {
      // Lenient: a1 Fulfilled + a2 Waived = Met.
      expect((await rowsFor("with")).get(requirementIds.r2)!.status).toBe("MET");

      await prisma.framework.update({ where: { id: frameworkId }, data: { strictComplianceRequired: true } });
      expect((await rowsFor("with")).get(requirementIds.r2)!.status).toBe("PARTIALLY_MET");
    } finally {
      await prisma.framework.update({ where: { id: frameworkId }, data: { strictComplianceRequired: false } });
      await prisma.controlAssessment.update({
        where: { systemId_controlId: { systemId: systemIds.with, controlId: controlIds.a2 } },
        data: { status: "IN_PROGRESS" },
      });
    }
  });

  it("the per-System view lists the fixture Framework and the base, and leaves out declared Draft Frameworks", async () => {
    const view = await getSystemFrameworkRequirements(await classification(systemIds.with));

    const fixture = view.find((entry) => entry.framework.id === frameworkId)!;
    expect(fixture).toBeDefined();
    expect(fixture.framework.isBase).toBe(false);
    expect(fixture.rows).toHaveLength(7);
    expect(fixture.counts).toMatchObject({ MET: 1, PARTIALLY_MET: 3, NOT_MET: 1, NOT_APPLICABLE: 2, total: 7 });
    // The base Framework is always in scope.
    expect(view.some((entry) => entry.framework.isBase)).toBe(true);
    // A Draft Framework in the declared scope is inert: not shown.
    expect(view.some((entry) => entry.framework.id === draftFrameworkId)).toBe(false);
    // A System that didn't declare the fixture Framework doesn't see it.
    const other = await getSystemFrameworkRequirements(await classification(systemIds.noScope));
    expect(other.some((entry) => entry.framework.id === frameworkId)).toBe(false);
  });

  it("rows are plain JSON (safe to hand to a client component)", async () => {
    const rows: DerivedRequirementRow[] = [...(await rowsFor("with")).values()];
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { classificationDifferences, formatComparisonScore, orderCandidates } from "../comparison-score";
import { loadComparisonScores } from "../comparison-score-data";
import { firstRoundControlIdsForSystem, firstRoundControlIdsForSystems } from "../first-round";

/**
 * The Comparison figures of real Systems (#371). Self-contained fixtures (CI's database is migrated but not
 * seeded): the Controls are scoped to a fixture Deployment Facet and mapped to fixture Frameworks, never to the
 * base Framework, and only the fixture Systems declare those Frameworks.
 */
describe("loadComparisonScores", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  let ownerId = "";
  let facetId = "";
  let otherFacetId = "";
  let fwA = "";
  let fwB = "";
  let fwOut = "";
  const c: Record<"one" | "two" | "three" | "four" | "org" | "second" | "unmapped" | "organizational", string> = {} as never;
  let s1 = "";
  let s2 = "";
  let s3 = "";
  let s4 = "";
  let provider = "";

  async function makeControl(key: keyof typeof c, applicability: "PER_SYSTEM" | "BOTH" | "ORGANIZATIONAL", mandatory: boolean) {
    const control = await prisma.control.create({
      data: {
        code: `TEST-CS-${suffix}-${key}`,
        title: `Test comparison ${key}`,
        description: "d",
        category: "Test",
        applicability,
        mandatory,
        question: applicability === "ORGANIZATIONAL" ? null : "Does it?",
        ...(applicability === "ORGANIZATIONAL" ? {} : { deploymentFacets: { connect: [{ id: facetId }] } }),
      },
    });
    controlIds.push(control.id);
    c[key] = control.id;
  }

  async function makeSystem(label: string, scope: string[], facets = [facetId], extra: { isProvider?: boolean; status?: "ONBOARDED" | "DRAFT" } = {}) {
    const system = await prisma.system.create({
      data: {
        name: `Test CS ${label} ${suffix}`,
        ownerId,
        sensitivityLevel: 3,
        integrityImpactLevel: "MODERATE",
        availabilityImpactLevel: "HIGH",
        deploymentFacets: { connect: facets.map((id) => ({ id })) },
        frameworkScopes: { connect: scope.map((id) => ({ id })) },
        ...extra,
      },
    });
    systemIds.push(system.id);
    return system.id;
  }

  const assess = (systemId: string, controlId: string, status: ControlAssessmentStatus, person = true) =>
    prisma.controlAssessment.create({ data: { systemId, controlId, status, assessedById: person ? ownerId : null } });

  const mark = async (frameworkId: string, controlId: string) => {
    await prisma.frameworkFirstRoundControl.create({ data: { frameworkId, controlId } });
  };

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `test-cs-${suffix}@example.com`, name: "Test CS owner", role: "SYSTEM_OWNER" } })).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test CS Facet ${suffix}` } })).id;
    otherFacetId = (await prisma.deploymentFacet.create({ data: { name: `Test CS Other Facet ${suffix}` } })).id;
    fwA = (await createFixtureFramework("CS A")).id;
    fwB = (await createFixtureFramework("CS B")).id;
    fwOut = (await createFixtureFramework("CS Out")).id;

    await makeControl("one", "PER_SYSTEM", true);
    await makeControl("two", "PER_SYSTEM", true);
    await makeControl("three", "PER_SYSTEM", false);
    await makeControl("four", "PER_SYSTEM", true);
    await makeControl("org", "BOTH", true);
    await makeControl("second", "PER_SYSTEM", true);
    await makeControl("unmapped", "PER_SYSTEM", true);
    await makeControl("organizational", "ORGANIZATIONAL", true);
    await mapControlsToFramework(fwA, [c.one, c.two, c.org, c.second, c.unmapped, c.organizational]);
    await mapControlsToFramework(fwB, [c.three]);
    await mapControlsToFramework(fwOut, [c.four]);

    // First round: one, two and org on A; three on B; four on Out (a Framework S1 does not have).
    for (const id of [c.one, c.two, c.org, c.organizational]) await mark(fwA, id);
    await mark(fwB, c.three);
    await mark(fwOut, c.four);
    // A marking whose Control is not mapped to that Framework is ignored.
    await mark(fwB, c.unmapped);
    await prisma.organizationControlImplementation.create({ data: { controlId: c.org, status: "FULFILLED" } });

    s1 = await makeSystem("S1", [fwA, fwB]);
    s2 = await makeSystem("S2 nothing marked", []);
    s3 = await makeSystem("S3 only Out", [fwOut]);
    provider = await makeSystem("Provider", [fwA], [facetId], { isProvider: true, status: "ONBOARDED" });
    s4 = await makeSystem("S4 with provider", [fwA]);
    await prisma.providerDependency.create({ data: { dependentId: s4, providerId: provider } });
    await prisma.controlOffering.create({ data: { providerId: provider, controlId: c.one, type: "FULL" } });
    await assess(provider, c.one, "FULFILLED");

    await assess(s1, c.one, "FULFILLED");
    await assess(s1, c.two, "WAIVED");
    // three: no row (Not Started); org: inherited from the Organization.
    await assess(s1, c.second, "FULFILLED");

    for (const [severity, status] of [
      ["HIGH", "OPEN"],
      ["HIGH", "OPEN"],
      ["LOW", "OPEN"],
      ["CRITICAL", "MITIGATED"],
      ["MEDIUM", "CLOSED"],
    ] as const) {
      await prisma.risk.create({ data: { systemId: s1, title: `Test CS risk ${severity}`, description: "d", severity, likelihood: "LOW", status } });
    }
  });

  afterAll(async () => {
    // Offerings, Assessments, dependencies and Risks go with the Systems; markings with the Controls.
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.frameworkFirstRoundControl.deleteMany({ where: { controlId: { in: controlIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetId, otherFacetId] } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.changeEvent.deleteMany({ where: { systemId: null, actorId: ownerId } });
  });

  it("scores a System over the first-round Controls of every Framework in its scope", async () => {
    const figures = (await loadComparisonScores([s1])).get(s1)!;
    // one (Fulfilled), two (Waived), three (no row), org (Fulfilled by the Organization). Not four (Out is not in
    // scope), not unmapped, not the Organizational Control, not second (second round).
    // In code order (the codes end in the key: one, org, three, two).
    expect(figures.controls.map((control) => [control.controlId, control.status])).toEqual([
      [c.one, "FULFILLED"],
      [c.org, "FULFILLED"],
      [c.three, "NOT_STARTED"],
      [c.two, "WAIVED"],
    ]);
    expect(figures).toMatchObject({
      firstRoundCount: 4,
      countedCount: 4,
      fulfilledCount: 2,
      answeredCount: 3,
      complete: false,
      mandatoryNotFulfilledCount: 1,
    });
    expect(formatComparisonScore(figures.score)).toBe("50%");
    expect(figures.name).toBe(`Test CS S1 ${suffix}`);
  });

  it("gives null for a System with nothing marked in its scope", async () => {
    const figures = (await loadComparisonScores([s2])).get(s2)!;
    expect(figures).toMatchObject({ firstRoundCount: 0, countedCount: 0, fulfilledCount: 0, score: null, complete: false, controls: [] });
  });

  it("ignores a Control marked only on a Framework outside the System's scope, and uses it where it is in scope", async () => {
    const figures = (await loadComparisonScores([s1, s3])).get(s3)!;
    expect(figures.controls.map((control) => control.controlId)).toEqual([c.four]);
    expect(figures).toMatchObject({ firstRoundCount: 1, fulfilledCount: 0, score: 0, answeredCount: 0 });
  });

  it("counts a Control inherited from the Organization and from a Provider as fulfilled", async () => {
    const figures = (await loadComparisonScores([s4])).get(s4)!;
    expect(figures.controls.map((control) => [control.controlId, control.status])).toEqual(
      expect.arrayContaining([
        [c.one, "FULFILLED"],
        [c.two, "NOT_STARTED"],
        [c.org, "FULFILLED"],
      ]),
    );
    expect(figures).toMatchObject({ firstRoundCount: 3, fulfilledCount: 2 });
  });

  it("ignores a marking on a Draft Framework in the System's scope: it is inert until published", async () => {
    const draft = await prisma.framework.create({ data: { name: `Test CS Draft ${suffix}`, version: "1", status: "DRAFT" } });
    try {
      await prisma.requirement.create({
        data: { frameworkId: draft.id, code: `TEST-CS-${suffix}`, section: "Test", title: "Test", text: "Test", mappings: { create: [{ controlId: c.second, coverage: "FULL" }] } },
      });
      await mark(draft.id, c.second);
      const system = await makeSystem("Draft scope", [draft.id]);
      expect((await loadComparisonScores([system])).get(system)).toMatchObject({ firstRoundCount: 0, score: null });
      await prisma.frameworkFirstRoundControl.deleteMany({ where: { frameworkId: draft.id } });
    } finally {
      await prisma.requirement.deleteMany({ where: { frameworkId: draft.id } });
      await prisma.framework.delete({ where: { id: draft.id } });
    }
  });

  it("leaves out a Control that does not apply to the System (another Deployment Facet)", async () => {
    const system = await makeSystem("Other facet", [fwA], [otherFacetId]);
    expect((await loadComparisonScores([system])).get(system)).toMatchObject({ firstRoundCount: 0, score: null });
  });

  it("counts open Risks by severity, open meaning status OPEN", async () => {
    const result = await loadComparisonScores([s1, s2]);
    expect(result.get(s1)!.openRisks).toEqual({ LOW: 1, MEDIUM: 0, HIGH: 2, CRITICAL: 0 });
    expect(result.get(s2)!.openRisks).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 });
  });

  it("returns the classification for the differences, with the effective Framework Scope", async () => {
    const result = await loadComparisonScores([s1, s2, s3]);
    const one = result.get(s1)!.classification;
    expect(one).toMatchObject({ sensitivityLevel: 3, integrityImpactLevel: "MODERATE", availabilityImpactLevel: "HIGH", deploymentFacetIds: [facetId] });
    expect(one.frameworkScopeIds).toEqual(expect.arrayContaining([fwA, fwB]));
    expect(one.frameworkScopeIds).not.toContain(fwOut);
    expect(classificationDifferences([one, result.get(s2)!.classification])).toEqual(["frameworkScope"]);
    expect(classificationDifferences([result.get(s2)!.classification, result.get(s3)!.classification])).toEqual(["frameworkScope"]);
  });

  it("orders the loaded Candidates", async () => {
    const result = await loadComparisonScores([s2, s3, s1, s4]);
    // None is complete except... S4 has an unanswered Control too; all are incomplete. Score descending, null last.
    const ordered = orderCandidates([...result.values()]).map((figures) => figures.systemId);
    expect(ordered).toEqual([s4, s1, s3, s2]);
  });

  it("loads several Systems in one call, leaves out an id that does not exist and ignores duplicates", async () => {
    const result = await loadComparisonScores([s1, "no-such-system", s4, s1]);
    expect([...result.keys()].sort()).toEqual([s1, s4].sort());
    expect((await loadComparisonScores([])).size).toBe(0);
    expect((await loadComparisonScores(["no-such-system"])).size).toBe(0);
  });

  it("reads through a transaction client it is given, in the caller's snapshot", async () => {
    const outside = (await loadComparisonScores([s1])).get(s1)!;
    await prisma.$transaction(
      async (tx) => {
        const first = (await loadComparisonScores([s1], tx)).get(s1)!;
        expect(first).toEqual(outside);
        // Another connection commits a change; the open RepeatableRead snapshot does not see it.
        await prisma.controlAssessment.update({ where: { systemId_controlId: { systemId: s1, controlId: c.two } }, data: { status: "FULFILLED" } });
        await prisma.risk.create({ data: { systemId: s1, title: "Test CS late risk", description: "d", severity: "CRITICAL", likelihood: "LOW" } });
        const second = (await loadComparisonScores([s1], tx)).get(s1)!;
        expect(second).toEqual(first);
      },
      { isolationLevel: "RepeatableRead" },
    );
    const after = (await loadComparisonScores([s1])).get(s1)!;
    expect(after.fulfilledCount).toBe(3);
    expect(after.openRisks.CRITICAL).toBe(1);
    await prisma.controlAssessment.update({ where: { systemId_controlId: { systemId: s1, controlId: c.two } }, data: { status: "WAIVED" } });
    await prisma.risk.deleteMany({ where: { systemId: s1, title: "Test CS late risk" } });
  });

  it("takes its first-round Controls from the same rule as firstRoundControlIdsForSystem", async () => {
    const batched = await firstRoundControlIdsForSystems([s1, s2, s3, s4]);
    for (const id of [s1, s2, s3, s4]) {
      expect([...batched.get(id)!].sort()).toEqual([...(await firstRoundControlIdsForSystem(id))].sort());
    }
  });
});

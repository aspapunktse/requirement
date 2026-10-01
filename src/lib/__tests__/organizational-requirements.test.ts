import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getApplicableControls, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { getComplianceForSystems } from "@/lib/compliance";
import { effectiveSourceLabel } from "@/lib/effective-status";
import {
  countRowStatuses,
  deriveFrameworkStatusesForSystems,
  getSystemFrameworkRequirements,
  type DerivationSystem,
} from "@/lib/requirement-status";
import { mapControlsToFramework } from "@/test/framework-fixtures";

/**
 * Organizational Requirements count on every System (#122, decision 3a on #89). An Organizational
 * Control mapped to a Requirement of a Framework that is Published and in a System's effective
 * scope counts for that System, with the Organization Control Implementation's status as its
 * status (Waived and Not Applicable count except on a strict Framework). CI's DB is migrated, not
 * seeded, so everything is a fixture, and the Organizational Controls are mapped only to fixture
 * Frameworks that only the fixture Systems declare (never to the base, which every System has).
 *
 * Controls:   orgA, orgB (Organizational), perSys (Per-System, Facet F), perOther (Per-System, Facet G),
 *             both (Both, Facet F)
 * Lenient L:  rOrg1 <- orgA        rOrg2 <- orgA + orgB      rNoApply <- perOther
 *             rMixed <- orgA (Full) + perSys (Partial): the ISO 7.5 shape      rBoth <- both
 * Strict S:   sOrg <- orgA.   Draft D: dOrg <- orgA.
 * Systems:    sysF (Facet F; declares L, S and D), sysPlain (no Facet; declares L and S),
 *             sysOut (Facet F; declares none of them)
 */
describe("Organizational Requirements count per System (#122)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let ownerId: string;
  let facetF: string;
  let facetG: string;
  let lenientId: string;
  let strictId: string;
  let draftId: string;
  const control = {} as Record<"orgA" | "orgB" | "perSys" | "perOther" | "both", string>;
  const requirement = {} as Record<"rOrg1" | "rOrg2" | "rNoApply" | "rMixed" | "rBoth" | "sOrg" | "dOrg", string>;
  const systemIds = {} as Record<"sysF" | "sysPlain" | "sysOut", string>;
  type SystemKey = keyof typeof systemIds;

  const classification = (id: string): Promise<DerivationSystem> =>
    prisma.system.findUniqueOrThrow({
      where: { id },
      include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
    });

  async function rows(frameworkId: string, key: SystemKey) {
    const result = await deriveFrameworkStatusesForSystems(frameworkId, [await classification(systemIds[key])]);
    return new Map(result!.bySystem.get(systemIds[key])!.map((row) => [row.requirementId, row]));
  }
  const statusOf = async (frameworkId: string, key: SystemKey, requirementKey: keyof typeof requirement) =>
    (await rows(frameworkId, key)).get(requirement[requirementKey])!.status;

  /** The Organization's implementation of a fixture Control, written straight to the table. */
  const setOrganization = (key: keyof typeof control, status: ControlAssessmentStatus) =>
    prisma.organizationControlImplementation.upsert({
      where: { controlId: control[key] },
      create: { controlId: control[key], status },
      update: { status },
    });
  const clearOrganization = () =>
    prisma.organizationControlImplementation.deleteMany({ where: { controlId: { in: Object.values(control) } } });
  const setAssessment = (key: SystemKey, controlKey: keyof typeof control, status: ControlAssessmentStatus, assessedById: string | null = null) =>
    prisma.controlAssessment.upsert({
      where: { systemId_controlId: { systemId: systemIds[key], controlId: control[controlKey] } },
      create: { systemId: systemIds[key], controlId: control[controlKey], status, assessedById },
      update: { status, assessedById },
    });

  beforeAll(async () => {
    ownerId = (
      await prisma.user.create({
        data: { email: `test-orgreq-${suffix}@example.com`, name: "Test OrgReq Owner", role: "SYSTEM_OWNER" },
      })
    ).id;
    facetF = (await prisma.deploymentFacet.create({ data: { name: `Test OrgReq Facet F ${suffix}` } })).id;
    facetG = (await prisma.deploymentFacet.create({ data: { name: `Test OrgReq Facet G ${suffix}` } })).id;
    const framework = async (name: string, data: object) =>
      (await prisma.framework.create({ data: { name: `Test OrgReq ${name} ${suffix}`, version: "1", ...data } })).id;
    lenientId = await framework("Lenient", { status: "PUBLISHED" });
    strictId = await framework("Strict", { status: "PUBLISHED", strictComplianceRequired: true });
    draftId = await framework("Draft", { status: "DRAFT" });

    const make = async (key: keyof typeof control, applicability: "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH", extra: object = {}) => {
      control[key] = (
        await prisma.control.create({
          data: {
            code: `TEST-ORGREQ-${key}-${suffix}`,
            title: `Test OrgReq ${key}`,
            description: "d",
            category: "Test",
            applicability,
            mandatory: true,
            ...(applicability !== "ORGANIZATIONAL" && { question: "Does it?" }),
            ...extra,
          },
        })
      ).id;
    };
    await make("orgA", "ORGANIZATIONAL");
    await make("orgB", "ORGANIZATIONAL");
    await make("perSys", "PER_SYSTEM", { deploymentFacets: { connect: { id: facetF } } });
    await make("perOther", "PER_SYSTEM", { deploymentFacets: { connect: { id: facetG } } });
    await make("both", "BOTH", { deploymentFacets: { connect: { id: facetF } } });

    requirement.rOrg1 = await mapControlsToFramework(lenientId, [control.orgA]);
    requirement.rOrg2 = await mapControlsToFramework(lenientId, [control.orgA, control.orgB]);
    requirement.rNoApply = await mapControlsToFramework(lenientId, [control.perOther]);
    requirement.rBoth = await mapControlsToFramework(lenientId, [control.both]);
    requirement.rMixed = (
      await prisma.requirement.create({
        data: {
          frameworkId: lenientId,
          code: `TEST-ORGREQ-MIXED-${suffix}`,
          section: "Test",
          title: "Test mixed",
          text: "t",
          mappings: {
            create: [
              { controlId: control.orgA, coverage: "FULL" },
              { controlId: control.perSys, coverage: "PARTIAL" },
            ],
          },
        },
      })
    ).id;
    requirement.sOrg = await mapControlsToFramework(strictId, [control.orgA]);
    requirement.dOrg = await mapControlsToFramework(draftId, [control.orgA]);

    const system = async (name: string, data: object) =>
      (await prisma.system.create({ data: { name: `Test OrgReq ${name} ${suffix}`, ownerId, ...data } })).id;
    const scope = (...ids: string[]) => ({ connect: ids.map((id) => ({ id })) });
    systemIds.sysF = await system("F", { deploymentFacets: scope(facetF), frameworkScopes: scope(lenientId, strictId, draftId) });
    systemIds.sysPlain = await system("Plain", { frameworkScopes: scope(lenientId, strictId) });
    systemIds.sysOut = await system("Out", { deploymentFacets: scope(facetF) });
  });

  afterAll(async () => {
    const systems = Object.values(systemIds);
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systems } } });
    await prisma.system.deleteMany({ where: { id: { in: systems } } });
    // Deleting the Frameworks cascades to their Requirements and Control Mappings; a Control takes its implementation with it.
    await prisma.framework.deleteMany({ where: { id: { in: [lenientId, strictId, draftId] } } });
    await prisma.control.deleteMany({ where: { id: { in: Object.values(control) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetF, facetG] } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("a Requirement mapped only to Organizational Controls is Not Met while the Organization has recorded nothing, on every System with the Framework in scope", async () => {
    await clearOrganization();
    for (const key of ["sysF", "sysPlain"] as const) {
      const row = (await rows(lenientId, key)).get(requirement.rOrg1)!;
      expect(row.status, key).toBe("NOT_MET");
      expect(row.basis).toBe("CONTROLS");
      // The Control counts, has no Assessment of its own, and says it is implemented by the Organization.
      expect(row.controls).toHaveLength(1);
      expect(row.controls[0]).toMatchObject({ controlId: control.orgA, applicable: true, assessmentStatus: null });
      expect(row.controls[0].effective).toMatchObject({ status: "NOT_STARTED", source: { kind: "ORGANIZATION_DIRECT" } });
      expect(effectiveSourceLabel(row.controls[0].effective!)).toBe("Implemented by the Organization");
    }
    // An explicit Not Started row reads the same as a missing one.
    await setOrganization("orgA", "NOT_STARTED");
    expect(await statusOf(lenientId, "sysF", "rOrg1")).toBe("NOT_MET");
  });

  it("is Not Applicable on a System that does not have the Framework in scope, as before", async () => {
    await setOrganization("orgA", "FULFILLED");
    const row = (await rows(lenientId, "sysOut")).get(requirement.rOrg1)!;
    expect(row.status).toBe("NOT_APPLICABLE");
    expect(row.controls[0]).toMatchObject({ applicable: false, effective: null });
  });

  it("is Met when the Organization has Fulfilled every Control behind it, Partially Met when some, Not Met when none, on every System in scope", async () => {
    await clearOrganization();
    for (const key of ["sysF", "sysPlain"] as const) {
      await setOrganization("orgA", "FULFILLED");
      expect(await statusOf(lenientId, key, "rOrg2"), key).toBe("PARTIALLY_MET");
      expect(await statusOf(lenientId, key, "rOrg1"), key).toBe("MET");
      await setOrganization("orgB", "FULFILLED");
      expect(await statusOf(lenientId, key, "rOrg2"), key).toBe("MET");
      await setOrganization("orgA", "IN_PROGRESS");
      await setOrganization("orgB", "NOT_STARTED");
      expect(await statusOf(lenientId, key, "rOrg2"), key).toBe("NOT_MET");
    }
  });

  it("Waived and Not Applicable by the Organization count on a lenient Framework and do not on a strict one", async () => {
    for (const status of ["WAIVED", "NOT_APPLICABLE"] as const) {
      await setOrganization("orgA", status);
      expect(await statusOf(lenientId, "sysF", "rOrg1"), status).toBe("MET");
      expect(await statusOf(strictId, "sysF", "sOrg"), status).toBe("NOT_MET");
    }
    await setOrganization("orgA", "FULFILLED");
    expect(await statusOf(strictId, "sysF", "sOrg")).toBe("MET");
    await setOrganization("orgA", "IN_PROGRESS");
    expect(await statusOf(lenientId, "sysF", "rOrg1")).toBe("NOT_MET");
  });

  it("a Draft Framework stays inert: its Requirement is Not Applicable even on a System that declares it", async () => {
    await setOrganization("orgA", "FULFILLED");
    expect(await statusOf(draftId, "sysF", "dOrg")).toBe("NOT_APPLICABLE");
  });

  it("a mixed Requirement (the ISO 7.5 shape: Full to an Organizational Control, Partial to a per-System one) is Met when both are fulfilled, Partially Met otherwise", async () => {
    await setOrganization("orgA", "FULFILLED");
    await setAssessment("sysF", "perSys", "FULFILLED", ownerId);
    expect(await statusOf(lenientId, "sysF", "rMixed")).toBe("MET");

    await setAssessment("sysF", "perSys", "IN_PROGRESS", ownerId);
    expect(await statusOf(lenientId, "sysF", "rMixed")).toBe("PARTIALLY_MET");

    await setAssessment("sysF", "perSys", "FULFILLED", ownerId);
    await setOrganization("orgA", "NOT_STARTED");
    expect(await statusOf(lenientId, "sysF", "rMixed")).toBe("PARTIALLY_MET");

    await setAssessment("sysF", "perSys", "NOT_STARTED", ownerId);
    expect(await statusOf(lenientId, "sysF", "rMixed")).toBe("NOT_MET");
  });

  it("where the per-System Control does not apply, the Organizational Control alone decides, and its Full mapping covers the Requirement", async () => {
    await setOrganization("orgA", "FULFILLED");
    const row = (await rows(lenientId, "sysPlain")).get(requirement.rMixed)!;
    expect(row.status).toBe("MET");
    expect(row.controls.map((c) => [c.code.split("-")[2], c.applicable])).toEqual([
      ["orgA", true],
      ["perSys", false],
    ]);
    await setOrganization("orgA", "NOT_STARTED");
    expect(await statusOf(lenientId, "sysPlain", "rMixed")).toBe("NOT_MET");
  });

  it("a Requirement whose only mapped Controls are per-System Controls that do not apply is still Not Applicable", async () => {
    for (const key of ["sysF", "sysPlain"] as const) {
      expect(await statusOf(lenientId, key, "rNoApply"), key).toBe("NOT_APPLICABLE");
    }
  });

  it("a Both Control keeps the rule of #121: only a Fulfilled Organization is inherited, and a Waived one is not credited", async () => {
    await setOrganization("both", "FULFILLED");
    const inherited = (await rows(lenientId, "sysF")).get(requirement.rBoth)!;
    expect(inherited.status).toBe("MET");
    expect(effectiveSourceLabel(inherited.controls[0].effective!)).toBe("Inherited from Organization");
    expect(inherited.controls[0].assessmentStatus).toBe("NOT_STARTED"); // the System's own row is untouched

    await setOrganization("both", "WAIVED"); // an Organizational Control would count here; a Both Control does not
    expect(await statusOf(lenientId, "sysF", "rBoth")).toBe("NOT_MET");

    await setOrganization("both", "FULFILLED");
    await setAssessment("sysF", "both", "IN_PROGRESS", ownerId);
    expect(await statusOf(lenientId, "sysF", "rBoth")).toBe("NOT_MET"); // a person-set Assessment still wins
    await prisma.controlAssessment.deleteMany({ where: { controlId: control.both } });
    await prisma.controlAssessment.deleteMany({ where: { controlId: control.perSys } });
  });

  it("the Compliance Percentage counts them: the denominator grows, it is pooled across Systems, and the bulk and single-System paths agree", async () => {
    await clearOrganization();
    const where = { id: { in: Object.values(systemIds) } };

    // Nothing implemented. sysF: rOrg1, rOrg2, rMixed and rBoth are Not Met, rNoApply is Not Applicable: 0 of 4
    // (under the old rule only rMixed and rBoth counted: 0 of 2). sysPlain: rOrg1, rOrg2 and rMixed: 0 of 3.
    // sysOut does not have L in scope and adds nothing.
    const before = await getComplianceForSystems(where, { frameworkId: lenientId });
    const figure = (result: typeof before, key: SystemKey) => result.bySystem.find((s) => s.systemId === systemIds[key]);
    expect(figure(before, "sysF")).toMatchObject({ met: 0, applicable: 4, percentage: 0 });
    expect(figure(before, "sysPlain")).toMatchObject({ met: 0, applicable: 3, percentage: 0 });
    expect(figure(before, "sysOut")).toMatchObject({ met: 0, applicable: 0, percentage: null });
    expect(before).toMatchObject({ met: 0, applicable: 7, percentage: 0 });

    // The Organization fulfils both Controls. sysF: rOrg1 and rOrg2 Met, rMixed Partially Met (perSys not started),
    // rBoth Not Met: 2 of 4. sysPlain: rOrg1, rOrg2 and rMixed Met: 3 of 3. Pooled 5 of 7 (71.4%), not the
    // average of 50% and 100% (75%).
    await setOrganization("orgA", "FULFILLED");
    await setOrganization("orgB", "FULFILLED");
    const after = await getComplianceForSystems(where, { frameworkId: lenientId });
    expect(figure(after, "sysF")).toMatchObject({ met: 2, applicable: 4, percentage: 50 });
    expect(figure(after, "sysPlain")).toMatchObject({ met: 3, applicable: 3, percentage: 100 });
    expect(after).toMatchObject({ met: 5, applicable: 7, percentage: 71.4 });

    // The single-System path (the System page) gives the same counts as the bulk derivation.
    const systems = await Promise.all(Object.values(systemIds).map(classification));
    const bulk = (await deriveFrameworkStatusesForSystems(lenientId, systems))!;
    for (const system of systems) {
      const single = (await getSystemFrameworkRequirements(system)).find((entry) => entry.framework.id === lenientId);
      const bulkCounts = countRowStatuses(bulk.bySystem.get(system.id)!);
      if (system.id === systemIds.sysOut) {
        expect(single).toBeUndefined(); // L is not in its scope
        expect(bulkCounts.applicable).toBe(0);
      } else {
        expect(single!.counts).toEqual(bulkCounts);
      }
    }
  });

  it("still gives an Organizational Control no Assessment, no applicability, and no part in the submission check", async () => {
    await setOrganization("orgA", "NOT_STARTED");
    const system = await classification(systemIds.sysF);
    expect((await getApplicableControls(system)).map((c) => c.id)).not.toContain(control.orgA);
    // orgA and orgB are mandatory, yet neither is something the System owner has to address.
    const unaddressed = (await getUnaddressedMandatoryControls(system)).map((c) => c.id);
    expect(unaddressed).not.toContain(control.orgA);
    expect(unaddressed).not.toContain(control.orgB);
    expect(await prisma.controlAssessment.count({ where: { controlId: { in: [control.orgA, control.orgB] } } })).toBe(0);
  });
});

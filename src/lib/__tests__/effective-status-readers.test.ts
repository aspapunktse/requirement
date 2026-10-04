import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getSystemAssessments, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { getComplianceForSystems } from "@/lib/compliance";
import { getSystemsNeedingAttention } from "@/lib/dashboard";
import {
  countRowStatuses,
  deriveFrameworkStatusesForSystems,
  getSystemFrameworkRequirements,
  type DerivationSystem,
} from "@/lib/requirement-status";
import { mapControlsToFramework } from "@/test/framework-fixtures";
import { POST as submit } from "@/app/api/systems/[id]/submit/route";

/**
 * Every reader of a Control's status goes through the effective status (F-IN.5, #121): the
 * System page's rows, the derived Requirement status, the Compliance Percentage, the submission
 * check and the "needs assessment" count. Self-contained fixtures against real Postgres: BOTH and
 * PER_SYSTEM Controls scoped to a fixture Deployment Facet (so they only ever apply to fixture
 * Systems), mapped to fixture Published Frameworks that the fixture Systems declare. The
 * Organization's implementation is set directly; the route that does it is tested separately.
 */
describe("effective status in the readers", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const PERSON_SET_STATUSES: ControlAssessmentStatus[] = ["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "WAIVED", "NOT_APPLICABLE"];

  let ownerId: string;
  let facetId: string;
  let lenientId: string;
  let strictId: string;
  const control = {} as Record<"both1" | "both2" | "perSystem", { id: string; code: string }>;
  const requirement = {} as Record<"both1" | "both1And2" | "perSystem" | "strictBoth1", string>;
  const system = {} as Record<string, string>;
  const personSetSystem = {} as Record<ControlAssessmentStatus, string>;

  const setOrganization = (controlId: string, status: ControlAssessmentStatus) =>
    prisma.organizationControlImplementation.upsert({
      where: { controlId },
      create: { controlId, status, description: status === "WAIVED" || status === "NOT_APPLICABLE" ? "Because" : null },
      update: { status, description: status === "WAIVED" || status === "NOT_APPLICABLE" ? "Because" : null },
    });
  const setBoth = async (status: ControlAssessmentStatus) => {
    await setOrganization(control.both1.id, status);
    await setOrganization(control.both2.id, status);
  };
  const classification = (id: string): Promise<DerivationSystem> =>
    prisma.system.findUniqueOrThrow({
      where: { id },
      include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } },
    });
  const effectiveOf = async (systemId: string, controlId: string) => {
    const rows = await getSystemAssessments(await classification(systemId));
    return rows.find((row) => row.control.id === controlId)!;
  };
  const statusOf = async (frameworkId: string, systemId: string, requirementId: string) => {
    const derived = await deriveFrameworkStatusesForSystems(frameworkId, [await classification(systemId)]);
    return derived!.bySystem.get(systemId)!.find((row) => row.requirementId === requirementId)!.status;
  };

  beforeAll(async () => {
    ownerId = (await prisma.user.create({ data: { email: `test-effstatus-${suffix}@example.com`, name: "Test EffStatus Owner", role: "SYSTEM_OWNER" } })).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test EffStatus Facet ${suffix}` } })).id;
    lenientId = (await prisma.framework.create({ data: { name: `Test EffStatus Lenient ${suffix}`, version: "1", status: "PUBLISHED" } })).id;
    strictId = (
      await prisma.framework.create({
        data: { name: `Test EffStatus Strict ${suffix}`, version: "1", status: "PUBLISHED", strictComplianceRequired: true },
      })
    ).id;

    const makeControl = async (key: keyof typeof control, applicability: "BOTH" | "PER_SYSTEM") => {
      const created = await prisma.control.create({
        data: {
          code: `TEST-EFF-${key}-${suffix}`,
          title: `Test EffStatus ${key}`,
          description: "d",
          category: "Test",
          applicability,
          mandatory: true,
          question: "Does it?",
          // Scoped to the fixture facet, so it only ever applies to this file's Systems.
          deploymentFacets: { connect: { id: facetId } },
        },
      });
      control[key] = { id: created.id, code: created.code };
    };
    await makeControl("both1", "BOTH");
    await makeControl("both2", "BOTH");
    await makeControl("perSystem", "PER_SYSTEM");

    requirement.both1 = await mapControlsToFramework(lenientId, [control.both1.id]);
    requirement.both1And2 = await mapControlsToFramework(lenientId, [control.both1.id, control.both2.id]);
    requirement.perSystem = await mapControlsToFramework(lenientId, [control.perSystem.id]);
    requirement.strictBoth1 = await mapControlsToFramework(strictId, [control.both1.id]);

    const makeSystem = async (key: string, over: Record<string, unknown> = {}) => {
      system[key] = (
        await prisma.system.create({
          data: {
            name: `Test EffStatus ${key} ${suffix}`,
            ownerId,
            status: "ONBOARDED",
            deploymentFacets: { connect: { id: facetId } },
            frameworkScopes: { connect: [{ id: lenientId }, { id: strictId }] },
            ...over,
          },
        })
      ).id;
    };
    // Untouched: both1 is an untouched Not Started row, both2 has no row at all, perSystem is an untouched row.
    await makeSystem("untouched");
    await prisma.controlAssessment.createMany({
      data: [
        { systemId: system.untouched, controlId: control.both1.id },
        { systemId: system.untouched, controlId: control.perSystem.id },
      ],
    });
    // Fulfilled, but no person set it.
    await makeSystem("nobodySet");
    await prisma.controlAssessment.create({ data: { systemId: system.nobodySet, controlId: control.both1.id, status: "FULFILLED" } });
    // One System per status a person can set on both1 (and both2, so the two-Control Requirement is covered).
    for (const status of PERSON_SET_STATUSES) {
      await makeSystem(`person-${status}`);
      personSetSystem[status] = system[`person-${status}`];
      await prisma.controlAssessment.createMany({
        data: [control.both1.id, control.both2.id].map((controlId) => ({
          systemId: personSetSystem[status],
          controlId,
          status,
          assessedById: ownerId,
          assessedAt: new Date(),
        })),
      });
    }
    await makeSystem("draft", { status: "DRAFT" });
  });

  afterAll(async () => {
    const systemIds = Object.values(system);
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    // Deleting the Frameworks cascades to their Requirements and Control Mappings; the Controls take their implementations along.
    await prisma.framework.deleteMany({ where: { id: { in: [lenientId, strictId] } } });
    await prisma.control.deleteMany({ where: { id: { in: Object.values(control).map((c) => c.id) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  describe("a Both Control on the System's own rows (getSystemAssessments)", () => {
    it("an untouched Not Started row and a Control with no row are Fulfilled once the Organization is, and drop back when it is not", async () => {
      await setBoth("NOT_STARTED");
      for (const controlId of [control.both1.id, control.both2.id]) {
        const row = await effectiveOf(system.untouched, controlId);
        expect(row.effective.status).toBe("NOT_STARTED");
        expect(row.effective.source).toEqual({ kind: "SYSTEM" });
      }

      await setBoth("FULFILLED");
      const withRow = await effectiveOf(system.untouched, control.both1.id);
      const withoutRow = await effectiveOf(system.untouched, control.both2.id);
      expect(withoutRow.assessment).toBeNull();
      for (const row of [withRow, withoutRow]) {
        expect(row.effective.status).toBe("FULFILLED");
        expect(row.effective.source).toMatchObject({ kind: "ORGANIZATION", type: "FULL", status: "FULFILLED" });
        expect(row.effective.sources).toEqual([{ kind: "ORGANIZATION", type: "FULL", status: "FULFILLED", givesCredit: true }]);
      }
      // The stored row is the System's own, untouched by inheritance.
      expect(withRow.assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });

      await setBoth("IN_PROGRESS");
      expect((await effectiveOf(system.untouched, control.both1.id)).effective.status).toBe("NOT_STARTED");
      expect((await effectiveOf(system.untouched, control.both2.id)).effective.status).toBe("NOT_STARTED");
    });

    it.each(["IN_PROGRESS", "WAIVED", "NOT_APPLICABLE", "NOT_STARTED"] as const)(
      "a %s Organization gives no credit, but is still listed as a source",
      async (status) => {
        await setBoth(status);
        const row = await effectiveOf(system.untouched, control.both1.id);
        expect(row.effective.status).toBe("NOT_STARTED");
        expect(row.effective.source).toEqual({ kind: "SYSTEM" });
        expect(row.effective.sources).toEqual([{ kind: "ORGANIZATION", type: "FULL", status, givesCredit: false }]);
      },
    );

    it("a Both Control whose Organization has no implementation row reads as a Not Started source", async () => {
      await prisma.organizationControlImplementation.deleteMany({ where: { controlId: control.both1.id } });
      const row = await effectiveOf(system.untouched, control.both1.id);
      expect(row.effective.status).toBe("NOT_STARTED");
      expect(row.effective.sources).toEqual([{ kind: "ORGANIZATION", type: "FULL", status: "NOT_STARTED", givesCredit: false }]);
    });

    it.each(PERSON_SET_STATUSES)("a person-set %s Assessment is never overridden by a Fulfilled Organization", async (status) => {
      await setBoth("FULFILLED");
      const row = await effectiveOf(personSetSystem[status], control.both1.id);
      expect(row.effective.status).toBe(status);
      expect(row.effective.source).toEqual({ kind: "SYSTEM" });
      expect(row.effective.sources).toHaveLength(1);
      expect(row.effective.overridesInherited).toBe(status !== "FULFILLED");
      expect(row.assessment?.status).toBe(status);
    });

    it("a Per-System Control is never inherited", async () => {
      await setBoth("FULFILLED");
      const row = await effectiveOf(system.untouched, control.perSystem.id);
      expect(row.effective.status).toBe("NOT_STARTED");
      expect(row.effective.sources).toEqual([]);
    });

    it("a Fulfilled Assessment nobody set stays Fulfilled when the Organization is not", async () => {
      await setBoth("NOT_STARTED");
      expect((await effectiveOf(system.nobodySet, control.both1.id)).effective.status).toBe("FULFILLED");
    });

    it("inheritance writes nothing: the rows and their statuses are the same before and after", async () => {
      const snapshot = async () =>
        prisma.controlAssessment.findMany({
          where: { systemId: { in: Object.values(system) } },
          orderBy: [{ systemId: "asc" }, { controlId: "asc" }],
          select: { systemId: true, controlId: true, status: true, assessedById: true, updatedAt: true },
        });
      await setBoth("NOT_STARTED");
      const before = await snapshot();
      await setBoth("FULFILLED");
      await getSystemAssessments(await classification(system.untouched));
      await deriveFrameworkStatusesForSystems(lenientId, [await classification(system.untouched)]);
      await getUnaddressedMandatoryControls(await classification(system.untouched));
      await setBoth("NOT_STARTED");
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("derived Requirement status and the Compliance Percentage", () => {
    it("a Requirement is Met only through inheritance, and falls back when the Organization does", async () => {
      await setBoth("NOT_STARTED");
      expect(await statusOf(lenientId, system.untouched, requirement.both1)).toBe("NOT_MET");

      await setOrganization(control.both1.id, "FULFILLED");
      expect(await statusOf(lenientId, system.untouched, requirement.both1)).toBe("MET");
      // Two mapped Controls, only one inherited: Partially Met until the second is too.
      expect(await statusOf(lenientId, system.untouched, requirement.both1And2)).toBe("PARTIALLY_MET");
      await setOrganization(control.both2.id, "FULFILLED");
      expect(await statusOf(lenientId, system.untouched, requirement.both1And2)).toBe("MET");
      // The Per-System Control is its own, whatever the Organization says.
      expect(await statusOf(lenientId, system.untouched, requirement.perSystem)).toBe("NOT_MET");

      await setBoth("WAIVED");
      expect(await statusOf(lenientId, system.untouched, requirement.both1)).toBe("NOT_MET");
      expect(await statusOf(lenientId, system.untouched, requirement.both1And2)).toBe("NOT_MET");
    });

    it("judges a person-set Assessment on its own: Waived counts on a lenient Framework and not on a strict one, whatever the Organization says", async () => {
      await setBoth("FULFILLED");
      expect(await statusOf(lenientId, personSetSystem.WAIVED, requirement.both1)).toBe("MET");
      expect(await statusOf(strictId, personSetSystem.WAIVED, requirement.strictBoth1)).toBe("NOT_MET");
      expect(await statusOf(lenientId, personSetSystem.NOT_STARTED, requirement.both1)).toBe("NOT_MET");
      expect(await statusOf(lenientId, personSetSystem.IN_PROGRESS, requirement.both1)).toBe("NOT_MET");
      // An untouched Assessment on the strict Framework is Met through inheritance: Fulfilled needs no waiver.
      expect(await statusOf(strictId, system.untouched, requirement.strictBoth1)).toBe("MET");
    });

    it("moves the Compliance Percentage, pooled across Systems", async () => {
      const where = { id: { in: [system.untouched, personSetSystem.NOT_STARTED] } };
      await setBoth("NOT_STARTED");
      const before = await getComplianceForSystems(where, { frameworkId: lenientId });
      // Three Requirements apply to each of the two Systems; none is Met.
      expect(before).toMatchObject({ met: 0, applicable: 6 });

      await setOrganization(control.both1.id, "FULFILLED");
      const one = await getComplianceForSystems(where, { frameworkId: lenientId });
      // Only the untouched System moves: both1's Requirement is Met there. The person-set Not Started one does not.
      expect(one).toMatchObject({ met: 1, applicable: 6, percentage: 16.7 });
      expect(one.bySystem.find((s) => s.systemId === system.untouched)).toMatchObject({ met: 1, applicable: 3 });
      expect(one.bySystem.find((s) => s.systemId === personSetSystem.NOT_STARTED)).toMatchObject({ met: 0, applicable: 3 });

      await setOrganization(control.both2.id, "FULFILLED");
      expect(await getComplianceForSystems(where, { frameworkId: lenientId })).toMatchObject({ met: 2, applicable: 6, percentage: 33.3 });

      await setBoth("NOT_STARTED");
      expect(await getComplianceForSystems(where, { frameworkId: lenientId })).toMatchObject({ met: 0, applicable: 6 });
    });

    it("the bulk path and the single-System path agree, effective statuses included", async () => {
      await setOrganization(control.both1.id, "FULFILLED");
      await setOrganization(control.both2.id, "WAIVED");
      const ids = [system.untouched, system.nobodySet, ...Object.values(personSetSystem)];
      const systems = await Promise.all(ids.map(classification));

      const bulk = await deriveFrameworkStatusesForSystems(lenientId, systems);
      for (const one of systems) {
        const alone = await deriveFrameworkStatusesForSystems(lenientId, [one]);
        expect(bulk!.bySystem.get(one.id)).toEqual(alone!.bySystem.get(one.id));
        const perFramework = (await getSystemFrameworkRequirements(one)).find((entry) => entry.framework.id === lenientId)!;
        expect(perFramework.rows).toEqual(bulk!.bySystem.get(one.id));
        expect(perFramework.counts).toEqual(countRowStatuses(bulk!.bySystem.get(one.id)!));
      }
      // And the rows carry the effective status the System page shows.
      const untouchedRows = bulk!.bySystem.get(system.untouched)!;
      const both1Row = untouchedRows.find((row) => row.requirementId === requirement.both1)!;
      expect(both1Row.controls[0]).toMatchObject({
        assessmentStatus: "NOT_STARTED",
        effective: { status: "FULFILLED", source: { kind: "ORGANIZATION" } },
      });
    });
  });

  describe("the submission check and the \"needs assessment\" count", () => {
    const fixtureIds = () => new Set([control.both1.id, control.both2.id, control.perSystem.id]);
    const unaddressedFixtures = async (systemId: string) =>
      (await getUnaddressedMandatoryControls(await classification(systemId)))
        .filter((c) => fixtureIds().has(c.id))
        .map((c) => c.code)
        .sort();
    const needsAssessmentCount = async (systemId: string) => {
      const entry = (await getSystemsNeedingAttention(ownerId)).find((e) => e.id === systemId && e.reason === "needs-assessment");
      return entry && entry.reason === "needs-assessment" ? entry.count : 0;
    };

    it("counts an inherited mandatory Control as addressed, and stops doing so when the Organization drops back", async () => {
      await setBoth("NOT_STARTED");
      expect(await unaddressedFixtures(system.untouched)).toEqual([control.both1.code, control.both2.code, control.perSystem.code].sort());
      const baseline = await needsAssessmentCount(system.untouched);

      await setBoth("FULFILLED");
      // Both Controls are addressed (one has an untouched row, one has none); the Per-System one is not.
      expect(await unaddressedFixtures(system.untouched)).toEqual([control.perSystem.code]);
      expect(await needsAssessmentCount(system.untouched)).toBe(baseline - 2);

      await setBoth("WAIVED");
      expect(await unaddressedFixtures(system.untouched)).toHaveLength(3);
      expect(await needsAssessmentCount(system.untouched)).toBe(baseline);
    });

    it("a person-set Not Started Assessment is still unaddressed, even under a Fulfilled Organization", async () => {
      await setBoth("FULFILLED");
      expect(await unaddressedFixtures(personSetSystem.NOT_STARTED)).toEqual([control.both1.code, control.both2.code, control.perSystem.code].sort());
      // Any other person-set status is addressed anyway.
      expect(await unaddressedFixtures(personSetSystem.IN_PROGRESS)).toEqual([control.perSystem.code]);
    });

    it("refuses submission while the Organization has not Fulfilled the Both Controls, and accepts it once it has", async () => {
      // Every other mandatory Control that applies (the seeded catalog's, on a seeded DB) and the Per-System fixture are Fulfilled by the owner.
      const draft = await classification(system.draft);
      const others = (await getUnaddressedMandatoryControls(draft)).filter((c) => c.id !== control.both1.id && c.id !== control.both2.id);
      await prisma.controlAssessment.createMany({
        data: others.map((c) => ({ systemId: system.draft, controlId: c.id, status: "FULFILLED" as const, assessedById: ownerId })),
        skipDuplicates: true,
      });
      const request = () =>
        new NextRequest(`http://localhost/api/systems/${system.draft}/submit`, {
          method: "POST",
          headers: new Headers({ cookie: `${ACTING_USER_COOKIE}=${ownerId}` }),
        });
      const ctx = { params: Promise.resolve({ id: system.draft }) };

      await setBoth("NOT_STARTED");
      const refused = await submit(request(), ctx);
      expect(refused.status).toBe(400);
      expect((await refused.json()).error).toContain(control.both1.code);

      await setBoth("FULFILLED");
      const accepted = await submit(request(), ctx);
      expect(accepted.status).toBe(200);
      expect((await prisma.system.findUniqueOrThrow({ where: { id: system.draft } })).status).toBe("IN_REVIEW");
      // The inherited Controls still have no Assessment rows: nothing was written for them.
      expect(await prisma.controlAssessment.count({ where: { systemId: system.draft, controlId: { in: [control.both1.id, control.both2.id] } } })).toBe(0);
    });
  });
});

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getSystemAssessments, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { getComplianceForSystems } from "@/lib/compliance";
import { getSystemsNeedingAttention } from "@/lib/dashboard";
import { loadProviderSources } from "@/lib/effective-status-data";
import {
  countRowStatuses,
  deriveFrameworkStatusesForSystems,
  getSystemFrameworkRequirements,
  type DerivationSystem,
} from "@/lib/requirement-status";
import { mapControlsToFramework } from "@/test/framework-fixtures";
import { patchSystemClassification, requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { POST as submit } from "@/app/api/systems/[id]/submit/route";
import { POST as reset } from "@/app/api/systems/[id]/assessments/[controlId]/reset/route";

/**
 * Every reader of a Control's status sees the Provider sources (F-IN.3-F-IN.5, OQ-2, #124): the
 * System page's rows, the derived Requirement status, the Compliance Percentage, the submission
 * check, the "needs assessment" count and the reset. Self-contained fixtures against real Postgres
 * (CI's DB is migrated, not seeded): see `provider-fixtures.ts`.
 */

const f = setupProviderFixtures("PrvRead");

const classification = (id: string): Promise<DerivationSystem & { isProvider: boolean }> =>
  prisma.system.findUniqueOrThrow({ where: { id }, include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } } });
const rowOf = async (systemId: string, controlId: string) => {
  const rows = await getSystemAssessments(await classification(systemId));
  return rows.find((row) => row.control.id === controlId)!;
};
const setOrganization = (controlId: string, status: ControlAssessmentStatus) =>
  prisma.organizationControlImplementation.upsert({ where: { controlId }, create: { controlId, status }, update: { status } });
const sourceNames = (row: Awaited<ReturnType<typeof rowOf>>) =>
  row.effective.sources.map((source) => (source.kind === "PROVIDER" ? source.provider.name : "Organization"));

/** A Provider offering `controlId` Full with its own status `status` (Onboarded unless `status` of the System says otherwise). */
async function makeProvider(
  options: { name?: string; controlId?: string; status?: ControlAssessmentStatus; systemStatus?: "ONBOARDED" | "DRAFT"; untouched?: boolean } = {},
) {
  const providerId = await f.makeSystem({ isProvider: true, name: options.name, status: options.systemStatus });
  const controlId = options.controlId ?? f.controls.perSystem.id;
  await f.offer(providerId, controlId);
  // `untouched`: nobody set the Provider's own row, so its own inheritance (not a person) decides its effective status.
  if (options.status) await f.assess(providerId, controlId, options.status, options.untouched ? null : f.users.owner);
  return providerId;
}

describe("a Provider's Full Offering is inherited live", { timeout: 60_000 }, () => {
  it("makes an untouched Per-System Control Fulfilled while the Provider's own status is, and drops it when it isn't, writing nothing to the dependent", async () => {
    const providerId = await makeProvider({ name: `Test PrvRead Landing Zone ${f.suffix}`, status: "NOT_STARTED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "NOT_STARTED", null);
    await f.depend(systemId, providerId);
    const stored = () => prisma.controlAssessment.findMany({ where: { systemId }, orderBy: { controlId: "asc" } });
    const before = await stored();

    let row = await rowOf(systemId, f.controls.perSystem.id);
    expect(row.effective.status).toBe("NOT_STARTED");
    expect(row.effective.sources).toEqual([
      expect.objectContaining({ kind: "PROVIDER", type: "FULL", status: "NOT_STARTED", givesCredit: false, providerOnboarded: true, appliesToProvider: true }),
    ]);

    await f.assess(providerId, f.controls.perSystem.id, "FULFILLED");
    row = await rowOf(systemId, f.controls.perSystem.id);
    expect(row.effective.status).toBe("FULFILLED");
    expect(row.effective.source).toMatchObject({ kind: "PROVIDER", type: "FULL", provider: { id: providerId, name: `Test PrvRead Landing Zone ${f.suffix}` } });
    expect(row.assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });

    // Any other status the Provider's own Assessment can have gives no credit.
    for (const status of ["IN_PROGRESS", "WAIVED", "NOT_APPLICABLE", "NOT_STARTED"] as const) {
      await f.assess(providerId, f.controls.perSystem.id, status);
      const dropped = await rowOf(systemId, f.controls.perSystem.id);
      expect(dropped.effective.status).toBe("NOT_STARTED");
      expect(dropped.effective.sources[0]).toMatchObject({ status, givesCredit: false });
    }
    expect(await stored()).toEqual(before);
  });

  it("works for a Control with no row on the dependent, and for a Both Control", async () => {
    const providerId = await makeProvider({ status: "FULFILLED" });
    await f.offer(providerId, f.controls.both.id);
    await f.assess(providerId, f.controls.both.id, "FULFILLED");
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);

    const perSystem = await rowOf(systemId, f.controls.perSystem.id);
    expect(perSystem.assessment).toBeNull();
    expect(perSystem.effective.status).toBe("FULFILLED");
    // A Both Control lists the Organization first and then the Provider.
    const both = await rowOf(systemId, f.controls.both.id);
    expect(both.effective.status).toBe("FULFILLED");
    expect(both.effective.source.kind).toBe("PROVIDER");
    expect(both.effective.sources.map((source) => source.kind)).toEqual(["ORGANIZATION", "PROVIDER"]);
  });

  it("gives a Control the Provider doesn't offer nothing, and a Control the dependent doesn't take no row at all", async () => {
    const providerId = await makeProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);
    expect((await rowOf(systemId, f.controls.stale.id)).effective.sources).toEqual([]);
    expect((await rowOf(systemId, f.controls.stale.id)).effective.status).toBe("NOT_STARTED");
  });

  it.each(["NOT_STARTED", "IN_PROGRESS", "FULFILLED", "WAIVED", "NOT_APPLICABLE"] as const)(
    "never overrides a person-set own %s Assessment on the dependent",
    async (status) => {
      const providerId = await makeProvider({ status: "FULFILLED" });
      const systemId = await f.makeSystem();
      await f.assess(systemId, f.controls.perSystem.id, status);
      await f.depend(systemId, providerId);

      const row = await rowOf(systemId, f.controls.perSystem.id);

      expect(row.effective.status).toBe(status);
      expect(row.effective.source).toEqual({ kind: "SYSTEM" });
      expect(row.effective.overridesInherited).toBe(status !== "FULFILLED");
      expect(row.assessment?.status).toBe(status);
    },
  );

  it("lists a Provider that is pending (not Onboarded) and gives no credit, until it is Onboarded", async () => {
    const providerId = await makeProvider({ status: "FULFILLED", systemStatus: "DRAFT" });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);

    const pending = await rowOf(systemId, f.controls.perSystem.id);
    expect(pending.effective.status).toBe("NOT_STARTED");
    expect(pending.effective.sources[0]).toMatchObject({ kind: "PROVIDER", status: "FULFILLED", providerOnboarded: false, givesCredit: false });

    await prisma.system.update({ where: { id: providerId }, data: { status: "ONBOARDED" } });
    expect((await rowOf(systemId, f.controls.perSystem.id)).effective.status).toBe("FULFILLED");
  });

  it("lists a Shared Offering with its customer responsibility and gives it no credit", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    await f.offer(providerId, f.controls.perSystem.id, "SHARED", "The tenant manages its own keys");
    await f.assess(providerId, f.controls.perSystem.id, "FULFILLED");
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);

    const row = await rowOf(systemId, f.controls.perSystem.id);

    expect(row.effective.status).toBe("NOT_STARTED");
    expect(row.effective.sources).toEqual([
      expect.objectContaining({ kind: "PROVIDER", type: "SHARED", status: "FULFILLED", customerResponsibility: "The tenant manages its own keys", givesCredit: false }),
    ]);
  });

  it("gives no credit for an Offering whose Control stopped applying to the Provider, but still lists it", async () => {
    // The Provider declares the stale Facet and offers the Control scoped to it.
    const providerId = await f.makeSystem({ isProvider: true });
    await f.offer(providerId, f.controls.stale.id);
    await f.assess(providerId, f.controls.stale.id, "FULFILLED");
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);
    expect((await rowOf(systemId, f.controls.stale.id)).effective.status).toBe("FULFILLED");

    // The Provider drops the stale Facet: the Offering is kept (#123) and the Provider's Fulfilled row stays, as a stale row.
    await patchSystemClassification(providerId, f.users.owner, { deploymentFacetIds: [f.facets.live] });
    expect(await prisma.controlOffering.count({ where: { providerId, controlId: f.controls.stale.id } })).toBe(1);

    const row = await rowOf(systemId, f.controls.stale.id);
    expect(row.effective.status).toBe("NOT_STARTED");
    expect(row.effective.sources).toEqual([
      expect.objectContaining({ kind: "PROVIDER", status: "FULFILLED", appliesToProvider: false, givesCredit: false }),
    ]);
  });

  describe("several sources for one Control (OQ-2)", () => {
    it("two Providers, one Fulfilled and one not: the Fulfilled one wins and both are listed, by name", async () => {
      const notYet = await makeProvider({ name: `Test PrvRead Alpha ${f.suffix}`, status: "IN_PROGRESS" });
      const done = await makeProvider({ name: `Test PrvRead Beta ${f.suffix}`, status: "FULFILLED" });
      const systemId = await f.makeSystem();
      await f.depend(systemId, done);
      await f.depend(systemId, notYet);

      const row = await rowOf(systemId, f.controls.perSystem.id);

      expect(row.effective.status).toBe("FULFILLED");
      expect(row.effective.source).toMatchObject({ kind: "PROVIDER", provider: { id: done } });
      expect(sourceNames(row)).toEqual([`Test PrvRead Alpha ${f.suffix}`, `Test PrvRead Beta ${f.suffix}`]);
      expect(row.effective.sources.map((source) => source.givesCredit)).toEqual([false, true]);
    });

    it("the Organization and a Provider together: either giving credit is enough, and both are listed", async () => {
      const providerId = await makeProvider({ controlId: f.controls.both.id, status: "FULFILLED" });
      const systemId = await f.makeSystem();
      await f.depend(systemId, providerId);

      await setOrganization(f.controls.both.id, "NOT_STARTED");
      let row = await rowOf(systemId, f.controls.both.id);
      expect(row.effective.status).toBe("FULFILLED");
      expect(row.effective.source.kind).toBe("PROVIDER");
      expect(row.effective.sources.map((source) => source.givesCredit)).toEqual([false, true]);

      await setOrganization(f.controls.both.id, "FULFILLED");
      row = await rowOf(systemId, f.controls.both.id);
      expect(row.effective.source.kind).toBe("ORGANIZATION");
      expect(row.effective.sources.map((source) => source.givesCredit)).toEqual([true, true]);

      await f.assess(providerId, f.controls.both.id, "NOT_STARTED");
      row = await rowOf(systemId, f.controls.both.id);
      expect(row.effective.status).toBe("FULFILLED");
      expect(row.effective.sources.map((source) => source.givesCredit)).toEqual([true, false]);
    });
  });

  describe("no chains through a Provider's own sources", () => {
    it("a Provider whose own Assessment is Not Started gives no credit, even though its effective status is Fulfilled through its own Provider", async () => {
      const upstream = await makeProvider({ name: `Test PrvRead Upstream ${f.suffix}`, status: "FULFILLED" });
      const middle = await makeProvider({ name: `Test PrvRead Middle ${f.suffix}`, status: "NOT_STARTED", untouched: true });
      await f.depend(middle, upstream);
      expect((await rowOf(middle, f.controls.perSystem.id)).effective.status).toBe("FULFILLED"); // through its own Provider
      const systemId = await f.makeSystem();
      await f.depend(systemId, middle);

      const row = await rowOf(systemId, f.controls.perSystem.id);

      expect(row.effective.status).toBe("NOT_STARTED");
      expect(row.effective.sources).toEqual([expect.objectContaining({ status: "NOT_STARTED", givesCredit: false })]);
      expect(sourceNames(row)).toEqual([`Test PrvRead Middle ${f.suffix}`]);
    });

    it("a Provider whose own Assessment is Not Started gives no credit even though the Organization Fulfilled the Both Control", async () => {
      await setOrganization(f.controls.both.id, "FULFILLED");
      const providerId = await makeProvider({ controlId: f.controls.both.id, status: "NOT_STARTED", untouched: true });
      expect((await rowOf(providerId, f.controls.both.id)).effective.status).toBe("FULFILLED");
      const systemId = await f.makeSystem();
      await f.depend(systemId, providerId);

      const providerSource = (await rowOf(systemId, f.controls.both.id)).effective.sources.find((source) => source.kind === "PROVIDER");

      expect(providerSource).toMatchObject({ status: "NOT_STARTED", givesCredit: false });
      await setOrganization(f.controls.both.id, "NOT_STARTED");
    });
  });

  it("two Systems depending on each other are harmless: each reads the other's own status only", async () => {
    const a = await f.makeSystem({ isProvider: true });
    const b = await f.makeSystem({ isProvider: true });
    for (const providerId of [a, b]) await f.offer(providerId, f.controls.perSystem.id);
    await f.assess(a, f.controls.perSystem.id, "FULFILLED");
    await f.depend(a, b);
    await f.depend(b, a);

    expect((await rowOf(b, f.controls.perSystem.id)).effective.status).toBe("FULFILLED"); // inherits A's own Fulfilled
    expect((await rowOf(a, f.controls.perSystem.id)).effective.status).toBe("FULFILLED"); // A's own, person-set
    expect((await rowOf(a, f.controls.perSystem.id)).effective.source).toEqual({ kind: "SYSTEM" });
  });
});

describe("derived Requirement status and the Compliance Percentage", { timeout: 60_000 }, () => {
  let requirementId: string;
  const statusOf = async (systemId: string) => {
    const derived = await deriveFrameworkStatusesForSystems(f.frameworkId, [await classification(systemId)]);
    return derived!.bySystem.get(systemId)!.find((row) => row.requirementId === requirementId)!;
  };

  it("a Requirement is Met only through a Provider, and the Compliance Percentage moves with the dependency", async () => {
    requirementId = await mapControlsToFramework(f.frameworkId, [f.controls.perSystem.id]);
    const providerId = await makeProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    const compliance = () => getComplianceForSystems({ id: systemId }, { frameworkId: f.frameworkId });

    expect((await statusOf(systemId)).status).toBe("NOT_MET");
    const before = await compliance();

    await f.depend(systemId, providerId);
    const met = await statusOf(systemId);
    expect(met.status).toBe("MET");
    expect(met.controls[0]).toMatchObject({ assessmentStatus: "NOT_STARTED", effective: { status: "FULFILLED", source: { kind: "PROVIDER" } } });
    const after = await compliance();
    expect(after.met).toBe(before.met + 1);
    expect(after.applicable).toBe(before.applicable);

    await prisma.providerDependency.deleteMany({ where: { dependentId: systemId } });
    expect((await statusOf(systemId)).status).toBe("NOT_MET");
    expect((await compliance()).met).toBe(before.met);
  });

  it("the bulk derivation and the single-System rows agree, with Providers in the mix", async () => {
    requirementId = requirementId ?? (await mapControlsToFramework(f.frameworkId, [f.controls.perSystem.id]));
    const fulfilled = await makeProvider({ status: "FULFILLED" });
    const pending = await makeProvider({ status: "FULFILLED", systemStatus: "DRAFT" });
    const inProgress = await makeProvider({ status: "IN_PROGRESS" });
    const viaFulfilled = await f.makeSystem();
    await f.depend(viaFulfilled, fulfilled);
    const viaPending = await f.makeSystem();
    await f.depend(viaPending, pending);
    const viaBoth = await f.makeSystem();
    await f.depend(viaBoth, inProgress);
    await f.depend(viaBoth, fulfilled);
    const personSet = await f.makeSystem();
    await f.assess(personSet, f.controls.perSystem.id, "IN_PROGRESS");
    await f.depend(personSet, fulfilled);
    const nothing = await f.makeSystem();
    const ids = [viaFulfilled, viaPending, viaBoth, personSet, nothing];
    const systems = await Promise.all(ids.map(classification));

    const bulk = await deriveFrameworkStatusesForSystems(f.frameworkId, systems);

    for (const system of systems) {
      const alone = await deriveFrameworkStatusesForSystems(f.frameworkId, [system]);
      expect(bulk!.bySystem.get(system.id)).toEqual(alone!.bySystem.get(system.id));
      const perFramework = (await getSystemFrameworkRequirements(system)).find((entry) => entry.framework.id === f.frameworkId)!;
      expect(perFramework.rows).toEqual(bulk!.bySystem.get(system.id));
      expect(perFramework.counts).toEqual(countRowStatuses(bulk!.bySystem.get(system.id)!));
      // And the Control rows the System page lists give the same effective status as the Requirement derivation.
      const derivedControl = bulk!.bySystem.get(system.id)!.find((row) => row.requirementId === requirementId)!.controls[0];
      expect((await rowOf(system.id, f.controls.perSystem.id)).effective).toEqual(derivedControl.effective);
    }
    const statuses = ids.map((id) => bulk!.bySystem.get(id)!.find((row) => row.requirementId === requirementId)!.status);
    expect(statuses).toEqual(["MET", "NOT_MET", "MET", "NOT_MET", "NOT_MET"]);
  });
});

describe("the number of queries does not grow with the number of Systems", { timeout: 60_000 }, () => {
  it("loads Provider sources with the same queries for 1 and for many dependents, and none without a dependency", async () => {
    const providerId = await makeProvider({ status: "FULFILLED" });
    const dependents: string[] = [];
    for (let i = 0; i < 12; i++) {
      const id = await f.makeSystem();
      await f.depend(id, providerId);
      dependents.push(id);
    }
    // A client that counts every call the loader makes, by model and operation (passed as the loader's `db`).
    const calls: string[] = [];
    const counting = new Proxy(
      {},
      {
        get: (_target, model: string) =>
          new Proxy(
            {},
            {
              get:
                (_t, operation: string) =>
                (...args: unknown[]) => {
                  calls.push(`${model}.${operation}`);
                  return (prisma as never as Record<string, Record<string, (...a: unknown[]) => unknown>>)[model][operation](...args);
                },
            },
          ),
      },
    ) as typeof prisma;
    const controlIds = [f.controls.perSystem.id, f.controls.both.id];

    await loadProviderSources(dependents.slice(0, 1), controlIds, counting);
    const one = calls.splice(0);
    expect(one.sort()).toEqual(["control.findMany", "controlAssessment.findMany", "controlOffering.findMany", "providerDependency.findMany"]);

    const many = await loadProviderSources(dependents, controlIds, counting);
    expect(many.size).toBe(12);
    expect(calls.splice(0).sort()).toEqual(one);

    // Systems without a dependency cost the one dependency query and nothing else.
    const stranger = await f.makeSystem();
    await loadProviderSources([stranger], controlIds, counting);
    expect(calls.splice(0)).toEqual(["providerDependency.findMany"]);
  });
});

describe("the submission check and the \"needs assessment\" count", { timeout: 60_000 }, () => {
  const fixtureControlIds = () => new Set(Object.values(f.controls).map((control) => control.id));
  const unaddressedFixtures = async (systemId: string) =>
    (await getUnaddressedMandatoryControls(await classification(systemId))).filter((control) => fixtureControlIds().has(control.id)).map((control) => control.code);
  const needsAssessmentCount = async (ownerId: string, systemId: string) => {
    const entry = (await getSystemsNeedingAttention(ownerId)).find((e) => e.id === systemId && e.reason === "needs-assessment");
    return entry && entry.reason === "needs-assessment" ? entry.count : 0;
  };

  it("counts an inherited mandatory Control as addressed, and a pending Provider's as not", async () => {
    const providerId = await makeProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem({ ownerId: f.users.otherOwner });
    await f.assess(systemId, f.controls.both.id, "IN_PROGRESS");
    await f.assess(systemId, f.controls.stale.id, "IN_PROGRESS");
    expect(await unaddressedFixtures(systemId)).toEqual([f.controls.perSystem.code]);
    const baseline = await needsAssessmentCount(f.users.otherOwner, systemId);
    expect(baseline).toBeGreaterThanOrEqual(1);

    await f.depend(systemId, providerId);
    expect(await unaddressedFixtures(systemId)).toEqual([]);
    expect(await needsAssessmentCount(f.users.otherOwner, systemId)).toBe(baseline - 1);

    await prisma.system.update({ where: { id: providerId }, data: { status: "DRAFT" } });
    expect(await unaddressedFixtures(systemId)).toEqual([f.controls.perSystem.code]);
    expect(await needsAssessmentCount(f.users.otherOwner, systemId)).toBe(baseline);
  });

  it("a person-set Not Started Assessment is still unaddressed, under a Fulfilled Provider", async () => {
    const providerId = await makeProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "NOT_STARTED");
    await f.depend(systemId, providerId);
    expect(await unaddressedFixtures(systemId)).toContain(f.controls.perSystem.code);
  });

  it("refuses submission until the Provider's Offering addresses the Control, and accepts it after, without writing a row", async () => {
    const providerId = await makeProvider({ status: "NOT_STARTED" });
    const systemId = await f.makeSystem({ status: "DRAFT" });
    // Everything else that applies (the seeded catalog's, on a seeded DB) is addressed by the owner.
    const others = (await getUnaddressedMandatoryControls(await classification(systemId))).filter((c) => c.id !== f.controls.perSystem.id);
    await prisma.controlAssessment.createMany({
      data: others.map((c) => ({ systemId, controlId: c.id, status: "FULFILLED" as const, assessedById: f.users.owner })),
      skipDuplicates: true,
    });
    await f.depend(systemId, providerId);
    const submitAs = () =>
      submit(
        new NextRequest(`http://localhost/api/systems/${systemId}/submit`, { method: "POST", headers: new Headers({ cookie: `${ACTING_USER_COOKIE}=${f.users.owner}` }) }),
        { params: Promise.resolve({ id: systemId }) },
      );

    const refused = await submitAs();
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toContain(f.controls.perSystem.code);

    await f.assess(providerId, f.controls.perSystem.id, "FULFILLED");
    expect((await submitAs()).status).toBe(200);
    expect(await prisma.controlAssessment.count({ where: { systemId, controlId: f.controls.perSystem.id } })).toBe(0);
  });
});

describe("reset to inherited with a Provider source (#129)", { timeout: 60_000 }, () => {
  const resetAs = (systemId: string, controlId: string, userId = f.users.owner) =>
    reset(requestAs(`/api/systems/${systemId}/assessments/${controlId}/reset`, userId, "POST"), {
      params: Promise.resolve({ id: systemId, controlId }),
    });

  it("is refused on a Per-System Control with no source, and works once a Provider offers it, naming the Provider in the event", async () => {
    const providerId = await makeProvider({ name: `Test PrvRead Reset ${f.suffix}`, status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "IN_PROGRESS");

    expect((await resetAs(systemId, f.controls.perSystem.id)).status).toBe(409);

    await f.depend(systemId, providerId);
    expect((await rowOf(systemId, f.controls.perSystem.id)).effective.status).toBe("IN_PROGRESS"); // the person-set one still wins
    const response = await resetAs(systemId, f.controls.perSystem.id);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.effective.status).toBe("FULFILLED");
    expect(body.effective.source).toMatchObject({ kind: "PROVIDER", provider: { id: providerId } });
    expect(body.assessment).toMatchObject({ status: "NOT_STARTED", assessedById: null });
    const events = await prisma.changeEvent.findMany({ where: { systemId, action: "ASSESSMENT_STATUS_CHANGED" } });
    expect(events).toHaveLength(1);
    expect(events[0].detail).toContain(`now Fulfilled, inherited from Provider "Test PrvRead Reset ${f.suffix}"`);
  });

  it("is possible against a pending Provider source too: the existence of a source is enough", async () => {
    const providerId = await makeProvider({ status: "FULFILLED", systemStatus: "DRAFT" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "IN_PROGRESS");
    await f.depend(systemId, providerId);

    const response = await resetAs(systemId, f.controls.perSystem.id);

    expect(response.status).toBe(200);
    expect((await response.json()).effective.status).toBe("NOT_STARTED");
  });
});

import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import type { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getSystemAssessments, getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { getComplianceForSystems } from "@/lib/compliance";
import { getSystemsNeedingAttention } from "@/lib/dashboard";
import { PROVIDER_HALF_MISSING_STATUS } from "@/lib/effective-status";
import {
  deriveFrameworkStatusesForSystems,
  getSystemFrameworkRequirements,
  type DerivationSystem,
} from "@/lib/requirement-status";
import { mapControlsToFramework } from "@/test/framework-fixtures";
import { requestAs, setupProviderFixtures } from "@/test/provider-fixtures";
import { POST as submit } from "@/app/api/systems/[id]/submit/route";
import { POST as reset } from "@/app/api/systems/[id]/assessments/[controlId]/reset/route";

/**
 * Every reader of a Control's status follows a Shared Offering (F-IN.5 rule 3, #125): the System
 * page's rows, the derived Requirement status, the Compliance Percentage, the submission check and
 * the "needs assessment" count; and a reset needs a Full source. Self-contained fixtures against
 * real Postgres (CI's DB is migrated, not seeded): see `provider-fixtures.ts`.
 */

const f = setupProviderFixtures("ShrRead");
const TEXT = "The tenant manages its own keys";

const classification = (id: string): Promise<DerivationSystem & { isProvider: boolean }> =>
  prisma.system.findUniqueOrThrow({ where: { id }, include: { deploymentFacets: true, frameworkScopes: { select: { id: true } } } });
const rowOf = async (systemId: string, controlId: string) => {
  const rows = await getSystemAssessments(await classification(systemId));
  return rows.find((row) => row.control.id === controlId)!;
};
const storedRows = (systemId: string) => prisma.controlAssessment.findMany({ where: { systemId }, orderBy: { controlId: "asc" } });

/** A Provider offering `controlId` Shared (Onboarded unless `systemStatus` says otherwise) with its own status `status`. */
async function makeSharedProvider(
  options: { name?: string; controlId?: string; status?: ControlAssessmentStatus; systemStatus?: "ONBOARDED" | "DRAFT"; type?: "SHARED" | "FULL" } = {},
) {
  const providerId = await f.makeSystem({ isProvider: true, name: options.name, status: options.systemStatus });
  const controlId = options.controlId ?? f.controls.perSystem.id;
  await f.offer(providerId, controlId, options.type ?? "SHARED", options.type === "FULL" ? null : TEXT);
  if (options.status) await f.assess(providerId, controlId, options.status);
  return providerId;
}

describe("a Shared Offering: the System page's row (F-OUT.2)", { timeout: 60_000 }, () => {
  it("Provider Fulfilled and own Fulfilled: effectively Fulfilled, Inherited from Provider X: Shared, and no row written", async () => {
    const name = `Test ShrRead Provider ${f.suffix}`;
    const providerId = await makeSharedProvider({ name, status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    const before = await storedRows(systemId);
    await f.depend(systemId, providerId);

    const row = await rowOf(systemId, f.controls.perSystem.id);

    expect(row.effective.status).toBe("FULFILLED");
    expect(row.effective.source).toMatchObject({ kind: "PROVIDER", type: "SHARED", provider: { id: providerId, name } });
    expect(row.effective.sources).toEqual([
      expect.objectContaining({ kind: "PROVIDER", type: "SHARED", status: "FULFILLED", customerResponsibility: TEXT, givesCredit: true, customerHalfDone: true }),
    ]);
    expect(row.assessment?.status).toBe("FULFILLED");
    expect(await storedRows(systemId)).toEqual(before);
  });

  it("Provider Fulfilled, own untouched: not Fulfilled, and the owner's half is what is missing", async () => {
    const providerId = await makeSharedProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);

    const row = await rowOf(systemId, f.controls.perSystem.id);

    expect(row.effective.status).toBe("NOT_STARTED");
    expect(row.effective.source).toEqual({ kind: "SYSTEM" });
    expect(row.effective.sources).toEqual([expect.objectContaining({ givesCredit: false, customerHalfDone: false })]);
  });

  it.each(["IN_PROGRESS", "NOT_STARTED"] as const)("Provider Fulfilled, own person-set %s: that status, with no override claimed", async (status) => {
    const providerId = await makeSharedProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, status);
    await f.depend(systemId, providerId);

    const row = await rowOf(systemId, f.controls.perSystem.id);

    expect(row.effective.status).toBe(status);
    expect(row.effective.overridesInherited).toBe(false);
  });

  it.each([
    ["the Provider's own status is not Fulfilled", { status: "IN_PROGRESS" as const }],
    ["the Provider is not Onboarded", { status: "FULFILLED" as const, systemStatus: "DRAFT" as const }],
  ])("own Fulfilled but %s: In Progress (D1), the Provider's half is missing, and nothing is stored", async (_label, options) => {
    const providerId = await makeSharedProvider(options);
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    await f.depend(systemId, providerId);
    const before = await storedRows(systemId);

    const row = await rowOf(systemId, f.controls.perSystem.id);

    expect(row.effective.status).toBe(PROVIDER_HALF_MISSING_STATUS);
    expect(row.effective.source).toEqual({ kind: "SYSTEM" });
    expect(row.effective.sources[0]).toMatchObject({ givesCredit: false, customerHalfDone: true });
    expect(row.assessment?.status).toBe("FULFILLED");
    expect(await storedRows(systemId)).toEqual(before);
  });

  it("own Fulfilled and the Control no longer applies to the Provider: In Progress (D1), listed as no longer applying", async () => {
    const providerId = await f.makeSystem({ isProvider: true });
    await f.offer(providerId, f.controls.stale.id, "SHARED", TEXT);
    await f.assess(providerId, f.controls.stale.id, "FULFILLED");
    await prisma.system.update({ where: { id: providerId }, data: { deploymentFacets: { set: [{ id: f.facets.live }] } } });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.stale.id, "FULFILLED");
    await f.depend(systemId, providerId);

    const row = await rowOf(systemId, f.controls.stale.id);

    expect(row.effective.status).toBe(PROVIDER_HALF_MISSING_STATUS);
    expect(row.effective.sources[0]).toMatchObject({ appliesToProvider: false, givesCredit: false });
  });

  it.each(["WAIVED", "NOT_APPLICABLE"] as const)("own %s wins outright, whatever the Provider says", async (status) => {
    const providerId = await makeSharedProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, status);
    await f.depend(systemId, providerId);

    expect((await rowOf(systemId, f.controls.perSystem.id)).effective).toMatchObject({ status, source: { kind: "SYSTEM" } });
  });

  it("a Fulfilled Full source next to a Shared one: effectively Fulfilled, even with the owner's half open", async () => {
    const shared = await makeSharedProvider({ name: `Test ShrRead Shared ${f.suffix}`, status: "FULFILLED" });
    const full = await makeSharedProvider({ name: `Test ShrRead Full ${f.suffix}`, status: "FULFILLED", type: "FULL" });
    const systemId = await f.makeSystem();
    await f.depend(systemId, shared);
    await f.depend(systemId, full);

    const untouched = await rowOf(systemId, f.controls.perSystem.id);
    expect(untouched.effective.status).toBe("FULFILLED");
    expect(untouched.effective.source).toMatchObject({ kind: "PROVIDER", type: "FULL" });

    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    expect((await rowOf(systemId, f.controls.perSystem.id)).effective.status).toBe("FULFILLED");
  });

  it("several Shared Offerings: one satisfied is enough, and every one is listed", async () => {
    const control = f.controls.perSystem.id;
    const behind = await makeSharedProvider({ name: `Test ShrRead Alpha ${f.suffix}`, status: "IN_PROGRESS" });
    const ready = await makeSharedProvider({ name: `Test ShrRead Beta ${f.suffix}`, status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, control, "FULFILLED");
    await f.depend(systemId, behind);
    await f.depend(systemId, ready);

    const row = await rowOf(systemId, control);

    expect(row.effective.status).toBe("FULFILLED");
    expect(row.effective.source).toMatchObject({ provider: { id: ready } });
    expect(row.effective.sources.map((s) => s.givesCredit)).toEqual([false, true]);

    await prisma.system.update({ where: { id: ready }, data: { status: "DRAFT" } });
    expect((await rowOf(systemId, control)).effective.status).toBe(PROVIDER_HALF_MISSING_STATUS);
  });

  it("an own Fulfilled that a Capability set is the customer's half too (D3)", async () => {
    const providerId = await makeSharedProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED", null); // assessedById null: not a person
    await f.depend(systemId, providerId);

    expect((await rowOf(systemId, f.controls.perSystem.id)).effective).toMatchObject({ status: "FULFILLED", source: { kind: "PROVIDER", type: "SHARED" } });

    await prisma.system.update({ where: { id: providerId }, data: { status: "DRAFT" } });
    expect((await rowOf(systemId, f.controls.perSystem.id)).effective.status).toBe(PROVIDER_HALF_MISSING_STATUS);
  });

  it("a Both Control: the Organization is a Full source next to a Shared one", async () => {
    const control = f.controls.both.id;
    await prisma.organizationControlImplementation.upsert({ where: { controlId: control }, create: { controlId: control, status: "NOT_STARTED" }, update: { status: "NOT_STARTED" } });
    const providerId = await makeSharedProvider({ controlId: control, status: "IN_PROGRESS" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, control, "FULFILLED");
    await f.depend(systemId, providerId);

    expect((await rowOf(systemId, control)).effective.status).toBe(PROVIDER_HALF_MISSING_STATUS);
    await prisma.organizationControlImplementation.update({ where: { controlId: control }, data: { status: "FULFILLED" } });
    expect((await rowOf(systemId, control)).effective.status).toBe("FULFILLED");
    await prisma.organizationControlImplementation.update({ where: { controlId: control }, data: { status: "NOT_STARTED" } });
  });
});

describe("derived Requirement status and the Compliance Percentage", { timeout: 60_000 }, () => {
  let requirementId = "";
  const statusOf = async (systemId: string) => {
    const derived = await deriveFrameworkStatusesForSystems(f.frameworkId, [await classification(systemId)]);
    return derived!.bySystem.get(systemId)!.find((row) => row.requirementId === requirementId)!;
  };
  const compliance = (systemId: string) => getComplianceForSystems({ id: systemId }, { frameworkId: f.frameworkId });

  it("is Met only while both halves are done, and a held-back Control (D1) is not Met", async () => {
    requirementId = await mapControlsToFramework(f.frameworkId, [f.controls.perSystem.id]);
    const providerId = await makeSharedProvider({ status: "IN_PROGRESS" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    const alone = await compliance(systemId);
    expect((await statusOf(systemId)).status).toBe("MET"); // Fulfilled by the owner, no dependency yet

    await f.depend(systemId, providerId);
    const held = await statusOf(systemId);
    expect(held.status).toBe("NOT_MET");
    expect(held.controls[0]).toMatchObject({ assessmentStatus: "FULFILLED", effective: { status: "IN_PROGRESS" } });
    const heldCompliance = await compliance(systemId);
    expect(heldCompliance.met).toBe(alone.met - 1);
    expect(heldCompliance.applicable).toBe(alone.applicable);

    await f.assess(providerId, f.controls.perSystem.id, "FULFILLED");
    const met = await statusOf(systemId);
    expect(met.status).toBe("MET");
    expect(met.controls[0]).toMatchObject({ effective: { status: "FULFILLED", source: { kind: "PROVIDER", type: "SHARED" } } });
    expect((await compliance(systemId)).met).toBe(alone.met);

    await prisma.providerDependency.deleteMany({ where: { dependentId: systemId } });
    expect((await statusOf(systemId)).status).toBe("MET");
  });

  it("an untouched Control under a Fulfilled Shared Provider is not Met: the owner's half is open", async () => {
    requirementId = requirementId || (await mapControlsToFramework(f.frameworkId, [f.controls.perSystem.id]));
    const providerId = await makeSharedProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.depend(systemId, providerId);
    expect((await statusOf(systemId)).status).toBe("NOT_MET");
  });

  it("the bulk derivation, the single-System rows and the System page's rows agree, with Shared Offerings in the mix", async () => {
    requirementId = requirementId || (await mapControlsToFramework(f.frameworkId, [f.controls.perSystem.id]));
    const control = f.controls.perSystem.id;
    const ready = await makeSharedProvider({ status: "FULFILLED" });
    const behind = await makeSharedProvider({ status: "IN_PROGRESS" });
    const full = await makeSharedProvider({ status: "FULFILLED", type: "FULL" });

    const bothHalves = await f.makeSystem();
    await f.assess(bothHalves, control, "FULFILLED");
    await f.depend(bothHalves, ready);
    const providerBehind = await f.makeSystem();
    await f.assess(providerBehind, control, "FULFILLED");
    await f.depend(providerBehind, behind);
    const ownOpen = await f.makeSystem();
    await f.depend(ownOpen, ready);
    const fullAndShared = await f.makeSystem();
    await f.depend(fullAndShared, behind);
    await f.depend(fullAndShared, full);
    const waived = await f.makeSystem();
    await f.assess(waived, control, "WAIVED");
    await f.depend(waived, ready);
    const capability = await f.makeSystem();
    await f.assess(capability, control, "FULFILLED", null);
    await f.depend(capability, ready);
    const ids = [bothHalves, providerBehind, ownOpen, fullAndShared, waived, capability];
    const systems = await Promise.all(ids.map(classification));

    const bulk = await deriveFrameworkStatusesForSystems(f.frameworkId, systems);

    for (const system of systems) {
      const alone = await deriveFrameworkStatusesForSystems(f.frameworkId, [system]);
      expect(bulk!.bySystem.get(system.id)).toEqual(alone!.bySystem.get(system.id));
      const perFramework = (await getSystemFrameworkRequirements(system)).find((entry) => entry.framework.id === f.frameworkId)!;
      expect(perFramework.rows).toEqual(bulk!.bySystem.get(system.id));
      const derivedControl = bulk!.bySystem.get(system.id)!.find((row) => row.requirementId === requirementId)!.controls[0];
      expect((await rowOf(system.id, control)).effective).toEqual(derivedControl.effective);
    }
    const statuses = ids.map((id) => bulk!.bySystem.get(id)!.find((row) => row.requirementId === requirementId)!.status);
    // both halves; Provider behind (D1); own half open; Full credit; Waived counts (lenient Framework); Capability's own Fulfilled.
    expect(statuses).toEqual(["MET", "NOT_MET", "NOT_MET", "MET", "MET", "MET"]);
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

  it("a held-back Control (own Fulfilled, the Provider's half missing) passes the check and is not a task for the owner (D1)", async () => {
    const providerId = await makeSharedProvider({ status: "NOT_STARTED" });
    const systemId = await f.makeSystem({ ownerId: f.users.otherOwner });
    await f.assess(systemId, f.controls.both.id, "IN_PROGRESS");
    await f.assess(systemId, f.controls.stale.id, "IN_PROGRESS");
    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    expect(await unaddressedFixtures(systemId)).toEqual([]);
    const baseline = await needsAssessmentCount(f.users.otherOwner, systemId);

    await f.depend(systemId, providerId);

    expect((await rowOf(systemId, f.controls.perSystem.id)).effective.status).toBe(PROVIDER_HALF_MISSING_STATUS);
    expect(await unaddressedFixtures(systemId)).toEqual([]);
    expect(await needsAssessmentCount(f.users.otherOwner, systemId)).toBe(baseline);
  });

  it("an untouched Control under a satisfied Shared Provider IS in the check and in \"needs assessment\": it is a task for the owner", async () => {
    const providerId = await makeSharedProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem({ ownerId: f.users.otherOwner });
    await f.assess(systemId, f.controls.both.id, "IN_PROGRESS");
    await f.assess(systemId, f.controls.stale.id, "IN_PROGRESS");
    await f.depend(systemId, providerId);

    expect(await unaddressedFixtures(systemId)).toEqual([f.controls.perSystem.code]);
    const count = await needsAssessmentCount(f.users.otherOwner, systemId);
    expect(count).toBeGreaterThanOrEqual(1);

    // The owner does their half: it is addressed and Fulfilled through the Provider.
    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    expect(await unaddressedFixtures(systemId)).toEqual([]);
    expect(await needsAssessmentCount(f.users.otherOwner, systemId)).toBe(count - 1);
  });

  it("refuses submission while a Control is untouched under a Shared Provider, and accepts it once the owner has done their half, whatever the Provider says", async () => {
    const providerId = await makeSharedProvider({ status: "NOT_STARTED" });
    const systemId = await f.makeSystem({ status: "DRAFT" });
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

    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    expect((await submitAs()).status).toBe(200); // the Provider's half is still missing: not a task for the owner
  });
});

describe("reset to inherited needs a Full source (D2)", { timeout: 60_000 }, () => {
  const resetAs = (systemId: string, controlId: string, userId = f.users.owner) =>
    reset(requestAs(`/api/systems/${systemId}/assessments/${controlId}/reset`, userId, "POST"), {
      params: Promise.resolve({ id: systemId, controlId }),
    });

  it("is refused with 409 when only Shared Offerings cover the Control, and nothing changes", async () => {
    const providerId = await makeSharedProvider({ status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "FULFILLED");
    await f.depend(systemId, providerId);
    const rowsBefore = await storedRows(systemId);
    const eventsBefore = await prisma.changeEvent.count({ where: { systemId } });

    const response = await resetAs(systemId, f.controls.perSystem.id);

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/no inheritance source/);
    expect(await storedRows(systemId)).toEqual(rowsBefore);
    expect(await prisma.changeEvent.count({ where: { systemId } })).toBe(eventsBefore);
  });

  it("works when a Full source sits next to the Shared one, clearing the own half and going back to the Full credit", async () => {
    const shared = await makeSharedProvider({ name: `Test ShrRead ResetShared ${f.suffix}`, status: "IN_PROGRESS" });
    const full = await makeSharedProvider({ name: `Test ShrRead ResetFull ${f.suffix}`, status: "FULFILLED", type: "FULL" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, f.controls.perSystem.id, "IN_PROGRESS");
    await f.depend(systemId, shared);
    await f.depend(systemId, full);

    const response = await resetAs(systemId, f.controls.perSystem.id);

    expect(response.status).toBe(200);
    expect((await response.json()).effective).toMatchObject({ status: "FULFILLED", source: { kind: "PROVIDER", type: "FULL" } });
  });

  it("still works for the Organization as a Full source next to a Shared one", async () => {
    const control = f.controls.both.id;
    await prisma.organizationControlImplementation.upsert({ where: { controlId: control }, create: { controlId: control, status: "NOT_STARTED" }, update: { status: "NOT_STARTED" } });
    const providerId = await makeSharedProvider({ controlId: control, status: "FULFILLED" });
    const systemId = await f.makeSystem();
    await f.assess(systemId, control, "IN_PROGRESS");
    await f.depend(systemId, providerId);

    expect((await resetAs(systemId, control)).status).toBe(200);
  });
});

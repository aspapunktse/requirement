import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getComplianceForSystems } from "@/lib/compliance";
import { cleanupFixtureRequirements, mapControlsToBase } from "@/test/framework-fixtures";
import { utcDay } from "@/app/home/home-snapshots";
import { weekEnds } from "@/app/home/home-trends";
import type { Prisma } from "@prisma/client";
import { DEFAULT_SYSTEMS_THRESHOLDS } from "@/lib/app-settings";
import { inRoleView, loadSystemsView, needsAttention, readSystemRows } from "../systems-data";
import { systemsSnapshotRows, systemsStatKey } from "../systems-trends";
import { roleViewOf, viewCounts } from "../systems-logic";
import type { SystemRow } from "../systems-types";

/**
 * The Systems list's server side (#232), against real Postgres with its own `Test …` fixtures (CI's
 * database is migrated but not seeded; the seeded Systems of a dev database also show up for the roles
 * that see everything, so every assertion looks at the fixture Systems only).
 *
 *   owner (System Owner)      S1 Draft, untouched for 90 days, a closed Risk     S2 In Review, in the BU, Provider,
 *                                                                                 Availability not classified, one
 *                                                                                 open Query awaiting the owner,
 *                                                                                 one fulfilled base Control
 *   other (System Owner)      S3 Onboarded, in the BU, an open Risk, a closed one S4 Rejected   S5 Draft, fresh
 */
const suffix = `${process.pid}-${Date.now()}`;
const day = 86_400_000;
const now = new Date();

type Fixture = { id: string; name: string; role: UserRole };
const created: Fixture[] = [];
const user = async (key: string, role: UserRole, data: Record<string, unknown> = {}): Promise<Fixture> => {
  const row = await prisma.user.create({ data: { email: `test-systems-${key}-${suffix}@example.com`, name: `Test Systems ${key}`, role, ...data } });
  created.push({ id: row.id, name: row.name, role });
  return { id: row.id, name: row.name, role };
};

let owner: Fixture;
let other: Fixture;
let reviewer: Fixture;
let riskOwner: Fixture;
let businessRiskOwner: Fixture;
let manager: Fixture;
let viewer: Fixture;
let unitId: string;
let unit2Id: string;
let facetId: string;
let controlId: string;
let s1: string;
let s2: string;
let s3: string;
let s4: string;
let s5: string;

const rowsOf = async (u: Fixture) => {
  const view = await loadSystemsView(u, now);
  return { view, byId: new Map(view.rows.map((row) => [row.id, row])) };
};

beforeAll(async () => {
  unitId = (await prisma.businessUnit.create({ data: { name: `Test Systems BU ${suffix}` } })).id;
  unit2Id = (await prisma.businessUnit.create({ data: { name: `Test Systems BU2 ${suffix}` } })).id;
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test Systems Facet ${suffix}` } })).id;
  owner = await user("owner", "SYSTEM_OWNER");
  other = await user("other", "SYSTEM_OWNER");
  reviewer = await user("reviewer", "REVIEWER");
  riskOwner = await user("risk-owner", "RISK_OWNER");
  businessRiskOwner = await user("bro", "BUSINESS_RISK_OWNER", { businessUnitScopes: { connect: { id: unitId } } });
  manager = await user("manager", "COMPLIANCE_MANAGER");
  viewer = await user("viewer", "VIEWER");

  const control = await prisma.control.create({
    data: { code: `TEST-SYSTEMS-${suffix}`, title: "Test systems control", description: "d", category: "Test", applicability: "BOTH", mandatory: true, deploymentFacets: { connect: { id: facetId } } },
  });
  controlId = control.id;
  await mapControlsToBase([controlId]);

  const system = async (name: string, ownerId: string, data: Record<string, unknown> = {}) =>
    (await prisma.system.create({ data: { name: `Test Systems ${name} ${suffix}`, ownerId, ...data } })).id;
  s1 = await system("S1", owner.id, { status: "DRAFT", vendor: "Vendor One" });
  s2 = await system("S2", owner.id, {
    status: "IN_REVIEW",
    isProvider: true,
    confidentialityImpactLevel: "HIGH",
    integrityImpactLevel: "LOW",
    deploymentFacets: { connect: { id: facetId } },
    businessUnits: { connect: [{ id: unitId }, { id: unit2Id }] },
  });
  s3 = await system("S3", other.id, { status: "ONBOARDED", businessUnits: { connect: { id: unitId } } });
  s4 = await system("S4", other.id, { status: "REJECTED" });
  s5 = await system("S5", other.id, { status: "DRAFT" });
  await prisma.$executeRaw`UPDATE "System" SET "updatedAt" = ${new Date(now.getTime() - 90 * day)} WHERE id = ${s1}`;

  await prisma.risk.createMany({
    data: [
      { systemId: s1, title: "Test closed", description: "d", severity: "LOW", likelihood: "LOW", status: "CLOSED" },
      { systemId: s3, title: "Test open", description: "d", severity: "HIGH", likelihood: "LOW", status: "OPEN" },
      { systemId: s3, title: "Test closed", description: "d", severity: "HIGH", likelihood: "LOW", status: "CLOSED" },
    ],
  });
  const assessment = await prisma.controlAssessment.create({ data: { systemId: s2, controlId, status: "FULFILLED" } });
  // The last message is the reviewer's, so the question waits for the System's owner.
  await prisma.assessmentQuery.create({ data: { controlAssessmentId: assessment.id, lastMessageAuthorId: reviewer.id } });
});

afterAll(async () => {
  // Fixture Requirements go before their Control, or they briefly count as Not Met everywhere (#231).
  await cleanupFixtureRequirements();
  const systemIds = [s1, s2, s3, s4, s5];
  await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.control.deleteMany({ where: { id: controlId } });
  await prisma.businessUnit.deleteMany({ where: { id: { in: [unitId, unit2Id] } } });
  await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  // StatSnapshot rows go with their User.
  await prisma.user.deleteMany({ where: { id: { in: created.map((u) => u.id) } } });
});

describe("what each role sees (visibility is unchanged)", () => {
  it("a System Owner sees their own Systems in any status plus every Onboarded one", async () => {
    const { byId } = await rowsOf(owner);
    expect([...byId.keys()].filter((id) => [s1, s2, s3, s4, s5].includes(id)).sort()).toEqual([s1, s2, s3].sort());
  });

  it("a Viewer sees only the Onboarded ones; the roles that see every System see all five", async () => {
    expect([...(await rowsOf(viewer)).byId.keys()].filter((id) => [s1, s2, s3, s4, s5].includes(id))).toEqual([s3]);
    for (const u of [reviewer, riskOwner, manager]) {
      const { byId } = await rowsOf(u);
      expect([s1, s2, s3, s4, s5].every((id) => byId.has(id))).toBe(true);
    }
  });

  it("a Business Risk Owner sees their scope, their own and the Onboarded Systems, not other Drafts or Rejected", async () => {
    const { byId } = await rowsOf(businessRiskOwner);
    expect(byId.has(s2)).toBe(true); // In Review, but in the assigned Business Unit
    expect(byId.has(s3)).toBe(true);
    expect([s1, s4, s5].some((id) => byId.has(id))).toBe(false);
  });
});

describe("a row", () => {
  it("carries the System's name, vendor, Provider flag, owner, facets, Business Units and Impact Levels", async () => {
    const row = (await rowsOf(owner)).byId.get(s2) as SystemRow;
    expect(row).toMatchObject({ name: `Test Systems S2 ${suffix}`, vendor: null, isProvider: true, status: "IN_REVIEW", ownerId: owner.id, ownerName: owner.name });
    expect(row.facets).toEqual([{ id: facetId, name: `Test Systems Facet ${suffix}` }]);
    expect(row.businessUnits.map((b) => b.id).sort()).toEqual([unitId, unit2Id].sort());
    expect([row.confidentiality, row.integrity, row.availability]).toEqual(["HIGH", "LOW", null]);
    expect((await rowsOf(owner)).byId.get(s1)?.vendor).toBe("Vendor One");
  });

  it("counts Requirements met the way the compliance figure does (base Framework)", async () => {
    const row = (await rowsOf(owner)).byId.get(s2) as SystemRow;
    const direct = (await getComplianceForSystems({ id: s2 })).bySystem[0];
    expect(row.applicable).toBe(direct.applicable);
    expect(row.met).toBe(direct.met);
    expect(row.met).toBeGreaterThanOrEqual(1);
    expect(row.applicable).toBeGreaterThanOrEqual(row.met as number);
  });

  it("has nothing to measure for a System with no applicable Requirement against the base Framework", async () => {
    const direct = (await getComplianceForSystems({ id: s4 })).bySystem[0];
    const row = (await rowsOf(reviewer)).byId.get(s4) as SystemRow;
    if (direct.applicable === 0) expect([row.met, row.applicable]).toEqual([null, null]);
    else expect([row.met, row.applicable]).toEqual([direct.met, direct.applicable]);
  });

  it("counts the open Queries the user can act on: the owner's turn for the owner, not for a Reviewer", async () => {
    expect((await rowsOf(owner)).byId.get(s2)?.openQuestions).toBe(1);
    expect((await rowsOf(reviewer)).byId.get(s2)?.openQuestions).toBe(0);
    expect((await rowsOf(viewer)).byId.has(s2)).toBe(false);
  });
});

describe("Needs attention (decision 4a)", () => {
  it("is open Queries to act on, Rejected, or a Draft untouched for more than 60 days", async () => {
    const { byId } = await rowsOf(reviewer);
    expect(byId.get(s1)?.needsAttention).toBe(true); // Draft, 90 days
    expect(byId.get(s4)?.needsAttention).toBe(true); // Rejected
    expect(byId.get(s5)?.needsAttention).toBe(false); // fresh Draft
    expect(byId.get(s3)?.needsAttention).toBe(false);
    expect(byId.get(s2)?.needsAttention).toBe(false); // the Query waits for the owner, not for a Reviewer
    expect((await rowsOf(owner)).byId.get(s2)?.needsAttention).toBe(true);
  });

  it("measures a Draft's age from the read time: 60 days is not yet stale, 61 is", () => {
    const at = new Date("2026-10-25T12:00:00Z");
    const draft = (days: number) => ({ openQuestions: 0, status: "DRAFT" as const, updatedAt: new Date(at.getTime() - days * day).toISOString() });
    expect(needsAttention(draft(60), at, 60)).toBe(false);
    expect(needsAttention(draft(61), at, 60)).toBe(true);
    expect(needsAttention({ ...draft(90), status: "IN_REVIEW" }, at, 60)).toBe(false);
    expect(needsAttention({ ...draft(1), openQuestions: 2 }, at, 60)).toBe(true);
    expect(needsAttention({ ...draft(1), status: "REJECTED" }, at, 60)).toBe(true);
  });
});

describe("the role view (decision 3a)", () => {
  it("System Owner: Owned by me", async () => {
    const { view, byId } = await rowsOf(owner);
    expect(view.roleView).toEqual({ label: "Owned by me", warn: false });
    expect([s1, s2, s3].map((id) => byId.get(id)?.inRoleView)).toEqual([true, true, false]);
  });

  it("Reviewer: Awaiting review, the Systems In Review", async () => {
    const { view, byId } = await rowsOf(reviewer);
    expect(view.roleView).toEqual({ label: "Awaiting review", warn: true });
    expect([s1, s2, s3, s4].map((id) => byId.get(id)?.inRoleView)).toEqual([false, true, false, false]);
  });

  it("Risk Owner: With open Risks; a closed Risk does not count", async () => {
    const { view, byId } = await rowsOf(riskOwner);
    expect(view.roleView.label).toBe("With open Risks");
    expect([s1, s2, s3].map((id) => byId.get(id)?.inRoleView)).toEqual([false, false, true]);
  });

  it("Business Risk Owner: In my scope, their assigned Business Units", async () => {
    const { view, byId } = await rowsOf(businessRiskOwner);
    expect(view.roleView).toEqual({ label: "In my scope", warn: false });
    expect([s2, s3].map((id) => byId.get(id)?.inRoleView)).toEqual([true, true]);
  });

  it("every other role: Under 70% met, never a Draft, matching the compliance figure", async () => {
    const { view, byId } = await rowsOf(manager);
    expect(view.roleView).toEqual({ label: "Under 70% met", warn: true });
    const compliance = await getComplianceForSystems({ id: { in: [s1, s2, s3, s4, s5] } });
    for (const figure of compliance.bySystem) {
      const row = byId.get(figure.systemId) as SystemRow;
      const expected = row.status !== "DRAFT" && figure.percentage !== null && figure.percentage < 70;
      expect(row.inRoleView, row.name).toBe(expected);
    }
    expect(byId.get(s1)?.inRoleView).toBe(false);
    expect(byId.get(s5)?.inRoleView).toBe(false);
  });

  it("the fulfilment rule: under 70% only, not a Draft, nothing measured is not counted", () => {
    const row = (met: number | null, applicable: number | null, status: SystemRow["status"] = "ONBOARDED") => ({ ownerId: "x", status, met, applicable });
    const facts = { openRisks: 0, inScope: false };
    const as = { id: "u", role: "ADMIN" as const };
    expect(inRoleView(row(69, 100), as, facts, 70)).toBe(true);
    expect(inRoleView(row(70, 100), as, facts, 70)).toBe(false);
    expect(inRoleView(row(0, 5, "DRAFT"), as, facts, 70)).toBe(false);
    expect(inRoleView(row(null, null), as, facts, 70)).toBe(false);
    expect(inRoleView(row(0, 0), as, facts, 70)).toBe(false);
  });
});

describe("trend lines from the daily snapshots (decision 2b)", () => {
  const writeSnapshots = (userId: string, role: UserRole, entries: { statKey: string; value: number; end: number }[]) =>
    prisma.statSnapshot.createMany({
      data: entries.map((entry) => ({ userId, role, statKey: entry.statKey, value: entry.value, day: utcDay(weekEnds(now)[entry.end]) })),
    });

  it("draws no line for a role that cannot rebuild its history, before the first snapshot", async () => {
    await prisma.statSnapshot.deleteMany({ where: { userId: owner.id } });
    expect((await rowsOf(owner)).view.trends).toEqual({});
  });

  it("starts the line at the first snapshot, skips weeks without one and ends at today's live count", async () => {
    await prisma.statSnapshot.deleteMany({ where: { userId: owner.id } });
    await writeSnapshots(owner.id, "SYSTEM_OWNER", [
      { statKey: systemsStatKey("attention"), value: 7, end: 2 },
      { statKey: systemsStatKey("attention"), value: 9, end: 4 },
      // The live day's snapshot never replaces the live value.
      { statKey: systemsStatKey("attention"), value: 555, end: 6 },
    ]);
    const { view } = await rowsOf(owner);
    expect(view.trends.attention).toEqual([7, 9, viewCounts(view.rows).attention]);
    expect(view.trends.providers).toBeUndefined();
  });

  it("ignores another user's snapshots and those recorded under another role", async () => {
    await prisma.statSnapshot.deleteMany({ where: { userId: { in: [owner.id, other.id] } } });
    await writeSnapshots(other.id, "SYSTEM_OWNER", [{ statKey: systemsStatKey("all"), value: 1, end: 1 }]);
    await writeSnapshots(owner.id, "ADMIN", [{ statKey: systemsStatKey("all"), value: 2, end: 2 }]);
    expect((await rowsOf(owner)).view.trends).toEqual({});
  });

  it("rebuilds All Systems from creation times for a role that sees every System, and prefers a snapshot", async () => {
    await prisma.statSnapshot.deleteMany({ where: { userId: reviewer.id } });
    const plain = (await rowsOf(reviewer)).view;
    const all = plain.trends.all as number[];
    expect(all).toHaveLength(7);
    expect(all[6]).toBe(plain.rows.length);
    expect([...all].sort((a, b) => a - b)).toEqual(all); // Systems only accumulate
    expect(plain.trends.mine).toBeUndefined(); // history of the other views cannot be rebuilt

    await writeSnapshots(reviewer.id, "REVIEWER", [{ statKey: systemsStatKey("all"), value: 987, end: 3 }]);
    const withSnapshot = ((await rowsOf(reviewer)).view.trends.all as number[]);
    expect(withSnapshot[3]).toBe(987);
    expect(withSnapshot[2]).toBe(all[2]);
  });
});

describe("the Admin-set thresholds (#240)", () => {
  // A setting is global, so these tests never commit one: they write it inside a transaction that is rolled
  // back, read the Systems on that same transaction (as the list and the snapshot job do), and leave nothing
  // behind for the other test files running at the same time.
  class Rollback extends Error {}
  async function withSettings<T>(values: Record<string, number | null>, read: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    let result: T | undefined;
    try {
      await prisma.$transaction(
        async (tx) => {
          await tx.appSetting.deleteMany({});
          for (const [key, value] of Object.entries(values)) {
            if (value !== null) await tx.appSetting.create({ data: { key, value } });
          }
          result = await read(tx);
          throw new Rollback();
        },
        { isolationLevel: "RepeatableRead" },
      );
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    return result as T;
  }
  const read = (values: Record<string, number | null>, who: Fixture = manager) =>
    withSettings(values, async (tx) => {
      const result = await readSystemRows(tx, who, now);
      return { ...result, byId: new Map(result.rows.map((r) => [r.id, r])) };
    });

  it("with no row saved, the thresholds are 60 days and 70% and the rows are as before", async () => {
    const result = await read({});
    expect(result.thresholds).toEqual({ staleDraftDays: 60, underFulfilledPercent: 70 });
    expect(DEFAULT_SYSTEMS_THRESHOLDS).toEqual({ staleDraftDays: 60, underFulfilledPercent: 70 });
    expect(result.byId.get(s1)?.needsAttention).toBe(true); // Draft, 90 days
    expect(result.byId.get(s5)?.needsAttention).toBe(false);
  });

  it("a saved stale-Draft age changes Needs attention: 100 days spares the 90-day Draft, 30 flags it", async () => {
    expect((await read({ "systems.staleDraftDays": 100 })).byId.get(s1)?.needsAttention).toBe(false);
    const short = await read({ "systems.staleDraftDays": 30 });
    expect(short.byId.get(s1)?.needsAttention).toBe(true);
    expect(short.byId.get(s5)?.needsAttention).toBe(false); // fresh
  });

  it("a saved percentage changes the Under N% met view, and the counts the snapshot job stores", async () => {
    const compliance = await getComplianceForSystems({ id: { in: [s2, s3, s4] } });
    const share = new Map(compliance.bySystem.map((figure) => [figure.systemId, figure.percentage]));
    for (const percent of [1, 100]) {
      const result = await read({ "systems.underFulfilledPercent": percent });
      expect(result.thresholds.underFulfilledPercent).toBe(percent);
      for (const id of [s2, s3, s4]) {
        const figure = share.get(id) ?? null;
        expect(result.byId.get(id)?.inRoleView, `${id} at ${percent}%`).toBe(figure !== null && result.byId.get(id)?.status !== "DRAFT" && figure < percent);
      }
    }
    // The rows the snapshot job counts follow the threshold: At 100% every measured, non-Draft System under full fulfilment counts.
    const count = async (percent: number) => {
      const result = await read({ "systems.underFulfilledPercent": percent });
      return systemsSnapshotRows(result.rows).find((entry) => entry.statKey === systemsStatKey("mine"))?.value;
    };
    expect(await count(100)).toBeGreaterThanOrEqual((await count(1)) as number);
  });

  it("the label's N comes from the setting", async () => {
    const label = await withSettings({ "systems.underFulfilledPercent": 85 }, async (tx) => {
      const { thresholds } = await readSystemRows(tx, manager, now);
      return roleViewOf(manager.role, thresholds.underFulfilledPercent).label;
    });
    expect(label).toBe("Under 85% met");
  });

  it("a saved value that no longer fits its range is ignored in favour of the default", async () => {
    const result = await withSettings({}, async (tx) => {
      await tx.appSetting.create({ data: { key: "systems.staleDraftDays", value: "soon" } });
      return readSystemRows(tx, manager, now);
    });
    expect(result.thresholds.staleDraftDays).toBe(60);
  });
});

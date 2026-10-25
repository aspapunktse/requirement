import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordStatSnapshots } from "@/lib/stat-snapshots";
import { roleView } from "@/app/home/role-view";
import { statNumber, utcDay } from "@/app/home/home-snapshots";
import { weekEnds } from "@/app/home/home-trends";
import { loadSystemRowsForCounts } from "@/app/systems/systems-data";
import { systemsStatKey } from "@/app/systems/systems-trends";
import { viewCounts } from "@/app/systems/systems-logic";
import { VIEW_KEYS } from "@/app/systems/systems-types";

const suffix = `${process.pid}-${Date.now()}`;
const emails = [`test-snap-a-${suffix}@example.com`, `test-snap-b-${suffix}@example.com`];
type Viewer = { id: string; name: string; role: "VIEWER" };
let a: Viewer;
let b: Viewer;
const now = new Date();

const rows = (userId: string) => prisma.statSnapshot.findMany({ where: { userId }, orderBy: [{ statKey: "asc" }, { day: "asc" }] });
// The Systems list's cards are recorded under `systems:` keys beside Home's (#232).
const SYSTEMS_KEYS = VIEW_KEYS.length;
const homeRows = async (userId: string) => (await rows(userId)).filter((row) => !row.statKey.startsWith("systems:"));

beforeAll(async () => {
  a = (await prisma.user.create({ data: { email: emails[0], name: "Test Snapshot A", role: "VIEWER" } })) as Viewer;
  b = (await prisma.user.create({ data: { email: emails[1], name: "Test Snapshot B", role: "VIEWER" } })) as Viewer;
});

afterAll(async () => {
  // StatSnapshot rows go with their User (onDelete Cascade).
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
});

describe("recording the daily stat snapshots (#227)", () => {
  it("stores the figures /home shows, per user, for today's UTC day", async () => {
    const run = await recordStatSnapshots(now, { userIds: [a.id] });
    const view = await roleView(a, now);
    const stored = await homeRows(a.id);
    expect(run.failedUsers).toBe(0);
    expect(run.recorded).toBe(view.stats.length + SYSTEMS_KEYS);
    expect(stored).toHaveLength(view.stats.length);
    for (const stat of view.stats) {
      const row = stored.find((r) => r.statKey === stat.label);
      expect(row?.value).toBe(statNumber(stat));
      expect(row?.day.getTime()).toBe(utcDay(now).getTime());
    }
    expect(await rows(b.id)).toHaveLength(0);
  });

  it("turns Oldest waiting into days, with none as 0", () => {
    expect(statNumber({ value: "5 d" })).toBe(5);
    expect(statNumber({ value: "none" })).toBe(0);
    expect(statNumber({ value: 7 })).toBe(7);
  });

  it("changes nothing when run a second time on the same day, keeping the first values", async () => {
    const before = await rows(a.id);
    const again = await recordStatSnapshots(now, { userIds: [a.id] });
    expect(again.recorded).toBe(0);
    expect(await rows(a.id)).toEqual(before);

    const first = before[0];
    await prisma.statSnapshot.update({ where: { id: first.id }, data: { value: 4242 } });
    await recordStatSnapshots(now, { userIds: [a.id] });
    expect((await prisma.statSnapshot.findUniqueOrThrow({ where: { id: first.id } })).value).toBe(4242);
    expect(await rows(a.id)).toHaveLength(before.length);
  });

  it("records another row set on another day", async () => {
    const before = (await rows(a.id)).length;
    await recordStatSnapshots(new Date(now.getTime() + 86_400_000), { userIds: [a.id] });
    expect(await rows(a.id)).toHaveLength(before * 2);
  });
});

describe("trends read the snapshots (#227)", () => {
  it("uses the snapshot on a week-end's exact day and derived values elsewhere; the last point stays live", async () => {
    await prisma.statSnapshot.deleteMany({ where: { userId: a.id } });
    const stat = (await roleView(a, now)).stats[0];
    const derived = stat.trend as number[];
    const ends = weekEnds(now);
    await prisma.statSnapshot.createMany({
      data: [
        { userId: a.id, role: "VIEWER", statKey: stat.label, value: 987, day: utcDay(ends[3]) },
        // The live day's snapshot must not replace the live value.
        { userId: a.id, role: "VIEWER", statKey: stat.label, value: 654, day: utcDay(ends[6]) },
        // A day that is not a week end is ignored.
        { userId: a.id, role: "VIEWER", statKey: stat.label, value: 321, day: utcDay(new Date(ends[2].getTime() + 86_400_000)) },
      ],
    });
    const trend = (await roleView(a, now)).stats.find((s) => s.label === stat.label)?.trend as number[];
    expect(trend[3]).toBe(987);
    expect(trend[6]).toBe(derived[6]);
    for (const i of [0, 1, 2, 4, 5]) expect(trend[i]).toBe(derived[i]);
  });

  it("never reads another user's snapshots", async () => {
    await prisma.statSnapshot.deleteMany({ where: { userId: { in: [a.id, b.id] } } });
    const stat = (await roleView(a, now)).stats[0];
    const derived = stat.trend as number[];
    const ends = weekEnds(now);
    await prisma.statSnapshot.create({ data: { userId: b.id, role: "VIEWER", statKey: stat.label, value: 555, day: utcDay(ends[4]) } });
    const trend = (await roleView(a, now)).stats[0].trend as number[];
    expect(trend).toEqual(derived);
    const bTrend = (await roleView(b, now)).stats.find((s) => s.label === stat.label)?.trend as number[];
    expect(bTrend[4]).toBe(555);
  });
});

describe("a role change (#227)", () => {
  it("ignores snapshots recorded under another role and uses those of the current role", async () => {
    await prisma.statSnapshot.deleteMany({ where: { userId: a.id } });
    const stat = (await roleView(a, now)).stats[0];
    const derived = stat.trend as number[];
    const ends = weekEnds(now);
    await prisma.statSnapshot.createMany({
      data: [
        { userId: a.id, role: "ADMIN", statKey: stat.label, value: 111, day: utcDay(ends[2]) },
        { userId: a.id, role: "VIEWER", statKey: stat.label, value: 222, day: utcDay(ends[3]) },
      ],
    });
    const trend = (await roleView(a, now)).stats.find((s) => s.label === stat.label)?.trend as number[];
    expect(trend[2]).toBe(derived[2]);
    expect(trend[3]).toBe(222);
  });
});

describe("recording the Systems list's stat cards (#232)", () => {
  const systemsRows = async (userId: string) => (await rows(userId)).filter((row) => row.statKey.startsWith("systems:"));
  const names: string[] = [];
  let ownerA: string;
  let ownerB: string;
  let systemIds: string[] = [];

  beforeAll(async () => {
    // Two System Owners: each sees their own Systems plus the Onboarded ones, so their counts differ.
    const make = async (key: string) => {
      const email = `test-snap-sys-${key}-${suffix}@example.com`;
      names.push(email);
      return (await prisma.user.create({ data: { email, name: `Test Snapshot Systems ${key}`, role: "SYSTEM_OWNER" } })).id;
    };
    ownerA = await make("a");
    ownerB = await make("b");
    const system = async (name: string, ownerId: string, status: "DRAFT" | "ONBOARDED", isProvider = false) =>
      (await prisma.system.create({ data: { name: `Test Snapshot System ${name} ${suffix}`, ownerId, status, isProvider } })).id;
    systemIds = [
      await system("A1", ownerA, "DRAFT", true), // unclassified, provider
      await system("A2", ownerA, "DRAFT"),
      await system("B1", ownerB, "DRAFT"),
    ];
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.user.deleteMany({ where: { email: { in: names } } });
  });

  it("stores one row per saved view under its own systems: key, with the counts the page shows to that user", async () => {
    const run = await recordStatSnapshots(now, { userIds: [ownerA] });
    expect(run.failedUsers).toBe(0);
    const counts = viewCounts(await loadSystemRowsForCounts({ id: ownerA, role: "SYSTEM_OWNER" }, now));
    const stored = await systemsRows(ownerA);
    expect(stored).toHaveLength(SYSTEMS_KEYS);
    for (const view of VIEW_KEYS) {
      const row = stored.find((r) => r.statKey === systemsStatKey(view));
      expect(row?.value, view).toBe(counts[view]);
      expect(row?.role).toBe("SYSTEM_OWNER");
      expect(row?.day.getTime()).toBe(utcDay(now).getTime());
    }
    // Namespaced: none of them is a Home stat label.
    const homeLabels = new Set((await roleView({ id: ownerA, name: "x", role: "SYSTEM_OWNER" }, now)).stats.map((s) => s.label));
    expect(stored.some((r) => homeLabels.has(r.statKey))).toBe(false);
  });

  it("counts what that user can see: a Draft of another owner is not in the counts", async () => {
    await recordStatSnapshots(now, { userIds: [ownerB] });
    const a = (await systemsRows(ownerA)).find((r) => r.statKey === systemsStatKey("all"))?.value as number;
    const b = (await systemsRows(ownerB)).find((r) => r.statKey === systemsStatKey("all"))?.value as number;
    // A owns two Drafts and B one, and the Onboarded Systems are the same for both (other files may add
    // Onboarded ones meanwhile, so only the order is asserted).
    expect(a).toBeGreaterThanOrEqual(2);
    expect(b).toBeGreaterThanOrEqual(1);
    expect(a).toBeGreaterThan(b);
    // A's Draft Provider counts for A and is invisible to B.
    const providersOf = async (id: string) => (await systemsRows(id)).find((r) => r.statKey === systemsStatKey("providers"))?.value as number;
    expect(await providersOf(ownerA)).toBeGreaterThan(await providersOf(ownerB));
  });

  it("changes nothing when run again on the same day, and records another set on another day", async () => {
    const before = await systemsRows(ownerA);
    const again = await recordStatSnapshots(now, { userIds: [ownerA] });
    expect(again.recorded).toBe(0);
    expect(await systemsRows(ownerA)).toEqual(before);

    const first = before[0];
    await prisma.statSnapshot.update({ where: { id: first.id }, data: { value: 4242 } });
    await recordStatSnapshots(now, { userIds: [ownerA] });
    expect((await prisma.statSnapshot.findUniqueOrThrow({ where: { id: first.id } })).value).toBe(4242);

    await recordStatSnapshots(new Date(now.getTime() + 86_400_000), { userIds: [ownerA] });
    expect(await systemsRows(ownerA)).toHaveLength(SYSTEMS_KEYS * 2);
  });
});

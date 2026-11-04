import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { recordStatSnapshots } from "@/lib/stat-snapshots";
import { loadSystemsView } from "../systems-data";
import { systemsSnapshotRows, systemsStatKey } from "../systems-trends";
import { viewCounts } from "../systems-logic";

/**
 * What the Systems list carries about Information Types (#305), against real Postgres with `Test #305 …` fixtures.
 * Seeded Systems (a dev database has some) declare no type, so the fixtures' rows are looked up by id.
 */
const suffix = `${process.pid}-${Date.now()}`;
const created = { user: "", systems: [] as string[], types: [] as string[] };
let high: { id: string; name: string };
let low: { id: string; name: string };
const sys: Record<string, string> = {};
let owner: { id: string; name: string; role: "SYSTEM_OWNER" };

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `test-305-list-${suffix}@example.com`, name: "Test #305 list owner", role: "SYSTEM_OWNER" } });
  created.user = user.id;
  owner = { id: user.id, name: user.name, role: "SYSTEM_OWNER" };
  const type = async (label: string, level: number) => {
    const row = await prisma.informationType.create({ data: { name: `Test #305 ${label} ${suffix}`, sensitivityLevel: level } });
    created.types.push(row.id);
    return row;
  };
  high = await type("Payroll", 4);
  low = await type("Notes", 2);
  const make = async (key: string, level: number | null, typeIds: string[]) => {
    const row = await prisma.system.create({
      data: { name: `Test #305 ${key} ${suffix}`, ownerId: owner.id, sensitivityLevel: level, informationTypes: { connect: typeIds.map((id) => ({ id })) } },
    });
    created.systems.push(row.id);
    sys[key] = row.id;
  };
  await make("below", 3, [high.id, low.id]);
  await make("ok", 4, [high.id]);
  await make("none-declared", 3, []);
  await make("no-level", null, [high.id]);
});

afterAll(async () => {
  await prisma.statSnapshot.deleteMany({ where: { userId: owner.id } });
  await prisma.system.deleteMany({ where: { id: { in: created.systems } } });
  await prisma.informationType.deleteMany({ where: { id: { in: created.types } } });
  await prisma.user.deleteMany({ where: { id: created.user } });
});

describe("the Systems list rows (#305)", () => {
  it("carry the declared types, highest level first, and flag only a System whose declared level is below them", async () => {
    const view = await loadSystemsView(owner);
    const byId = new Map(view.rows.map((row) => [row.id, row]));
    expect(byId.get(sys["below"])?.informationTypes.map((type) => type.id)).toEqual([high.id, low.id]);
    expect(byId.get(sys["below"])?.belowInformationTypes).toBe(true);
    expect(byId.get(sys["ok"])?.belowInformationTypes).toBe(false);
    expect(byId.get(sys["none-declared"])?.informationTypes).toEqual([]);
    expect(byId.get(sys["none-declared"])?.belowInformationTypes).toBe(false);
    // No level is not "below": that has its own refusal.
    expect(byId.get(sys["no-level"])?.belowInformationTypes).toBe(false);
  });

  it("offer the whole catalogue to the filter, including a type no visible System declares", async () => {
    const view = await loadSystemsView(owner);
    const ids = view.informationTypes.map((type) => type.id);
    expect(ids).toContain(high.id);
    expect(ids).toContain(low.id);
  });

  it("count the Below its Information Types view among the stat cards, and the daily job records it", async () => {
    const view = await loadSystemsView(owner);
    // The owner also sees every Onboarded System, so other test files' fixtures may add to the count: check ours inside it.
    expect(view.rows.filter((row) => row.belowInformationTypes && created.systems.includes(row.id)).map((row) => row.id)).toEqual([sys["below"]]);
    const live = viewCounts(view.rows).below;
    expect(live).toBeGreaterThanOrEqual(1);
    expect(systemsSnapshotRows(view.rows).find((row) => row.statKey === systemsStatKey("below"))?.value).toBe(live);
    await recordStatSnapshots(new Date(), { userIds: [owner.id] });
    const stored = await prisma.statSnapshot.findMany({ where: { userId: owner.id, statKey: "systems:below" } });
    expect(stored).toHaveLength(1);
    expect(stored[0].value).toBeGreaterThanOrEqual(1);
    // The job computes every Home figure for the user as well, which is slow while other test files load the database.
  }, 60_000);
});

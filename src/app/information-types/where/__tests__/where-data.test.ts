import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { whereCounts, whereGroupOf } from "@/lib/information-type-where";
import { loadSystemsView } from "@/app/systems/systems-data";
import { loadWhereView, pickType, readWhereView } from "../where-data";

/**
 * The data behind "Where can I put this information?" (#305), against real Postgres with its own `Test #305 …` fixtures
 * (CI's database is not seeded; a dev database also holds seeded Systems, so counts are checked as the fixtures' share
 * plus whatever the other Systems contribute, and lists only for the fixtures).
 *
 * The type "Mid" is Sensitive (3). Systems, with owner A = System Owner "a", owner B = System Owner "b":
 *   a-high   A  Draft       level 4  declares Mid          (declared, at or above)
 *   a-equal  A  Draft       level 3  no type               (may hold: equal)
 *   a-low    A  Draft       level 2  declares Mid          (declared, below: flagged)
 *   a-one    A  Draft       level 1  no type               (below)
 *   a-none   A  Draft       no level no type               (below, no level)
 *   b-open   B  Onboarded   level 5  no type, a Provider   (visible to A: Onboarded)
 *   b-hidden B  Draft       level 5  declares Mid          (hidden from A)
 *   b-hid2   B  Draft       level 3  no type               (hidden from A)
 */
const suffix = `${process.pid}-${Date.now()}`;
const created = { users: [] as string[], systems: [] as string[], types: [] as string[] };

let mid: { id: string; name: string; sensitivityLevel: number };
let high: { id: string };
const sys: Record<string, string> = {};
let ownerA: { id: string; role: UserRole };
let ownerB: { id: string; role: UserRole };
let admin: { id: string; role: UserRole };
let reviewer: { id: string; role: UserRole };

const makeUser = async (key: string, role: UserRole) => {
  const row = await prisma.user.create({ data: { email: `test-305-where-${key}-${suffix}@example.com`, name: `Test #305 ${key}`, role } });
  created.users.push(row.id);
  return { id: row.id, role };
};

beforeAll(async () => {
  ownerA = await makeUser("a", "SYSTEM_OWNER");
  ownerB = await makeUser("b", "SYSTEM_OWNER");
  admin = await makeUser("admin", "ADMIN");
  reviewer = await makeUser("reviewer", "REVIEWER");
  const makeType = async (label: string, level: number) => {
    const row = await prisma.informationType.create({ data: { name: `Test #305 ${label} ${suffix}`, sensitivityLevel: level } });
    created.types.push(row.id);
    return row;
  };
  mid = await makeType("Mid", 3);
  high = await makeType("High", 5);
  const make = async (key: string, ownerId: string, level: number | null, data: { declares?: boolean; status?: "DRAFT" | "ONBOARDED"; provider?: boolean } = {}) => {
    const row = await prisma.system.create({
      data: {
        name: `Test #305 ${key} ${suffix}`,
        ownerId,
        sensitivityLevel: level,
        status: data.status ?? "DRAFT",
        isProvider: data.provider ?? false,
        ...(data.declares ? { informationTypes: { connect: { id: mid.id } } } : {}),
      },
    });
    created.systems.push(row.id);
    sys[key] = row.id;
  };
  await make("a-high", ownerA.id, 4, { declares: true });
  await make("a-equal", ownerA.id, 3);
  await make("a-low", ownerA.id, 2, { declares: true });
  await make("a-one", ownerA.id, 1);
  await make("a-none", ownerA.id, null);
  await make("b-open", ownerB.id, 5, { status: "ONBOARDED", provider: true });
  await make("b-hidden", ownerB.id, 5, { declares: true });
  await make("b-hid2", ownerB.id, 3);
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { id: { in: created.systems } } });
  await prisma.informationType.deleteMany({ where: { id: { in: created.types } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
});

/** The share of the Systems that are not our fixtures (a seeded database has some), so the counts can be checked exactly. */
async function otherSystemsCounts(tx: Prisma.TransactionClient) {
  const others = await tx.system.findMany({ where: { id: { notIn: created.systems } }, select: { sensitivityLevel: true, informationTypes: { select: { id: true } } } });
  return whereCounts(mid, others.map((system) => ({ sensitivityLevel: system.sensitivityLevel, typeIds: system.informationTypes.map((type) => type.id) })));
}

const fixtureIds = () => new Set(created.systems);
const listed = (view: Awaited<ReturnType<typeof loadWhereView>>, group: "declared" | "hold" | "below") =>
  view.systems
    .filter((system) => fixtureIds().has(system.id))
    .filter((system) => whereGroupOf(mid.sensitivityLevel, { sensitivityLevel: system.sensitivityLevel, declares: system.typeIds.includes(mid.id) }) === group)
    .map((system) => Object.keys(sys).find((key) => sys[key] === system.id))
    .sort();

describe("loadWhereView", () => {
  it("groups the Systems an Admin sees at each level edge", async () => {
    const view = await loadWhereView(admin);
    expect(listed(view, "declared")).toEqual(["a-high", "a-low", "b-hidden"]);
    // Equal level counts as may hold; Onboarded Provider above too.
    expect(listed(view, "hold")).toEqual(["a-equal", "b-hid2", "b-open"]);
    // One below, and no level, never may hold.
    expect(listed(view, "below")).toEqual(["a-none", "a-one"]);
  });

  it("counts every System in the figures, from the type's side", async () => {
    // One snapshot for both reads: other test files create and delete Systems concurrently.
    const { view, other } = await prisma.$transaction(async (tx) => ({ view: await readWhereView(tx, admin), other: await otherSystemsCounts(tx) }), {
      isolationLevel: "RepeatableRead",
    });
    expect(view.counts[mid.id]).toEqual({
      declared: 3 + other.declared,
      hold: 3 + other.hold,
      below: 2 + other.below,
      declaredBelow: 1 + other.declaredBelow,
      // At or above level 3: a-high, a-equal, b-open, b-hidden, b-hid2 (a-low declares but sits at 2).
      atOrAbove: 5 + other.atOrAbove,
    });
  });

  it("lists only the Systems the acting System Owner can see, while the counts stay over all Systems", async () => {
    const { view, admins } = await prisma.$transaction(async (tx) => ({ view: await readWhereView(tx, ownerA), admins: await readWhereView(tx, admin) }), {
      isolationLevel: "RepeatableRead",
    });
    const names = view.systems.filter((system) => fixtureIds().has(system.id)).map((system) => Object.keys(sys).find((key) => sys[key] === system.id));
    expect(names.sort()).toEqual(["a-equal", "a-high", "a-low", "a-none", "a-one", "b-open"]);
    expect(view.systems.some((system) => system.id === sys["b-hidden"] || system.id === sys["b-hid2"])).toBe(false);
    expect(listed(view, "declared")).toEqual(["a-high", "a-low"]);
    expect(listed(view, "hold")).toEqual(["a-equal", "b-open"]);
    // The counts include the two hidden Systems (b-hidden declares, b-hid2 may hold).
    expect(view.counts).toEqual(admins.counts);
    // The Provider flag is carried.
    expect(view.systems.find((system) => system.id === sys["b-open"])?.isProvider).toBe(true);
  });

  it("shows another System Owner their own Systems and the Onboarded one, not the first owner's Drafts", async () => {
    const view = await loadWhereView(ownerB);
    const names = view.systems.filter((system) => fixtureIds().has(system.id)).map((system) => Object.keys(sys).find((key) => sys[key] === system.id));
    expect(names.sort()).toEqual(["b-hid2", "b-hidden", "b-open"]);
  });

  it("gives a Reviewer every System", async () => {
    const view = await loadWhereView(reviewer);
    expect(view.systems.filter((system) => fixtureIds().has(system.id))).toHaveLength(8);
  });

  it("offers the whole catalogue, highest level first, with the live Sensitivity Levels", async () => {
    const view = await loadWhereView(ownerA);
    const mine = view.types.filter((type) => created.types.includes(type.id));
    expect(mine.map((type) => type.id)).toEqual([high.id, mid.id]);
    expect(view.levels.map((level) => level.level)).toEqual([1, 2, 3, 4, 5]);
    expect(view.counts[high.id].declared).toBe(0);
  });

  it("agrees with the Systems list about which Systems are below their types", async () => {
    // a-low declares Mid (3) at level 2: the list flags it, and the view marks it as declaring below.
    const list = await loadSystemsView({ ...admin, name: "Test #305 admin" });
    const row = list.rows.find((item) => item.id === sys["a-low"]);
    expect(row?.belowInformationTypes).toBe(true);
    expect(list.rows.find((item) => item.id === sys["a-high"])?.belowInformationTypes).toBe(false);
    expect(list.rows.find((item) => item.id === sys["a-none"])?.belowInformationTypes).toBe(false);
  });
});

describe("pickType", () => {
  const types = [{ id: "a" }, { id: "b" }];
  it("takes the requested type, else the first, else null", () => {
    expect(pickType(types, "b")).toBe("b");
    expect(pickType(types, "gone")).toBe("a");
    expect(pickType(types, undefined)).toBe("a");
    expect(pickType([], "a")).toBeNull();
  });
});

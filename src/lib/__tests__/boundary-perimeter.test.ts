import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { readBoundaryPerimeter, perimeterLines } from "@/lib/boundary-perimeter";
import { boundaryFrameworkCounts } from "@/lib/compliance-boundary";
import { listBoundaries } from "@/lib/compliance-boundary-data";

/**
 * The per-Framework list counters and the perimeter's Provider data (#433) against real Postgres. Fixtures only, named
 * `Test #433 ...`: non-base Frameworks (never the base Framework), Systems in each state, Providers inside and outside.
 */
const suffix = `${process.pid}-${Date.now()}`;
const N = (label: string) => `Test #433 ${label} ${suffix}`;

describe("Compliance Boundary counters and perimeter (#433)", { timeout: 60_000 }, () => {
  const users = {} as Record<"cm" | "viewer" | "owner" | "other", { id: string; role: UserRole }>;
  const fw = {} as Record<"a" | "b" | "c", string>;
  const sys = {} as Record<"counted" | "draft" | "memberProvider" | "closed" | "outside" | "hidden" | "closedDependent" | "notMemberDependent", string>;
  const boundaries = {} as Record<"two" | "oneA" | "retired" | "perimeter", string>;

  const makeSystem = (label: string, data: { status?: "DRAFT" | "ONBOARDED"; ownerId: string; isProvider?: boolean; closed?: boolean }) =>
    prisma.system.create({ data: { name: N(label), status: data.status ?? "DRAFT", ownerId: data.ownerId, isProvider: data.isProvider ?? false, evaluationClosedAt: data.closed ? new Date() : null } }).then((row) => row.id);
  const read = (key: keyof typeof users, id = boundaries.perimeter) => prisma.$transaction((tx) => readBoundaryPerimeter(id, users[key], tx), READ_SNAPSHOT);

  beforeAll(async () => {
    for (const [key, role] of [["cm", "COMPLIANCE_MANAGER"], ["viewer", "VIEWER"], ["owner", "SYSTEM_OWNER"], ["other", "SYSTEM_OWNER"]] as const) {
      users[key] = { id: (await prisma.user.create({ data: { email: `test-433-${key}-${suffix}@example.com`, name: N(key), role } })).id, role };
    }
    for (const key of ["a", "b", "c"] as const) fw[key] = (await prisma.framework.create({ data: { name: N(`Framework ${key}`), version: "1", status: "PUBLISHED" } })).id;

    // Onboarded Systems are visible to every role; a Draft only to its owner and the full-visibility roles.
    sys.counted = await makeSystem("counted", { status: "ONBOARDED", ownerId: users.other.id });
    sys.draft = await makeSystem("draft member", { ownerId: users.other.id });
    sys.memberProvider = await makeSystem("member Provider", { status: "ONBOARDED", ownerId: users.other.id, isProvider: true });
    sys.closed = await makeSystem("closed member", { ownerId: users.other.id, closed: true });
    sys.outside = await makeSystem("outside Provider", { status: "ONBOARDED", ownerId: users.other.id, isProvider: true });
    sys.hidden = await makeSystem("hidden Provider", { ownerId: users.other.id, isProvider: true });
    sys.closedDependent = await makeSystem("closed dependent", { ownerId: users.other.id, closed: true });
    sys.notMemberDependent = await makeSystem("not a member", { status: "ONBOARDED", ownerId: users.other.id });
    const member = (id: string) => ({ systemId: id });
    const create = async (label: string, frameworkIds: string[], systemIds: string[], retired = false) =>
      (
        await prisma.complianceBoundary.create({
          data: {
            name: N(label),
            frameworks: { create: frameworkIds.map((frameworkId) => ({ frameworkId })) },
            systems: { create: systemIds.map(member) },
            ...(retired ? { retiredAt: new Date(), retirementComment: "Done" } : {}),
          },
        })
      ).id;
    boundaries.two = await create("two Frameworks", [fw.a, fw.b], []);
    boundaries.oneA = await create("one Framework", [fw.a], []);
    boundaries.retired = await create("retired", [fw.a, fw.c], [], true);
    boundaries.perimeter = await create("perimeter", [fw.a], [sys.counted, sys.draft, sys.memberProvider, sys.closed, sys.closedDependent]);
    const dependsOn = (dependentId: string, providerId: string) => prisma.providerDependency.create({ data: { dependentId, providerId } });
    await dependsOn(sys.counted, sys.outside);
    await dependsOn(sys.draft, sys.outside);
    await dependsOn(sys.counted, sys.hidden);
    await dependsOn(sys.counted, sys.memberProvider);
    await dependsOn(sys.closedDependent, sys.outside); // a closed member isn't drawn, so neither is its dependency
  });

  afterAll(async () => {
    await prisma.complianceBoundary.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.system.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.framework.deleteMany({ where: { id: { in: Object.values(fw) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((user) => user.id) } } });
  });

  describe("the Framework counters", () => {
    const mine = async () => {
      const counts = boundaryFrameworkCounts(await listBoundaries(prisma, { includeRetired: true }));
      return Object.fromEntries(counts.filter((entry) => Object.values(fw).includes(entry.id)).map((entry) => [entry.id, entry.count]));
    };

    it("counts the active Boundaries per Framework: two Frameworks count under both, a retired Boundary under none", async () => {
      const counts = await mine();
      // fw.a: two Frameworks + one Framework + perimeter (active); the retired one holds a and c but counts under neither.
      expect(counts[fw.a]).toBe(3);
      expect(counts[fw.b]).toBe(1);
      expect(counts[fw.c]).toBeUndefined(); // held by a retired Boundary only: no card
    });

    it("returns nothing for no Boundaries, and for retired ones only", () => {
      expect(boundaryFrameworkCounts([])).toEqual([]);
      expect(boundaryFrameworkCounts([{ frameworks: [{ id: "f", name: "F", version: "1" }], retiredAt: "2026-11-01T00:00:00.000Z" }])).toEqual([]);
    });
  });

  describe("the perimeter", () => {
    it("is null for a Boundary that doesn't exist", async () => {
      expect(await read("cm", "missing")).toBeNull();
    });

    it("draws counted members inside and not-yet-operating ones on the edge, closed ones listed, and Providers outside with their dependents", async () => {
      const perimeter = (await read("cm"))!;
      expect(perimeter.inside.map((m) => m.id).sort()).toEqual([sys.counted, sys.memberProvider].sort());
      expect(perimeter.edge.map((m) => m.id)).toEqual([sys.draft]);
      expect(perimeter.closed.map((m) => m.id).sort()).toEqual([sys.closed, sys.closedDependent].sort());
      const outside = perimeter.providers.find((p) => p.id === sys.outside)!;
      expect(outside).toMatchObject({ name: N("outside Provider"), onboarded: true, pending: false });
      // Both counted and the not-yet-operating member inherit from it; the closed dependent's arrow isn't drawn.
      expect(outside.dependentIds.sort()).toEqual([sys.counted, sys.draft].sort());
      expect(perimeter.providers.find((p) => p.id === sys.hidden)).toMatchObject({ name: N("hidden Provider"), onboarded: false, pending: true });
    });

    it("draws a Provider that is itself a member inside, once, with an inherits arrow", async () => {
      const perimeter = (await read("cm"))!;
      expect(perimeter.providers.some((p) => p.id === sys.memberProvider)).toBe(false); // no duplicate outside node
      expect(perimeter.inside.filter((m) => m.id === sys.memberProvider)).toHaveLength(1);
      expect(perimeter.inherits).toEqual([{ from: sys.memberProvider, to: sys.counted, pending: false }]);
    });

    it("marks a dependency pending while its Provider is not Onboarded, outside and inside, and the text list says so", async () => {
      await prisma.system.update({ where: { id: sys.memberProvider }, data: { status: "DRAFT" } });
      try {
        const perimeter = (await read("cm"))!;
        expect(perimeter.inherits).toEqual([{ from: sys.memberProvider, to: sys.counted, pending: true }]);
        expect(perimeter.providers.find((p) => p.id === sys.outside)?.pending).toBe(false);
        expect(perimeter.providers.find((p) => p.id === sys.hidden)?.pending).toBe(true);
        const text = perimeterLines(perimeter).flatMap((g) => g.items).join("|");
        expect(text).toMatch(new RegExp(`will inherit from [^|]*${N("member Provider")}[^|]* once it is Onboarded`));
        expect(text).toContain(`inherits Controls from ${N("outside Provider")}; will inherit`);
        expect(text).toContain(`${N("hidden Provider")} (pending: Provider not Onboarded), provides to`);
      } finally {
        await prisma.system.update({ where: { id: sys.memberProvider }, data: { status: "ONBOARDED" } });
      }
    });

    it("never names or identifies a Provider the acting user may not see, and links only visible members", async () => {
      for (const key of ["viewer", "owner"] as const) {
        const perimeter = (await read(key))!;
        const json = JSON.stringify(perimeter);
        expect(json, key).not.toContain(N("hidden Provider"));
        expect(json, key).not.toContain(sys.hidden);
        const hidden = perimeter.providers.filter((p) => p.name === null);
        expect(hidden, key).toHaveLength(1);
        expect(hidden[0], key).toMatchObject({ id: null, onboarded: null, pending: true, dependentIds: [sys.counted] }); // only the flag on the arrow is revealed
        expect(hidden[0].key, key).toBe("hidden-1");
        // The visible Provider is still named, the Draft member is named (member names are public) but not linkable.
        expect(perimeter.providers.find((p) => p.id === sys.outside)?.name, key).toBe(N("outside Provider"));
        expect(perimeter.edge.find((m) => m.id === sys.draft), key).toMatchObject({ name: N("draft member"), linkable: false });
        expect(perimeter.inside.find((m) => m.id === sys.counted), key).toMatchObject({ linkable: true });
        expect(perimeterLines(perimeter).flatMap((g) => g.items).join("|"), key).toContain("A Provider you can't open");
      }
    });

    it("lets the owner of a hidden System see it", async () => {
      // `other` owns every fixture System, so a Draft Provider is visible to them.
      const perimeter = (await read("other"))!;
      expect(perimeter.providers.every((p) => p.name !== null)).toBe(true);
      expect(perimeter.edge[0].linkable).toBe(true);
    });
  });
});

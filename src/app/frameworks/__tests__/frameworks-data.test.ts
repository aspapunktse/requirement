import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { getBaseFramework } from "@/test/framework-fixtures";
import { loadFrameworksView } from "../frameworks-data";
import type { CatalogRow } from "../frameworks-types";

/**
 * The Framework list's server side (#266), against real Postgres with its own `Test 266 …` fixtures (CI's
 * database is migrated but not seeded; a dev database holds seeded Frameworks and Systems too, so every
 * assertion looks at the fixture rows only, except the base Framework's, which is compared with the rule).
 *
 *   Test 266 Fam Level 1  Published        <- Test 266 Fam Level 2  Draft  <- Test 266 Fam Level 3  Published
 *   Test 266 Solo         Published, Review Group, four Requirements: covered, Partial only, nothing mapped, accepted gap
 *   Systems: A (owned by `owner`) and B (owned by `other`), both Drafts with Solo in their Framework Scope
 */
const suffix = `${process.pid}-${Date.now()}`;
const name = (label: string) => `Test 266 ${label} ${suffix}`;

type Fixture = { id: string; role: UserRole };
const users: Record<string, Fixture> = {};
const frameworkIds: string[] = [];
const controlIds: string[] = [];
const systemIds: string[] = [];
let reviewGroupId: string;
let solo: { id: string };
let l1: { id: string };
let l2: { id: string };
let l3: { id: string };
let requirementIds: string[];

const framework = async (label: string, data: Record<string, unknown> = {}) => {
  const row = await prisma.framework.create({ data: { name: name(label), version: "1", status: "PUBLISHED", ...data } });
  frameworkIds.push(row.id);
  return row;
};
const rowsOf = async (key: string) => (await loadFrameworksView(users[key])).rows;
const find = (rows: CatalogRow[], id: string) => rows.find((row) => row.id === id);

beforeAll(async () => {
  for (const [key, role] of [
    ["cm", "COMPLIANCE_MANAGER"],
    ["admin", "ADMIN"],
    ["viewer", "VIEWER"],
    ["owner", "SYSTEM_OWNER"],
    ["other", "SYSTEM_OWNER"],
  ] as const) {
    const row = await prisma.user.create({ data: { email: `test-266-${key}-${suffix}@example.com`, name: `Test 266 ${key}`, role } });
    users[key] = { id: row.id, role };
  }
  reviewGroupId = (await prisma.reviewGroup.create({ data: { name: name("Review Group") } })).id;

  // The family is read from the name ("<family> Level <n>"), so the unique suffix goes in front of the level.
  const family = `Test 266 ${suffix} Fam`;
  l1 = await framework("", { name: `${family} Level 1` });
  l2 = await framework("", { name: `${family} Level 2`, status: "DRAFT", supersedesId: l1.id });
  l3 = await framework("", { name: `${family} Level 3`, supersedesId: l2.id });
  solo = await framework("Solo", { description: "Test 266 description", strictComplianceRequired: true, reviewGroupId });

  const control = async (code: string, originFrameworkId?: string) => {
    const row = await prisma.control.create({
      data: { code: `TEST-266-${code}-${suffix}`, title: `Test 266 ${code}`, description: "d", category: "Test", applicability: "ORGANIZATIONAL", originFrameworkId },
    });
    controlIds.push(row.id);
    return row.id;
  };
  const full = await control("FULL");
  const partial = await control("PARTIAL");
  await control("SUP", l2.id);

  const requirement = async (code: string, data: Record<string, unknown> = {}) =>
    (await prisma.requirement.create({ data: { frameworkId: solo.id, code, section: "Test", title: `Test 266 ${code}`, text: "t", ...data } })).id;
  requirementIds = [
    await requirement("R1", { mappings: { create: [{ controlId: full, coverage: "FULL" }] } }),
    await requirement("R2", { mappings: { create: [{ controlId: partial, coverage: "PARTIAL" }] } }),
    await requirement("R3"),
    await requirement("R4", { gapAcceptedAt: new Date(), gapJustification: "Test 266 accepted" }),
  ];

  for (const [label, ownerKey] of [["A", "owner"], ["B", "other"]] as const) {
    const system = await prisma.system.create({
      data: { name: name(`System ${label}`), ownerId: users[ownerKey].id, status: "DRAFT", frameworkScopes: { connect: { id: solo.id } } },
    });
    systemIds.push(system.id);
  }
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.requirement.deleteMany({ where: { frameworkId: { in: frameworkIds } } });
  await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
  for (const id of [...frameworkIds].reverse()) await prisma.framework.delete({ where: { id } });
  await prisma.reviewGroup.delete({ where: { id: reviewGroupId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
});

describe("the rows", () => {
  it("counts covered, accepted and open gaps, and splits the open gaps into Partial only and nothing mapped", async () => {
    const row = find(await rowsOf("cm"), solo.id)!;
    expect(row).toMatchObject({ requirements: 4, covered: 1, accepted: 1, gaps: 2, partialOnly: 1 });
    expect(row.gaps - row.partialOnly).toBe(1);
  });

  it("carries the Framework's own facts: description, Strict, Review Group, status", async () => {
    expect(find(await rowsOf("cm"), solo.id)).toMatchObject({
      description: "Test 266 description",
      strict: true,
      reviewGroup: name("Review Group"),
      status: "PUBLISHED",
      isBase: false,
      group: "Other Frameworks",
      family: null,
    });
  });

  it("derives the family and level from the name, and puts the base Framework in its own group", async () => {
    const rows = await rowsOf("cm");
    expect(find(rows, l1.id)).toMatchObject({ group: `Test 266 ${suffix} Fam`, family: `Test 266 ${suffix} Fam`, level: 1 });
    expect(find(rows, l3.id)).toMatchObject({ level: 3 });
    const base = await getBaseFramework();
    expect(find(rows, base.id)).toMatchObject({ isBase: true, group: "Base Framework", family: null, level: null });
  });

  it("gives a Framework with no Requirements all-zero counts", async () => {
    expect(find(await rowsOf("cm"), l1.id)).toMatchObject({ requirements: 0, covered: 0, accepted: 0, gaps: 0, partialOnly: 0 });
  });

  it("counts a Draft's Supplementary Controls, and only a Draft's", async () => {
    const rows = await rowsOf("cm");
    expect(find(rows, l2.id)?.supplementary).toBe(1);
    expect(find(rows, solo.id)?.supplementary).toBe(0);
  });
});

describe("Updated is derived from the Framework, its Requirements and their Control Mappings (decision 2a)", () => {
  const set = (table: "Framework" | "Requirement" | "ControlMapping", column: string, where: string, value: string, id: string | string[]) =>
    prisma.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = $1::timestamp WHERE "${where}" = ANY($2::text[])`, value, Array.isArray(id) ? id : [id]);

  it("is the latest of the creation date and the Requirements' and Control Mappings' changes", async () => {
    await set("Framework", "createdAt", "id", "2020-01-01T00:00:00Z", solo.id);
    await set("Requirement", "updatedAt", "frameworkId", "2021-02-03T00:00:00Z", solo.id);
    await set("ControlMapping", "updatedAt", "requirementId", "2022-04-05T00:00:00Z", requirementIds);
    expect(find(await rowsOf("cm"), solo.id)?.updatedAt).toBe("2022-04-05T00:00:00.000Z");

    // A Requirement edited later than any mapping moves it.
    await set("Requirement", "updatedAt", "id", "2023-06-07T00:00:00Z", requirementIds[2]);
    expect(find(await rowsOf("cm"), solo.id)?.updatedAt).toBe("2023-06-07T00:00:00.000Z");
  });

  it("is the creation date for a Framework with no Requirements", async () => {
    await set("Framework", "createdAt", "id", "2019-09-09T00:00:00Z", l1.id);
    expect(find(await rowsOf("cm"), l1.id)?.updatedAt).toBe("2019-09-09T00:00:00.000Z");
  });
});

describe("the Systems count", () => {
  it("counts the Systems that have the Framework in scope, for a role that sees every System", async () => {
    expect(find(await rowsOf("cm"), solo.id)?.systems).toBe(2);
    expect(find(await rowsOf("admin"), solo.id)?.systems).toBe(2);
  });

  it("counts only the Systems the acting user can see (a System Owner sees their own Drafts, not another's)", async () => {
    expect(find(await rowsOf("owner"), solo.id)?.systems).toBe(1);
    expect(find(await rowsOf("other"), solo.id)?.systems).toBe(1);
  });

  it("counts none for a role that sees neither Draft Systems nor owns one", async () => {
    expect(find(await rowsOf("viewer"), solo.id)?.systems).toBe(0);
  });

  it("counts every visible System for the base Framework, as many as visibleSystemsWhere admits", async () => {
    const base = await getBaseFramework();
    for (const key of ["cm", "owner", "viewer"]) {
      const expected = await prisma.system.count({ where: await visibleSystemsWhere(users[key]) });
      expect(find(await rowsOf(key), base.id)?.systems).toBe(expected);
    }
  });

  it("shows a dash (null) for a Draft", async () => {
    expect(find(await rowsOf("cm"), l2.id)?.systems).toBeNull();
  });
});

describe("visibility is unchanged", () => {
  it("shows Drafts to a Compliance Manager and an Admin", async () => {
    for (const key of ["cm", "admin"]) {
      const rows = await rowsOf(key);
      expect(find(rows, l2.id)?.status).toBe("DRAFT");
      expect(find(rows, solo.id)).toBeDefined();
    }
  });

  it("hides Drafts from everyone else, and a hidden Draft's name never reaches them", async () => {
    for (const key of ["viewer", "owner", "other"]) {
      const view = await loadFrameworksView(users[key]);
      expect(view.canCurate).toBe(false);
      expect(find(view.rows, l2.id)).toBeUndefined();
      expect(find(view.rows, l1.id)).toBeDefined();
      expect(JSON.stringify(view)).not.toContain("Fam Level 2");
    }
  });

  it("closes the version lineage over the hidden Draft for those who cannot see it, and shows it to those who can", async () => {
    const hidden = find(await rowsOf("viewer"), l3.id)!;
    expect(hidden.lineage).toHaveLength(1);
    expect(hidden.lineage[0].map((member) => member.id)).toEqual([l1.id, l3.id]);
    const shown = find(await rowsOf("cm"), l3.id)!;
    expect(shown.lineage[0].map((member) => member.id)).toEqual([l1.id, l2.id, l3.id]);
  });

  it("marks a Compliance Manager and an Admin as able to curate", async () => {
    expect((await loadFrameworksView(users.cm)).canCurate).toBe(true);
    expect((await loadFrameworksView(users.admin)).canCurate).toBe(true);
  });
});

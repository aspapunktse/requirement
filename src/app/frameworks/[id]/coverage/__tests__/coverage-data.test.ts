import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadCoverageView } from "../coverage-data";

/**
 * The Framework coverage page's server side (#269), against real Postgres with its own `Test 269 …` fixtures
 * (CI's database is migrated but not seeded). Assertions look at the fixture rows only.
 *
 *   Test 269 Published  Published, Review Group, Strict; Requirements: covered (Full, with a Supplementary Control),
 *                       Partial only, nothing mapped, accepted gap; two fixture Systems (owner A, other B) in scope
 *   Test 269 Draft      Draft, one Requirement
 */
const suffix = `${process.pid}-${Date.now()}`;
const name = (label: string) => `Test 269 ${label} ${suffix}`;

type Fixture = { id: string; role: UserRole };
const users: Record<string, Fixture> = {};
const frameworkIds: string[] = [];
const controlIds: string[] = [];
const systemIds: string[] = [];
let reviewGroupId: string;
let published: { id: string };
let draft: { id: string };
let fullControl: string;

const load = (key: string, id: string, section: string | null = null) => loadCoverageView(users[key], id, section);

beforeAll(async () => {
  for (const [key, role] of [
    ["cm", "COMPLIANCE_MANAGER"],
    ["admin", "ADMIN"],
    ["viewer", "VIEWER"],
    ["owner", "SYSTEM_OWNER"],
    ["other", "SYSTEM_OWNER"],
  ] as const) {
    const row = await prisma.user.create({ data: { email: `test-269-data-${key}-${suffix}@example.com`, name: `Test 269 ${key}`, role } });
    users[key] = { id: row.id, role };
  }
  reviewGroupId = (await prisma.reviewGroup.create({ data: { name: name("Review Group") } })).id;
  published = await prisma.framework.create({
    data: { name: name("Published"), version: "2", status: "PUBLISHED", strictComplianceRequired: true, reviewGroupId },
  });
  draft = await prisma.framework.create({ data: { name: name("Draft"), version: "1", status: "DRAFT" } });
  frameworkIds.push(published.id, draft.id);

  const control = async (code: string, title: string, originFrameworkId?: string) => {
    const row = await prisma.control.create({
      data: { code: `TEST-269-${code}-${suffix}`, title, description: "d", category: "Test", applicability: "ORGANIZATIONAL", originFrameworkId },
    });
    controlIds.push(row.id);
    return row.id;
  };
  fullControl = await control("FULL", "Test 269 full control");
  const supplementary = await control("SUP", "Test 269 supplementary control", published.id);
  const partial = await control("PARTIAL", "Test 269 partial control");

  const requirement = async (frameworkId: string, code: string, data: Record<string, unknown> = {}) =>
    (await prisma.requirement.create({ data: { frameworkId, code, section: "Test 269 B", title: `Test 269 ${code}`, text: `Text ${code}`, ...data } })).id;
  await requirement(published.id, "R1", {
    section: "Test 269 A",
    mappings: { create: [{ controlId: fullControl, coverage: "FULL" }, { controlId: supplementary, coverage: "FULL" }] },
  });
  await requirement(published.id, "R2", { mappings: { create: [{ controlId: partial, coverage: "PARTIAL", rationale: "half" }] } });
  await requirement(published.id, "R3");
  await requirement(published.id, "R4", { gapAcceptedAt: new Date("2026-10-01T10:00:00Z"), gapAcceptedById: users.cm.id, gapJustification: "Test 269 accepted" });
  await requirement(draft.id, "D1");

  for (const [label, ownerKey] of [["A", "owner"], ["B", "other"]] as const) {
    const system = await prisma.system.create({
      data: { name: name(`System ${label}`), ownerId: users[ownerKey].id, status: "DRAFT", frameworkScopes: { connect: { id: published.id } } },
    });
    systemIds.push(system.id);
  }
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.requirement.deleteMany({ where: { frameworkId: { in: frameworkIds } } });
  await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
  await prisma.framework.deleteMany({ where: { id: { in: frameworkIds } } });
  await prisma.reviewGroup.delete({ where: { id: reviewGroupId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
});

describe("visibility", () => {
  it("is null for a Framework that does not exist", async () => {
    expect(await load("cm", "no-such-framework")).toBeNull();
  });

  it("hides a Draft from everyone but Compliance Managers and Admins, as if it did not exist", async () => {
    for (const key of ["viewer", "owner", "other"]) expect(await load(key, draft.id)).toBeNull();
    for (const key of ["cm", "admin"]) expect((await load(key, draft.id))?.framework).toMatchObject({ id: draft.id, status: "DRAFT", systems: null });
  });

  it("shows a Published Framework to every role, and Compliance Managers and Admins alone get curation", async () => {
    for (const [key, curate] of [["cm", true], ["admin", true], ["viewer", false], ["owner", false]] as const) {
      const view = await load(key, published.id);
      expect(view?.canCurate).toBe(curate);
      expect(view?.userId).toBe(users[key].id);
    }
  });
});

describe("the Framework and its Requirements", () => {
  it("carries the Framework's facts", async () => {
    expect((await load("viewer", published.id))?.framework).toEqual({
      id: published.id,
      name: name("Published"),
      version: "2",
      status: "PUBLISHED",
      isBase: false,
      strict: true,
      reviewGroup: name("Review Group"),
      systems: 0,
    });
  });

  it("lists the Requirements by section and code, with their derived state, mappings and acceptance", async () => {
    const view = (await load("cm", published.id))!;
    expect(view.requirements.map((r) => [r.section, r.code, r.state])).toEqual([
      ["Test 269 A", "R1", "COVERED"],
      ["Test 269 B", "R2", "GAP"],
      ["Test 269 B", "R3", "GAP"],
      ["Test 269 B", "R4", "ACCEPTED_GAP"],
    ]);
    const [r1, r2, , r4] = view.requirements;
    expect(r1.mappings.map((m) => [m.coverage, m.supplementary])).toEqual([
      ["FULL", false],
      ["FULL", true],
    ]);
    expect(r2.mappings).toEqual([expect.objectContaining({ coverage: "PARTIAL", rationale: "half", supplementary: false, title: "Test 269 partial control" })]);
    expect(r2.text).toBe("Text R2");
    expect(r4).toMatchObject({ justification: "Test 269 accepted", acceptedBy: "Test 269 cm", acceptedAt: "2026-10-01T10:00:00.000Z" });
  });

  it("passes the requested section through", async () => {
    expect((await load("cm", published.id, "Test 269 A"))?.initialSection).toBe("Test 269 A");
    expect((await load("cm", published.id))?.initialSection).toBeNull();
  });
});

describe("the Systems count (Effect on Systems)", () => {
  it("counts the Systems the acting user can see that have the Framework in scope", async () => {
    expect((await load("cm", published.id))?.framework.systems).toBe(2);
    expect((await load("admin", published.id))?.framework.systems).toBe(2);
    expect((await load("owner", published.id))?.framework.systems).toBe(1);
    expect((await load("other", published.id))?.framework.systems).toBe(1);
    expect((await load("viewer", published.id))?.framework.systems).toBe(0);
  });
});

describe("the Framework switcher", () => {
  it("lists the Frameworks the user can see: Drafts only for those who can see Drafts", async () => {
    const ids = async (key: string) => (await load(key, published.id))!.frameworks.map((f) => f.id);
    expect(await ids("viewer")).toContain(published.id);
    expect(await ids("viewer")).not.toContain(draft.id);
    expect(await ids("cm")).toEqual(expect.arrayContaining([published.id, draft.id]));
    const entry = (await load("cm", published.id))!.frameworks.find((f) => f.id === draft.id);
    expect(entry).toEqual({ id: draft.id, label: `${name("Draft")}:1`, status: "DRAFT" });
  });
});

describe("the Control Library", () => {
  it("is sent to Compliance Managers and Admins only", async () => {
    for (const key of ["cm", "admin"]) {
      const controls = (await load(key, published.id))!.controls;
      expect(controls.map((c) => c.id)).toContain(fullControl);
      expect(controls.find((c) => c.id === fullControl)).toEqual({ id: fullControl, code: `TEST-269-FULL-${suffix}`, title: "Test 269 full control", supplementary: false });
    }
    expect((await load("cm", published.id))!.controls.find((c) => c.code === `TEST-269-SUP-${suffix}`)?.supplementary).toBe(true);
    for (const key of ["viewer", "owner"]) expect((await load(key, published.id))!.controls).toEqual([]);
  });
});

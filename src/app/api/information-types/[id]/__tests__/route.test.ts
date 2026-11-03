import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { DELETE, GET, PATCH } from "../route";

/**
 * /api/information-types/[id] (#303), against real Postgres. Fixture Information Types and Systems are `Test …` rows
 * created here and removed in `afterAll` (CI's database is not seeded). Refused writes assert the rows are unchanged,
 * and a level change asserts the declaring Systems are untouched (ADR 0012).
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test IT id ${label} ${suffix}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "INTERNAL_AUDITOR"];

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/information-types/${id}`, { ...init, headers });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, userId: string | null, body: unknown) =>
  PATCH(requestAs(id, userId, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), ctxFor(id));
const del = (id: string, userId: string | null) => DELETE(requestAs(id, userId, { method: "DELETE" }), ctxFor(id));
const get = (id: string, userId: string | null) => GET(requestAs(id, userId), ctxFor(id));

describe("/api/information-types/[id]", () => {
  const userIds = {} as Record<UserRole, string>;
  const systemIds: string[] = [];

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (await prisma.user.create({ data: { email: `test-it-id-${role.toLowerCase()}-${suffix}@example.com`, name: `Test IT ${role}`, role } })).id;
    }
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.informationType.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  async function createSystem(label: string, ownerId: string, data: { status?: "DRAFT" | "ONBOARDED"; sensitivityLevel?: number | null } = {}) {
    const system = await prisma.system.create({
      data: { name: `Test IT id System ${label} ${suffix}`, ownerId, status: data.status ?? "DRAFT", sensitivityLevel: data.sensitivityLevel ?? null },
    });
    systemIds.push(system.id);
    return system;
  }
  const declare = (typeId: string, systemId: string) =>
    prisma.informationType.update({ where: { id: typeId }, data: { systems: { connect: { id: systemId } } } });
  const typeRow = (id: string) => prisma.informationType.findUnique({ where: { id } });

  it("GET: 401 without a user, 404 for an unknown id, 200 for any signed-in role", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("read"), sensitivityLevel: 3 } });
    expect((await get(type.id, null)).status).toBe(401);
    expect((await get("no-such-type", userIds.VIEWER)).status).toBe(404);
    for (const role of ROLES) {
      const response = await get(type.id, userIds[role]);
      expect(response.status, role).toBe(200);
      expect((await response.json()).informationType).toMatchObject({ id: type.id, name: NAME("read"), systemCount: 0 });
    }
  });

  it("GET: lists the declaring Systems the acting user may see, and counts them all", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("declared"), sensitivityLevel: 3 } });
    const mine = await createSystem("mine", userIds.SYSTEM_OWNER, { sensitivityLevel: 3 });
    const hidden = await createSystem("hidden", userIds.RISK_OWNER, { status: "DRAFT" });
    await declare(type.id, mine.id);
    await declare(type.id, hidden.id);

    const asOwner = await (await get(type.id, userIds.SYSTEM_OWNER)).json();
    expect(asOwner.informationType.systemCount).toBe(2);
    expect(asOwner.systems.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    expect(asOwner.systems[0]).toMatchObject({ name: mine.name, sensitivityLevel: 3 });

    const asManager = await (await get(type.id, userIds.COMPLIANCE_MANAGER)).json();
    expect(asManager.systems.map((s: { id: string }) => s.id).sort()).toEqual([mine.id, hidden.id].sort());
  });

  it("PATCH: the Compliance Manager and an Admin rename, describe and change the level", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("edit"), description: "Before.", sensitivityLevel: 2 } });
    const renamed = await patch(type.id, userIds.COMPLIANCE_MANAGER, { name: `  ${NAME("edited")} `, description: "After." });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).informationType).toMatchObject({ name: NAME("edited"), description: "After.", sensitivityLevel: 2 });
    const leveled = await patch(type.id, userIds.ADMIN, { sensitivityLevel: 5 });
    expect(leveled.status).toBe(200);
    expect(await typeRow(type.id)).toMatchObject({ name: NAME("edited"), description: "After.", sensitivityLevel: 5 });
    const cleared = await patch(type.id, userIds.ADMIN, { description: "" });
    expect(cleared.status).toBe(200);
    expect((await typeRow(type.id))?.description).toBeNull();
  });

  it("PATCH: changing the level leaves every declaring System exactly as it was", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("raise"), sensitivityLevel: 2 } });
    const system = await createSystem("raise", userIds.SYSTEM_OWNER, { sensitivityLevel: 2 });
    await declare(type.id, system.id);
    const before = await prisma.system.findUniqueOrThrow({ where: { id: system.id }, include: { informationTypes: { select: { id: true } } } });
    const eventsBefore = await prisma.changeEvent.count({ where: { systemId: system.id } });

    expect((await patch(type.id, userIds.COMPLIANCE_MANAGER, { sensitivityLevel: 5 })).status).toBe(200);
    expect((await typeRow(type.id))?.sensitivityLevel).toBe(5);

    const after = await prisma.system.findUniqueOrThrow({ where: { id: system.id }, include: { informationTypes: { select: { id: true } } } });
    expect(after).toEqual(before);
    expect(after.sensitivityLevel).toBe(2);
    expect(after.informationTypes.map((t) => t.id)).toEqual([type.id]);
    expect(await prisma.changeEvent.count({ where: { systemId: system.id } })).toBe(eventsBefore);
  });

  it("PATCH: 401 without a user and 403 for every other role, changing nothing", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("patch refused"), description: "Same.", sensitivityLevel: 3 } });
    const before = await typeRow(type.id);
    const body = { name: NAME("hijacked"), sensitivityLevel: 5 };
    expect((await patch(type.id, null, body)).status).toBe(401);
    for (const role of ROLES.filter((r) => r !== "ADMIN" && r !== "COMPLIANCE_MANAGER")) {
      expect((await patch(type.id, userIds[role], body)).status, role).toBe(403);
    }
    expect(await typeRow(type.id)).toEqual(before);
  });

  it("PATCH: refuses an empty or bad body (400), an unknown id (404) and a duplicate name (409), changing nothing", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("patch bad"), sensitivityLevel: 3 } });
    const other = await prisma.informationType.create({ data: { name: NAME("patch other"), sensitivityLevel: 1 } });
    const before = [await typeRow(type.id), await typeRow(other.id)];
    const bad: [string, unknown][] = [
      ["not JSON", "nope"],
      ["empty body", {}],
      ["blank name", { name: " " }],
      ["level 6", { sensitivityLevel: 6 }],
      ["level null", { sensitivityLevel: null }],
      ["long description", { description: "x".repeat(301) }],
    ];
    for (const [label, body] of bad) expect((await patch(type.id, userIds.ADMIN, body)).status, label).toBe(400);
    expect((await patch("no-such-type", userIds.ADMIN, { name: "Anything" })).status).toBe(404);
    const duplicate = await patch(type.id, userIds.ADMIN, { name: NAME("patch other") });
    expect(duplicate.status).toBe(409);
    expect([await typeRow(type.id), await typeRow(other.id)]).toEqual(before);
  });

  it("DELETE: a type no System declares is deleted (204) by the Compliance Manager and an Admin; a second delete is 404", async () => {
    for (const [role, label] of [["COMPLIANCE_MANAGER", "del a"], ["ADMIN", "del b"]] as const) {
      const type = await prisma.informationType.create({ data: { name: NAME(label), sensitivityLevel: 1 } });
      expect((await del(type.id, userIds[role])).status, role).toBe(204);
      expect(await typeRow(type.id)).toBeNull();
      expect((await del(type.id, userIds[role])).status).toBe(404);
    }
  });

  it("DELETE: 401 without a user and 403 for every other role, deleting nothing", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("del refused"), sensitivityLevel: 4 } });
    const before = await typeRow(type.id);
    expect((await del(type.id, null)).status).toBe(401);
    for (const role of ROLES.filter((r) => r !== "ADMIN" && r !== "COMPLIANCE_MANAGER")) {
      expect((await del(type.id, userIds[role])).status, role).toBe(403);
    }
    expect(await typeRow(type.id)).toEqual(before);
  });

  it("DELETE: 409 with a clear message while a System declares the type, and the type and the declaration stay", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("in use"), sensitivityLevel: 3 } });
    const system = await createSystem("in use", userIds.SYSTEM_OWNER);
    await declare(type.id, system.id);
    const before = await typeRow(type.id);

    for (const role of ["COMPLIANCE_MANAGER", "ADMIN"] as const) {
      const response = await del(type.id, userIds[role]);
      expect(response.status, role).toBe(409);
      expect((await response.json()).error).toMatch(/declared by 1 System and can't be deleted/);
    }
    expect(await typeRow(type.id)).toEqual(before);
    const declared = await prisma.system.count({ where: { id: system.id, informationTypes: { some: { id: type.id } } } });
    expect(declared).toBe(1);

    // Once no System declares it, the delete goes through.
    await prisma.informationType.update({ where: { id: type.id }, data: { systems: { disconnect: { id: system.id } } } });
    expect((await del(type.id, userIds.ADMIN)).status).toBe(204);
  });

  it("deleting a System removes its declarations and leaves the type", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("system gone"), sensitivityLevel: 3 } });
    const system = await createSystem("gone", userIds.SYSTEM_OWNER);
    await declare(type.id, system.id);
    await prisma.system.delete({ where: { id: system.id } });
    expect((await typeRow(type.id))?.id).toBe(type.id);
    expect((await (await get(type.id, userIds.VIEWER)).json()).informationType.systemCount).toBe(0);
  });
});

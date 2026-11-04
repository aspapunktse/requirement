import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CONTROL_BULK_OWNER_MAX } from "@/lib/control-bulk-rules";
import { CONTROL_OWNER_REFUSAL } from "@/lib/system-permissions";
import { requestAs } from "@/test/provider-fixtures";
import { PATCH } from "../route";

/** The bulk Assign owner of the Control Library (#313): `PATCH /api/controls` with `{ controlIds, ownerId }`. */
describe("PATCH /api/controls (bulk Assign owner, #313)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];
  const CURATORS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];
  const users: Record<string, string> = {};
  const controlIds: string[] = [];
  let firstOwnerId = "";
  let newOwnerId = "";

  const call = (userId: string | null, body: unknown) => PATCH(requestAs("/api/controls", userId, "PATCH", body));
  const owners = async () => {
    const rows = await prisma.control.findMany({ where: { id: { in: controlIds } }, select: { id: true, ownerId: true } });
    return Object.fromEntries(rows.map((row) => [row.id, row.ownerId]));
  };
  const unchanged = async () => expect(await owners()).toEqual({ [controlIds[0]]: firstOwnerId, [controlIds[1]]: firstOwnerId, [controlIds[2]]: null });

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-313-bulk-${role}-${suffix}@example.com`, name: `Test 313 ${role} ${suffix}`, role } })).id;
    }
    firstOwnerId = users.SYSTEM_OWNER;
    newOwnerId = users.REVIEWER;
    for (const index of [0, 1, 2]) {
      const control = await prisma.control.create({
        data: { code: `TEST-313-BULK-${suffix}-${index}`, title: `Test 313 bulk ${index}`, description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
      });
      controlIds.push(control.id);
    }
  });

  beforeEach(async () => {
    await prisma.control.updateMany({ where: { id: { in: controlIds.slice(0, 2) } }, data: { ownerId: firstOwnerId } });
    await prisma.control.updateMany({ where: { id: controlIds[2] }, data: { ownerId: null } });
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.com` } } });
  });

  it.each(CURATORS)("lets the %s assign one Control Owner to several Controls, all at once", async (role) => {
    const response = await call(users[role], { controlIds, ownerId: newOwnerId });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.controls).toHaveLength(3);
    expect(body.controls.every((control: { owner: { id: string; name: string } }) => control.owner.id === newOwnerId)).toBe(true);
    expect(body.controls[0].owner.name).toBe(`Test 313 REVIEWER ${suffix}`);
    expect(await owners()).toEqual({ [controlIds[0]]: newOwnerId, [controlIds[1]]: newOwnerId, [controlIds[2]]: newOwnerId });
  });

  it("clears the Control Owner with a null ownerId", async () => {
    const response = await call(users.ADMIN, { controlIds: controlIds.slice(0, 2), ownerId: null });
    expect(response.status).toBe(200);
    expect((await response.json()).controls.map((control: { owner: unknown }) => control.owner)).toEqual([null, null]);
    expect(await owners()).toEqual({ [controlIds[0]]: null, [controlIds[1]]: null, [controlIds[2]]: null });
  });

  it.each(ROLES.filter((role) => !CURATORS.includes(role)))("refuses the %s with 403 and changes nothing", async (role) => {
    const response = await call(users[role], { controlIds, ownerId: newOwnerId });
    expect(response.status).toBe(403);
    await unchanged();
  });

  it("refuses a request with no acting user with 401 and changes nothing", async () => {
    expect((await call(null, { controlIds, ownerId: newOwnerId })).status).toBe(401);
    await unchanged();
  });

  it("refuses an unknown Control id with 404 naming it, and assigns none of the others", async () => {
    const response = await call(users.ADMIN, { controlIds: [...controlIds, "no-such-control"], ownerId: newOwnerId });
    expect(response.status).toBe(404);
    expect((await response.json()).missingIds).toEqual(["no-such-control"]);
    await unchanged();
  });

  it("refuses an unknown User with 400 and changes nothing", async () => {
    const response = await call(users.ADMIN, { controlIds, ownerId: "no-such-user" });
    expect(response.status).toBe(400);
    await unchanged();
  });

  it("refuses an Internal Auditor as Control Owner with the same 400 as the single-Control route, and changes nothing", async () => {
    const response = await call(users.ADMIN, { controlIds, ownerId: users.INTERNAL_AUDITOR });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(CONTROL_OWNER_REFUSAL);
    await unchanged();
  });

  it.each([
    ["an empty list", { controlIds: [], ownerId: null }],
    ["a repeated id", { controlIds: ["a", "a"], ownerId: null }],
    ["no ownerId", { controlIds: ["a"] }],
    ["an empty ownerId", { controlIds: ["a"], ownerId: "" }],
    ["ids that are not a list", { controlIds: "a", ownerId: null }],
    ["more than the limit", { controlIds: Array.from({ length: CONTROL_BULK_OWNER_MAX + 1 }, (_, index) => `id-${index}`), ownerId: null }],
    ["no body", undefined],
  ])("refuses %s with 400 and changes nothing", async (_name, body) => {
    const response = await call(users.ADMIN, body);
    expect(response.status).toBe(400);
    await unchanged();
  });
});

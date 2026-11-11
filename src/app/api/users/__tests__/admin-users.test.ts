import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { LAST_ADMIN_REFUSAL, updateUser } from "@/lib/user-admin";
import { POST } from "../route";
import { PATCH } from "../[id]/route";

/**
 * Admin -> Users (#364), against real Postgres. Every User here is a `Test 364` fixture with a unique email; the
 * tests run beside files that create their own Admins, so none of them counts on how many Admins exist and none
 * touches a User it didn't create. The last-Admin rule is checked through `updateUser` with a controlled admin count.
 */
const suffix = `${process.pid}-${Date.now()}`;
const email = (label: string) => `test-364-${label}-${suffix}@example.com`;

describe("Admin -> Users routes", () => {
  let adminId: string;
  let secondAdminId: string;
  let viewerId: string;
  let managerId: string;
  let targetId: string;

  const asRequest = (userId: string | null, url: string, method: string, body?: unknown) => {
    const headers = new Headers();
    if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
    return new NextRequest(url, { method, headers, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  };
  const create = (userId: string | null, body: unknown) => POST(asRequest(userId, "http://localhost/api/users", "POST", body));
  const patch = (userId: string | null, id: string, body: unknown) =>
    PATCH(asRequest(userId, `http://localhost/api/users/${id}`, "PATCH", body), { params: Promise.resolve({ id }) } as never);
  const events = (actions: string[]) =>
    prisma.changeEvent.findMany({ where: { actorId: { in: [adminId, secondAdminId, viewerId, managerId] }, action: { in: actions as never[] } }, orderBy: { createdAt: "asc" } });
  const userRow = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
  const userCount = () => prisma.user.count({ where: { email: { contains: suffix } } });

  beforeAll(async () => {
    const make = async (label: string, role: "ADMIN" | "VIEWER" | "COMPLIANCE_MANAGER") =>
      (await prisma.user.create({ data: { email: email(label), name: `Test 364 ${label}`, role } })).id;
    adminId = await make("admin", "ADMIN");
    secondAdminId = await make("admin2", "ADMIN");
    viewerId = await make("viewer", "VIEWER");
    managerId = await make("manager", "COMPLIANCE_MANAGER");
    targetId = await make("target", "VIEWER");
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: [adminId, secondAdminId, viewerId, managerId] }, systemId: null } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
  });

  it("POST: 401 without a user and 403 for a non-Admin, with nothing created", async () => {
    const before = await userCount();
    const body = { name: "Test 364 Nope", email: email("nope"), role: "VIEWER" };
    expect((await create(null, body)).status).toBe(401);
    expect((await create(viewerId, body)).status).toBe(403);
    expect((await create(managerId, body)).status).toBe(403);
    expect(await userCount()).toBe(before);
    expect(await events(["USER_CREATED"])).toEqual([]);
  });

  it("POST: creates a User with the name trimmed and the email trimmed and lowercased, and writes USER_CREATED", async () => {
    const mixed = `  Test-364-Created-${suffix}@Example.COM `;
    const response = await create(adminId, { name: "  Test 364 Created  ", email: mixed, role: "BUSINESS_RISK_OWNER" });
    expect(response.status).toBe(201);
    const { user } = await response.json();
    expect(user).toMatchObject({ name: "Test 364 Created", email: `test-364-created-${suffix}@example.com`, role: "BUSINESS_RISK_OWNER" });
    expect(await userRow(user.id)).toMatchObject({ name: "Test 364 Created", email: user.email, role: "BUSINESS_RISK_OWNER" });
    const written = await events(["USER_CREATED"]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ systemId: null, actorId: adminId });
    expect(written[0].detail).toContain("Test 364 Created");
    expect(written[0].detail).toContain(user.email);
    expect(written[0].detail).toContain("Business Risk Owner");
  });

  it("POST: a duplicate email is 409, whatever its case, and creates nothing", async () => {
    const before = await userCount();
    for (const duplicate of [email("viewer"), email("viewer").toUpperCase(), ` ${email("viewer")} `]) {
      const response = await create(adminId, { name: "Test 364 Dup", email: duplicate, role: "VIEWER" });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/already exists/);
    }
    expect(await userCount()).toBe(before);
  });

  it.each([
    ["no body", ""],
    ["not JSON", "{nope"],
    ["an empty name", { name: "   ", email: "x@example.com", role: "VIEWER" }],
    ["no name", { email: "x@example.com", role: "VIEWER" }],
    ["no email", { name: "Test 364 X", role: "VIEWER" }],
    ["an invalid email", { name: "Test 364 X", email: "not-an-email", role: "VIEWER" }],
    ["no role", { name: "Test 364 X", email: "x@example.com" }],
    ["an unknown role", { name: "Test 364 X", email: "x@example.com", role: "SUPERUSER" }],
    ["an unknown field", { name: "Test 364 X", email: "x@example.com", role: "VIEWER", id: "abc" }],
  ])("POST: %s is 400 and creates nothing", async (_label, body) => {
    const eventsBefore = await events(["USER_CREATED"]);
    expect((await create(adminId, body)).status).toBe(400);
    // None of the bodies above is valid, so none may have created the User it names.
    expect(await prisma.user.count({ where: { email: "x@example.com" } })).toBe(0);
    expect(await events(["USER_CREATED"])).toHaveLength(eventsBefore.length);
  });

  it("PATCH: 401 without a user and 403 for a non-Admin, with nothing changed", async () => {
    const before = await userRow(targetId);
    expect((await patch(null, targetId, { name: "Test 364 Hacked" })).status).toBe(401);
    expect((await patch(viewerId, targetId, { name: "Test 364 Hacked" })).status).toBe(403);
    expect((await patch(managerId, targetId, { role: "ADMIN" })).status).toBe(403);
    expect(await userRow(targetId)).toEqual(before);
    expect(await events(["USER_RENAMED", "USER_ROLE_CHANGED"])).toEqual([]);
  });

  it("PATCH: 404 for an unknown User and 400 for an empty or invalid body", async () => {
    expect((await patch(adminId, "no-such-user", { name: "Test 364 Ghost" })).status).toBe(404);
    expect((await patch(adminId, targetId, {})).status).toBe(400);
    expect((await patch(adminId, targetId, { name: " " })).status).toBe(400);
    expect((await patch(adminId, targetId, { email: "nope" })).status).toBe(400);
    expect((await patch(adminId, targetId, { role: "GOD" })).status).toBe(400);
    expect((await patch(adminId, targetId, "{nope")).status).toBe(400);
    expect((await userRow(targetId)).name).toBe("Test 364 target");
  });

  it("PATCH: renames and changes the email, writing one USER_RENAMED that names the old and the new values", async () => {
    const response = await patch(adminId, targetId, { name: "Test 364 Renamed", email: email("Renamed").toUpperCase() });
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(true);
    expect(await userRow(targetId)).toMatchObject({ name: "Test 364 Renamed", email: email("renamed"), role: "VIEWER" });
    const written = await events(["USER_RENAMED"]);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ systemId: null, actorId: adminId });
    expect(written[0].detail).toContain("Test 364 target");
    expect(written[0].detail).toContain("Test 364 Renamed");
    expect(written[0].detail).toContain(email("target"));
    expect(written[0].detail).toContain(email("renamed"));
    expect(await events(["USER_ROLE_CHANGED"])).toEqual([]);
  });

  it("PATCH: an email another User has is 409 (case-insensitively) and changes nothing; the User's own email in another case is no change", async () => {
    const before = await userRow(targetId);
    const eventsBefore = (await events(["USER_RENAMED"])).length;
    const response = await patch(adminId, targetId, { email: email("VIEWER") });
    expect(response.status).toBe(409);
    expect(await userRow(targetId)).toEqual(before);
    expect(await events(["USER_RENAMED"])).toHaveLength(eventsBefore);
    const own = await patch(adminId, targetId, { email: before.email.toUpperCase() });
    expect(own.status).toBe(200);
    expect((await own.json()).changed).toBe(false);
    expect(await events(["USER_RENAMED"])).toHaveLength(eventsBefore);
  });

  it("PATCH: changes a role, keeping what the User holds, and writes USER_ROLE_CHANGED; a name and a role together write both events", async () => {
    const system = await prisma.system.create({ data: { name: `Test 364 System ${suffix}`, ownerId: targetId } });
    try {
      const renamedBefore = (await events(["USER_RENAMED"])).length;
      const response = await patch(adminId, targetId, { role: "BUSINESS_RISK_OWNER" });
      expect(response.status).toBe(200);
      expect((await userRow(targetId)).role).toBe("BUSINESS_RISK_OWNER");
      // Decision 1a: nothing is cleared or moved.
      expect((await prisma.system.findUniqueOrThrow({ where: { id: system.id } })).ownerId).toBe(targetId);
      const roleEvents = await events(["USER_ROLE_CHANGED"]);
      expect(roleEvents).toHaveLength(1);
      expect(roleEvents[0].detail).toContain("Viewer");
      expect(roleEvents[0].detail).toContain("Business Risk Owner");

      const both = await patch(adminId, targetId, { name: "Test 364 Both", role: "REVIEWER" });
      expect(both.status).toBe(200);
      expect(await userRow(targetId)).toMatchObject({ name: "Test 364 Both", role: "REVIEWER" });
      expect(await events(["USER_ROLE_CHANGED"])).toHaveLength(2);
      expect(await events(["USER_RENAMED"])).toHaveLength(renamedBefore + 1);
      expect((await prisma.system.findUniqueOrThrow({ where: { id: system.id } })).ownerId).toBe(targetId);
    } finally {
      await prisma.system.delete({ where: { id: system.id } });
    }
  });

  it("PATCH: saving the values a User already has changes nothing and writes no event", async () => {
    const before = await userRow(targetId);
    const eventsBefore = await events(["USER_RENAMED", "USER_ROLE_CHANGED"]);
    const response = await patch(adminId, targetId, { name: before.name, email: before.email, role: before.role });
    expect(response.status).toBe(200);
    expect((await response.json()).changed).toBe(false);
    expect(await events(["USER_RENAMED", "USER_ROLE_CHANGED"])).toHaveLength(eventsBefore.length);
  });

  it("PATCH: an Admin may demote another Admin, and themself, while another Admin remains", async () => {
    // Both fixtures are Admins, so each demotion leaves the other whatever else is in the database.
    expect((await patch(adminId, secondAdminId, { role: "VIEWER" })).status).toBe(200);
    expect((await userRow(secondAdminId)).role).toBe("VIEWER");
    expect((await patch(adminId, secondAdminId, { role: "ADMIN" })).status).toBe(200);
    expect((await patch(secondAdminId, adminId, { role: "VIEWER" })).status).toBe(200);
    expect((await userRow(adminId)).role).toBe("VIEWER");
    // adminId is no longer an Admin, so it can't promote itself back; the other fixture does.
    expect((await patch(adminId, adminId, { role: "ADMIN" })).status).toBe(403);
    expect((await patch(secondAdminId, adminId, { role: "ADMIN" })).status).toBe(200);
    expect((await userRow(adminId)).role).toBe("ADMIN");
  });
});

describe("updateUser: the last Admin rule", () => {
  const suffix2 = `${process.pid}-${Date.now()}-last`;
  let actorId: string;
  let soleAdminId: string;
  let otherId: string;

  beforeAll(async () => {
    const make = async (label: string, role: "ADMIN" | "VIEWER") =>
      (await prisma.user.create({ data: { email: `test-364-${label}-${suffix2}@example.com`, name: `Test 364 ${label}`, role } })).id;
    actorId = await make("actor", "ADMIN");
    soleAdminId = await make("sole", "ADMIN");
    otherId = await make("other", "VIEWER");
  });
  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { actorId, systemId: null } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix2 } } });
  });

  it("refuses with 409 a change that would leave no Admin, and changes nothing, not even a name saved with it", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: soleAdminId } });
    const result = await updateUser(actorId, soleAdminId, { name: "Test 364 Renamed Sole", role: "VIEWER" }, async () => 0);
    expect(result).toEqual({ ok: false, status: 409, error: LAST_ADMIN_REFUSAL });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: soleAdminId } })).toEqual(before);
    expect(await prisma.changeEvent.count({ where: { actorId, action: { in: ["USER_RENAMED", "USER_ROLE_CHANGED"] } } })).toBe(0);
  });

  it("still lets the last Admin be renamed, and a non-Admin change role", async () => {
    expect((await updateUser(actorId, soleAdminId, { name: "Test 364 Sole Renamed" }, async () => 0)).ok).toBe(true);
    expect((await updateUser(actorId, otherId, { role: "REVIEWER" }, async () => 0)).ok).toBe(true);
    expect((await updateUser(actorId, soleAdminId, { role: "ADMIN" }, async () => 0)).ok).toBe(true);
  });

  it("allows the demotion when another Admin remains", async () => {
    const result = await updateUser(actorId, soleAdminId, { role: "SYSTEM_OWNER" }, async () => 1);
    expect(result.ok).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: soleAdminId } })).role).toBe("SYSTEM_OWNER");
  });

  it("counts the real Admins by default: the actor is an Admin too, so demoting another Admin passes", async () => {
    await prisma.user.update({ where: { id: soleAdminId }, data: { role: "ADMIN" } });
    expect((await updateUser(actorId, soleAdminId, { role: "VIEWER" })).ok).toBe(true);
  });
});

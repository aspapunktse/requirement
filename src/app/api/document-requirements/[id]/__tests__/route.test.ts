import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { DELETE, GET, PATCH } from "../route";

/**
 * /api/document-requirements/[id] (#323), against real Postgres. Fixtures are `Test …` rows created here and removed
 * in `afterAll` (CI's database is not seeded). Refused writes assert the row is unchanged.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test DR id ${label} ${suffix}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "INTERNAL_AUDITOR"];

function requestAs(id: string, userId: string | null, init?: { method?: string; body?: string }) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/document-requirements/${id}`, { ...init, headers });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, userId: string | null, body: unknown) =>
  PATCH(requestAs(id, userId, { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), ctxFor(id));
const del = (id: string, userId: string | null) => DELETE(requestAs(id, userId, { method: "DELETE" }), ctxFor(id));
const get = (id: string, userId: string | null) => GET(requestAs(id, userId), ctxFor(id));

describe("/api/document-requirements/[id]", () => {
  const userIds = {} as Record<UserRole, string>;

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (await prisma.user.create({ data: { email: `test-dr-id-${role.toLowerCase()}-${suffix}@example.com`, name: `Test DR ${role}`, role } })).id;
    }
  });

  afterAll(async () => {
    await prisma.documentRequirement.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  const create = (label: string, stage: "FIRST_DOCUMENTATION" | "SECOND_ROUND" = "SECOND_ROUND", tracks: ("SELF" | "FULL")[] = ["FULL"]) =>
    prisma.documentRequirement.create({ data: { name: NAME(label), description: "Original.", stage, tracks } });
  const stored = (id: string) => prisma.documentRequirement.findUniqueOrThrow({ where: { id } });

  it("GET: 401 without a user, every signed-in role reads one, an unknown id is 404", async () => {
    const row = await create("get", "SECOND_ROUND", ["SELF", "FULL"]);
    expect((await get(row.id, null)).status).toBe(401);
    for (const role of ROLES) {
      const response = await get(row.id, userIds[role]);
      expect(response.status, role).toBe(200);
      expect((await response.json()).documentRequirement).toEqual({ id: row.id, name: NAME("get"), description: "Original.", stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] });
    }
    expect((await get("missing-id", userIds.VIEWER)).status).toBe(404);
  });

  it("PATCH: the Compliance Manager and an Admin rename, describe, and change the stage and Tracks", async () => {
    const row = await create("edit");
    const renamed = await patch(row.id, userIds.COMPLIANCE_MANAGER, { name: `  ${NAME("edited")}  `, description: "Changed." });
    expect(renamed.status).toBe(200);
    expect((await renamed.json()).documentRequirement).toMatchObject({ name: NAME("edited"), description: "Changed.", stage: "SECOND_ROUND", tracks: ["FULL"] });

    const both = await patch(row.id, userIds.ADMIN, { tracks: ["FULL", "SELF"] });
    expect(both.status).toBe(200);
    expect((await both.json()).documentRequirement.tracks).toEqual(["SELF", "FULL"]);

    const cleared = await patch(row.id, userIds.ADMIN, { description: "  " });
    expect((await cleared.json()).documentRequirement.description).toBeNull();

    const moved = await patch(row.id, userIds.ADMIN, { stage: "FIRST_DOCUMENTATION", tracks: ["FULL"] });
    expect(moved.status).toBe(200);
    expect(await stored(row.id)).toMatchObject({ stage: "FIRST_DOCUMENTATION", tracks: ["FULL"], name: NAME("edited"), description: null });
  });

  it("PATCH: 401 without a user and 403 for every other role, changing nothing", async () => {
    const row = await create("refused");
    const before = await stored(row.id);
    expect((await patch(row.id, null, { name: NAME("nope") })).status).toBe(401);
    for (const role of ROLES.filter((r) => r !== "ADMIN" && r !== "COMPLIANCE_MANAGER")) {
      expect((await patch(row.id, userIds[role], { name: NAME("nope") })).status, role).toBe(403);
    }
    expect(await stored(row.id)).toEqual(before);
  });

  it("PATCH: first documentation with Self is refused (400) whichever field the edit changes, checked against the stored other field", async () => {
    const second = await create("to first", "SECOND_ROUND", ["SELF", "FULL"]);
    const first = await create("first", "FIRST_DOCUMENTATION", ["FULL"]);
    const beforeSecond = await stored(second.id);
    const beforeFirst = await stored(first.id);

    // Only the stage changes, and the stored Tracks include Self.
    expect((await patch(second.id, userIds.COMPLIANCE_MANAGER, { stage: "FIRST_DOCUMENTATION" })).status).toBe(400);
    // Only the Tracks change, and the stored stage is first documentation.
    const onlyTracks = await patch(first.id, userIds.ADMIN, { tracks: ["SELF"] });
    expect(onlyTracks.status).toBe(400);
    expect((await onlyTracks.json()).error).toMatch(/Full-track stage/);
    expect((await patch(first.id, userIds.ADMIN, { tracks: ["SELF", "FULL"] })).status).toBe(400);
    // Both change together.
    expect((await patch(second.id, userIds.ADMIN, { stage: "FIRST_DOCUMENTATION", tracks: ["SELF"] })).status).toBe(400);
    // A rename alone is fine for a valid row; the refusals above wrote nothing, not even a name.
    expect((await patch(second.id, userIds.ADMIN, { stage: "FIRST_DOCUMENTATION", name: NAME("renamed too") })).status).toBe(400);

    expect(await stored(second.id)).toEqual(beforeSecond);
    expect(await stored(first.id)).toEqual(beforeFirst);
    // The allowed edit of the same rows still works.
    expect((await patch(second.id, userIds.ADMIN, { stage: "FIRST_DOCUMENTATION", tracks: ["FULL"] })).status).toBe(200);
  });

  it("PATCH: refuses a bad body (400), an unknown id (404) and a duplicate name (409), changing nothing", async () => {
    const row = await create("patch bad");
    await create("patch taken");
    const before = await stored(row.id);
    const bad: [string, unknown][] = [
      ["not JSON", "nope"],
      ["empty body", {}],
      ["blank name", { name: "  " }],
      ["long name", { name: "x".repeat(81) }],
      ["long description", { description: "x".repeat(301) }],
      ["unknown stage", { stage: "THIRD_ROUND" }],
      ["empty tracks", { tracks: [] }],
      ["unknown track", { tracks: ["FAST"] }],
    ];
    for (const [label, body] of bad) expect((await patch(row.id, userIds.COMPLIANCE_MANAGER, body)).status, label).toBe(400);
    expect((await patch("missing-id", userIds.ADMIN, { name: NAME("ghost") })).status).toBe(404);
    const duplicate = await patch(row.id, userIds.ADMIN, { name: NAME("patch taken") });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/already exists/);
    expect(await stored(row.id)).toEqual(before);
  });

  it("DELETE: 401 and 403 delete nothing; the Compliance Manager and an Admin delete (204), then it is gone (404)", async () => {
    const row = await create("delete");
    expect((await del(row.id, null)).status).toBe(401);
    for (const role of ROLES.filter((r) => r !== "ADMIN" && r !== "COMPLIANCE_MANAGER")) {
      expect((await del(row.id, userIds[role])).status, role).toBe(403);
    }
    expect(await prisma.documentRequirement.count({ where: { id: row.id } })).toBe(1);

    expect((await del(row.id, userIds.COMPLIANCE_MANAGER)).status).toBe(204);
    expect(await prisma.documentRequirement.count({ where: { id: row.id } })).toBe(0);
    expect((await del(row.id, userIds.COMPLIANCE_MANAGER)).status).toBe(404);

    const other = await create("delete admin");
    expect((await del(other.id, userIds.ADMIN)).status).toBe(204);
    expect(await prisma.documentRequirement.count({ where: { id: other.id } })).toBe(0);
  });
});

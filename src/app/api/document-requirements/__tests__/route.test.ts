import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";

/**
 * /api/document-requirements (#323), against real Postgres. Every fixture is a `Test …` Document Requirement created
 * here and removed in `afterAll`; CI's database is migrated but not seeded. Refused writes assert the fixture rows are
 * exactly as they were.
 */
const URL = "http://localhost/api/document-requirements";
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test DR ${label} ${suffix}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "INTERNAL_AUDITOR"];

describe("/api/document-requirements", () => {
  const userIds = {} as Record<UserRole, string>;

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (await prisma.user.create({ data: { email: `test-dr-${role.toLowerCase()}-${suffix}@example.com`, name: `Test DR ${role}`, role } })).id;
    }
  });

  afterAll(async () => {
    await prisma.documentRequirement.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  function requestAs(userId: string | null, init?: { method?: string; body?: string }) {
    const headers = new Headers();
    if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
    return new NextRequest(URL, { ...init, headers });
  }
  const post = (userId: string | null, body: unknown) =>
    POST(requestAs(userId, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  const fixtureRows = () => prisma.documentRequirement.findMany({ where: { name: { contains: suffix } }, orderBy: { name: "asc" } });

  it("GET: 401 without a user, and every signed-in role reads the catalogue", async () => {
    const row = await prisma.documentRequirement.create({ data: { name: NAME("list"), description: "Listed.", stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] } });
    expect((await GET(requestAs(null))).status).toBe(401);
    for (const role of ROLES) {
      const response = await GET(requestAs(userIds[role]));
      expect(response.status, role).toBe(200);
      const { documentRequirements } = await response.json();
      expect(documentRequirements.find((item: { id: string }) => item.id === row.id)).toEqual({
        id: row.id,
        name: NAME("list"),
        description: "Listed.",
        stage: "SECOND_ROUND",
        tracks: ["SELF", "FULL"],
      });
    }
  });

  it("GET: first documentation before second round, then by name", async () => {
    await prisma.documentRequirement.createMany({
      data: [
        { name: NAME("order b"), stage: "SECOND_ROUND", tracks: ["FULL"] },
        { name: NAME("order z"), stage: "FIRST_DOCUMENTATION", tracks: ["FULL"] },
        { name: NAME("order a"), stage: "SECOND_ROUND", tracks: ["FULL"] },
      ],
    });
    const { documentRequirements } = await (await GET(requestAs(userIds.VIEWER))).json();
    const names = documentRequirements.map((row: { name: string }) => row.name).filter((name: string) => name.startsWith("Test DR order"));
    expect(names).toEqual([NAME("order z"), NAME("order a"), NAME("order b")]);
  });

  it("POST: the Compliance Manager and an Admin create one; the name and description are trimmed, Tracks are ordered and de-duplicated", async () => {
    for (const [role, label] of [["COMPLIANCE_MANAGER", "by manager"], ["ADMIN", "by admin"]] as const) {
      const response = await post(userIds[role], { name: `  ${NAME(label)}  `, description: "   ", stage: "SECOND_ROUND", tracks: ["FULL", "SELF", "FULL"] });
      expect(response.status, role).toBe(201);
      const { documentRequirement } = await response.json();
      expect(documentRequirement).toMatchObject({ name: NAME(label), description: null, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] });
      expect(await prisma.documentRequirement.findUnique({ where: { id: documentRequirement.id } })).toMatchObject({ name: NAME(label), description: null });
    }
    const first = await post(userIds.ADMIN, { name: NAME("first"), description: "Before the OAG review.", stage: "FIRST_DOCUMENTATION", tracks: ["FULL"] });
    expect(first.status).toBe(201);
    expect((await first.json()).documentRequirement).toMatchObject({ stage: "FIRST_DOCUMENTATION", tracks: ["FULL"], description: "Before the OAG review." });
  });

  it("POST: 401 without a user and 403 for every other role, writing nothing", async () => {
    const before = await fixtureRows();
    const body = { name: NAME("refused"), stage: "SECOND_ROUND", tracks: ["FULL"] };
    expect((await post(null, body)).status).toBe(401);
    for (const role of ROLES.filter((r) => r !== "ADMIN" && r !== "COMPLIANCE_MANAGER")) {
      expect((await post(userIds[role], body)).status, role).toBe(403);
    }
    expect(await fixtureRows()).toEqual(before);
    expect(await prisma.documentRequirement.count({ where: { name: NAME("refused") } })).toBe(0);
  });

  it("POST: first documentation that includes Self is refused (400), alone or with Full, and nothing is written", async () => {
    const before = await fixtureRows();
    for (const tracks of [["SELF"], ["SELF", "FULL"], ["FULL", "SELF"]]) {
      const response = await post(userIds.COMPLIANCE_MANAGER, { name: NAME("first self"), stage: "FIRST_DOCUMENTATION", tracks });
      expect(response.status, tracks.join()).toBe(400);
      expect((await response.json()).error).toMatch(/Full-track stage/);
    }
    expect(await fixtureRows()).toEqual(before);
    expect(await prisma.documentRequirement.count({ where: { name: NAME("first self") } })).toBe(0);
  });

  it("POST: refuses a bad body (400) and a duplicate name (409), changing nothing", async () => {
    const existing = await prisma.documentRequirement.create({ data: { name: NAME("dup"), stage: "SECOND_ROUND", tracks: ["SELF"] } });
    const before = await fixtureRows();
    const ok = { name: NAME("bad"), stage: "SECOND_ROUND", tracks: ["FULL"] };
    const bad: [string, unknown][] = [
      ["not JSON", "nope"],
      ["no name", { stage: "SECOND_ROUND", tracks: ["FULL"] }],
      ["blank name", { ...ok, name: "   " }],
      ["long name", { ...ok, name: "x".repeat(81) }],
      ["long description", { ...ok, description: "x".repeat(301) }],
      ["no stage", { name: ok.name, tracks: ["FULL"] }],
      ["unknown stage", { ...ok, stage: "THIRD_ROUND" }],
      ["no tracks", { name: ok.name, stage: "SECOND_ROUND" }],
      ["empty tracks", { ...ok, tracks: [] }],
      ["unknown track", { ...ok, tracks: ["FAST"] }],
      ["tracks as text", { ...ok, tracks: "FULL" }],
    ];
    for (const [label, body] of bad) expect((await post(userIds.COMPLIANCE_MANAGER, body)).status, label).toBe(400);
    const duplicate = await post(userIds.ADMIN, { name: NAME("dup"), stage: "SECOND_ROUND", tracks: ["FULL"] });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/already exists/);
    expect(await fixtureRows()).toEqual(before);
    expect((await prisma.documentRequirement.findUniqueOrThrow({ where: { id: existing.id } })).tracks).toEqual(["SELF"]);
  });
});

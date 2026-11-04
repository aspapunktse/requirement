import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";

/**
 * /api/information-types (#303), against real Postgres. Every fixture is a `Test …` Information Type created here and
 * removed in `afterAll`; CI's database is migrated but not seeded, so nothing relies on seeded types. Refused writes
 * assert the fixture rows are exactly as they were.
 */
const URL = "http://localhost/api/information-types";
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test IT ${label} ${suffix}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "INTERNAL_AUDITOR"];

describe("/api/information-types", () => {
  const userIds = {} as Record<UserRole, string>;

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (await prisma.user.create({ data: { email: `test-it-${role.toLowerCase()}-${suffix}@example.com`, name: `Test IT ${role}`, role } })).id;
    }
  });

  afterAll(async () => {
    await prisma.informationType.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  function requestAs(userId: string | null, init?: { method?: string; body?: string }) {
    const headers = new Headers();
    if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
    return new NextRequest(URL, { ...init, headers });
  }
  const post = (userId: string | null, body: unknown) =>
    POST(requestAs(userId, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
  const fixtureRows = () => prisma.informationType.findMany({ where: { name: { contains: suffix } }, orderBy: { name: "asc" } });

  it("GET: 401 without a user, and every signed-in role reads the catalogue with its counts", async () => {
    const type = await prisma.informationType.create({ data: { name: NAME("list"), description: "Listed.", sensitivityLevel: 4 } });
    expect((await GET(requestAs(null))).status).toBe(401);
    for (const role of ROLES) {
      const response = await GET(requestAs(userIds[role]));
      expect(response.status, role).toBe(200);
      const { informationTypes } = await response.json();
      expect(informationTypes.find((row: { id: string }) => row.id === type.id)).toEqual({
        id: type.id,
        name: NAME("list"),
        description: "Listed.",
        sensitivityLevel: 4,
        systemCount: 0,
        suggestedFrameworks: [],
      });
    }
  });

  it("GET: highest level first, then by name", async () => {
    await prisma.informationType.createMany({
      data: [
        { name: NAME("order b"), sensitivityLevel: 5 },
        { name: NAME("order a"), sensitivityLevel: 5 },
        { name: NAME("order c"), sensitivityLevel: 1 },
      ],
    });
    const { informationTypes } = await (await GET(requestAs(userIds.VIEWER))).json();
    const names = informationTypes.map((row: { name: string }) => row.name).filter((name: string) => name.startsWith(`Test IT order`));
    expect(names).toEqual([NAME("order a"), NAME("order b"), NAME("order c")]);
    const levels: number[] = informationTypes.map((row: { sensitivityLevel: number }) => row.sensitivityLevel);
    expect(levels).toEqual([...levels].sort((a, b) => b - a));
  });

  it("POST: the Compliance Manager and an Admin create a type; the name and description are trimmed, an empty description is none", async () => {
    for (const [role, label] of [["COMPLIANCE_MANAGER", "by manager"], ["ADMIN", "by admin"]] as const) {
      const response = await post(userIds[role], { name: `  ${NAME(label)}  `, description: "   ", sensitivityLevel: 3 });
      expect(response.status, role).toBe(201);
      const { informationType } = await response.json();
      expect(informationType).toMatchObject({ name: NAME(label), description: null, sensitivityLevel: 3, systemCount: 0 });
      expect(await prisma.informationType.findUnique({ where: { id: informationType.id } })).toMatchObject({ name: NAME(label), description: null });
    }
  });

  it("POST: 401 without a user and 403 for every other role, writing nothing", async () => {
    const before = await fixtureRows();
    const body = { name: NAME("refused"), sensitivityLevel: 2 };
    expect((await post(null, body)).status).toBe(401);
    for (const role of ROLES.filter((r) => r !== "ADMIN" && r !== "COMPLIANCE_MANAGER")) {
      expect((await post(userIds[role], body)).status, role).toBe(403);
    }
    expect(await fixtureRows()).toEqual(before);
    expect(await prisma.informationType.count({ where: { name: NAME("refused") } })).toBe(0);
  });

  it("POST: refuses a bad body (400) and a duplicate name (409), changing nothing", async () => {
    const existing = await prisma.informationType.create({ data: { name: NAME("dup"), sensitivityLevel: 2 } });
    const before = await fixtureRows();
    const bad: [string, unknown][] = [
      ["not JSON", "nope"],
      ["no name", { sensitivityLevel: 2 }],
      ["blank name", { name: "   ", sensitivityLevel: 2 }],
      ["long name", { name: "x".repeat(81), sensitivityLevel: 2 }],
      ["long description", { name: NAME("bad"), description: "x".repeat(301), sensitivityLevel: 2 }],
      ["no level", { name: NAME("bad") }],
      ["level 0", { name: NAME("bad"), sensitivityLevel: 0 }],
      ["level 6", { name: NAME("bad"), sensitivityLevel: 6 }],
      ["level as text", { name: NAME("bad"), sensitivityLevel: "3" }],
      ["fractional level", { name: NAME("bad"), sensitivityLevel: 2.5 }],
    ];
    for (const [label, body] of bad) expect((await post(userIds.COMPLIANCE_MANAGER, body)).status, label).toBe(400);
    const duplicate = await post(userIds.ADMIN, { name: NAME("dup"), sensitivityLevel: 5 });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/already exists/);
    expect(await fixtureRows()).toEqual(before);
    expect((await prisma.informationType.findUniqueOrThrow({ where: { id: existing.id } })).sensitivityLevel).toBe(2);
  });
});

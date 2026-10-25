import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { GET } from "../route";

/** Who may list the possible new owners of a System, and who is on the list (#233). */

const suffix = `${process.pid}-${Date.now()}`;
const ROLES: Record<string, UserRole> = {
  admin: "ADMIN",
  owner: "SYSTEM_OWNER",
  ownerOfNothing: "SYSTEM_OWNER",
  riskOwner: "RISK_OWNER",
  reviewer: "REVIEWER",
  viewer: "VIEWER",
  viewerOwner: "VIEWER",
  complianceManagerOwner: "COMPLIANCE_MANAGER",
  internalAuditor: "INTERNAL_AUDITOR",
};
const users: Record<string, string> = {};
const systemIds: string[] = [];

beforeAll(async () => {
  for (const [key, role] of Object.entries(ROLES)) {
    users[key] = (await prisma.user.create({ data: { email: `test-cand-${key}-${suffix}@example.com`, name: `Test Cand ${key}`, role } })).id;
  }
  for (const key of ["owner", "viewerOwner", "complianceManagerOwner"]) {
    systemIds.push((await prisma.system.create({ data: { name: `Test Cand System ${key} ${suffix}`, ownerId: users[key], status: "ONBOARDED" } })).id);
  }
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const list = (userId: string | null) => GET(requestAs("/api/systems/owner-candidates", userId, "GET"));

describe("GET /api/systems/owner-candidates (#233)", { timeout: 30_000 }, () => {
  it("lists the users with a System-creating role, and only them, for an Admin", async () => {
    const response = await list(users.admin);
    expect(response.status).toBe(200);
    const body: { users: { id: string; name: string; email: string; role: UserRole }[] } = await response.json();
    const ours = body.users.filter((user) => Object.values(users).includes(user.id));
    expect(ours.map((user) => user.id).sort()).toEqual([users.admin, users.owner, users.ownerOfNothing, users.riskOwner].sort());
    expect(Object.keys(ours[0]).sort()).toEqual(["email", "id", "name", "role"]);
    expect(body.users.every((user) => ["ADMIN", "SYSTEM_OWNER", "RISK_OWNER"].includes(user.role))).toBe(true);
  });

  it("lets the owner of a System list them, even one whose role could not create a System", async () => {
    expect((await list(users.owner)).status).toBe(200);
    expect((await list(users.viewerOwner)).status).toBe(200);
  });

  it.each(["ownerOfNothing", "riskOwner", "reviewer", "viewer", "internalAuditor", "complianceManagerOwner"] as const)(
    "refuses %s with 403",
    async (key) => {
      const response = await list(users[key]);
      expect(response.status).toBe(403);
      expect(await response.json()).not.toHaveProperty("users");
    },
  );

  it("answers 401 when nobody is signed in", async () => {
    expect((await list(null)).status).toBe(401);
  });
});

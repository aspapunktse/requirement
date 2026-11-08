import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { GET } from "../route";

/** Who may list the possible Business System Owners, and who is on the list (#321). */

const suffix = `${process.pid}-${Date.now()}`;
const ROLES: Record<string, UserRole> = {
  admin: "ADMIN",
  systemOwner: "SYSTEM_OWNER",
  riskOwner: "RISK_OWNER",
  reviewer: "REVIEWER",
  viewer: "VIEWER",
  viewerOwner: "VIEWER",
  complianceManager: "COMPLIANCE_MANAGER",
  complianceManagerOwner: "COMPLIANCE_MANAGER",
  internalAuditor: "INTERNAL_AUDITOR",
  businessRiskOwner: "BUSINESS_RISK_OWNER",
};
const users: Record<string, string> = {};
const systemIds: string[] = [];

beforeAll(async () => {
  for (const [key, role] of Object.entries(ROLES)) {
    users[key] = (await prisma.user.create({ data: { email: `test-bsocand-${key}-${suffix}@example.com`, name: `Test BsoCand ${key}`, role } })).id;
  }
  for (const key of ["viewerOwner", "complianceManagerOwner"]) {
    systemIds.push((await prisma.system.create({ data: { name: `Test BsoCand System ${key} ${suffix}`, ownerId: users[key], status: "ONBOARDED" } })).id);
  }
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const list = (userId: string | null) => GET(requestAs("/api/systems/bso-candidates", userId, "GET"));

describe("GET /api/systems/bso-candidates (#321)", { timeout: 30_000 }, () => {
  it("lists every user, whatever the role, with id, name, email and role", async () => {
    const response = await list(users.admin);
    expect(response.status).toBe(200);
    const body: { users: { id: string; name: string; email: string; role: UserRole }[] } = await response.json();
    const ours = body.users.filter((user) => Object.values(users).includes(user.id));
    expect(ours.map((user) => user.id).sort()).toEqual(Object.values(users).sort());
    expect(Object.keys(ours[0]).sort()).toEqual(["email", "id", "name", "role"]);
  });

  it.each(["systemOwner", "riskOwner"] as const)("is open to a %s, a role that may create a System", async (key) => {
    expect((await list(users[key])).status).toBe(200);
  });

  it("is open to the owner of a System who isn't a read-only role, even as a Viewer", async () => {
    expect((await list(users.viewerOwner)).status).toBe(200);
  });

  it.each(["reviewer", "viewer", "complianceManager", "complianceManagerOwner", "internalAuditor", "businessRiskOwner"] as const)(
    "refuses a %s with 403",
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

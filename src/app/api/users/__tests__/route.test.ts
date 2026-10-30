import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET } from "../route";

const URL = "http://localhost/api/users";

function requestAs(userId: string | null, query = "") {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`${URL}${query}`, { headers });
}

describe("GET /api/users", () => {
  const email = "test-users-route@example.com";
  const adminEmail = "test-users-route-admin@example.com";
  const businessRiskOwnerEmail = "test-users-route-bro@example.com";
  const complianceManagerEmail = "test-users-route-cm@example.com";
  const refusedRoles = ["VIEWER", "REVIEWER", "RISK_OWNER", "SYSTEM_OWNER", "BUSINESS_RISK_OWNER", "INTERNAL_AUDITOR"] as const;
  const refusedEmail = (role: string) => `test-users-route-${role.toLowerCase().replace(/_/g, "-")}@example.com`;
  let adminId: string;
  let complianceManagerId: string;
  const refusedIds: Record<string, string> = {};

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: "Route Test User", role: "VIEWER" },
    });
    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: { email: adminEmail, name: "Route Test Admin", role: "ADMIN" },
    });
    adminId = admin.id;
    await prisma.user.upsert({
      where: { email: businessRiskOwnerEmail },
      update: {},
      create: { email: businessRiskOwnerEmail, name: "Route Test BRO", role: "BUSINESS_RISK_OWNER" },
    });
    const complianceManager = await prisma.user.upsert({
      where: { email: complianceManagerEmail },
      update: {},
      create: { email: complianceManagerEmail, name: "Route Test Compliance Manager", role: "COMPLIANCE_MANAGER" },
    });
    complianceManagerId = complianceManager.id;
    for (const role of refusedRoles) {
      const user = await prisma.user.upsert({
        where: { email: refusedEmail(role) },
        update: {},
        create: { email: refusedEmail(role), name: `Route Test ${role}`, role },
      });
      refusedIds[role] = user.id;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        email: {
          in: [email, adminEmail, businessRiskOwnerEmail, complianceManagerEmail, ...refusedRoles.map(refusedEmail)],
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled (404) outside development for an unauthenticated caller", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(requestAs(null));
    expect(response.status).toBe(404);
  });

  it("lists users with id, name, email, and role for an unauthenticated (dev-stub) caller", async () => {
    const response = await GET(requestAs(null));
    const body = await response.json();

    expect(Array.isArray(body.users)).toBe(true);
    const user = body.users.find((u: { email: string }) => u.email === email);
    expect(user).toMatchObject({ name: "Route Test User", email, role: "VIEWER" });
    expect(typeof user.id).toBe("string");
  });

  it("lists users for an authenticated ADMIN regardless of NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(requestAs(adminId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users.some((u: { email: string }) => u.email === email)).toBe(true);
  });

  it("filters by role for an authenticated ADMIN", async () => {
    const response = await GET(requestAs(adminId, "?role=BUSINESS_RISK_OWNER"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users.every((u: { role: string }) => u.role === "BUSINESS_RISK_OWNER")).toBe(true);
    expect(body.users.some((u: { email: string }) => u.email === businessRiskOwnerEmail)).toBe(true);
  });

  // A Compliance Manager populates the Control Owner picker in the Control Library (#119).
  it("lists the same users, in the same shape, for an authenticated COMPLIANCE_MANAGER regardless of NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const asCm = await (await GET(requestAs(complianceManagerId))).json();
    const asAdmin = await (await GET(requestAs(adminId))).json();

    // GET lists every User in the table, so other test files creating or deleting Users
    // concurrently must not matter: compare only this file's own fixture Users.
    const fixtureEmails = [
      email,
      adminEmail,
      businessRiskOwnerEmail,
      complianceManagerEmail,
      ...refusedRoles.map(refusedEmail),
    ];
    type ListedUser = { email: string };
    const ours = (users: ListedUser[]) =>
      users.filter((u) => fixtureEmails.includes(u.email)).sort((a, b) => a.email.localeCompare(b.email));
    const cmUsers = ours(asCm.users);
    const adminUsers = ours(asAdmin.users);

    expect(cmUsers.map((u) => u.email)).toEqual([...fixtureEmails].sort((a, b) => a.localeCompare(b)));
    expect(cmUsers).toEqual(adminUsers);
    for (const user of [...asCm.users, ...asAdmin.users]) {
      expect(Object.keys(user).sort()).toEqual(["email", "id", "name", "role"]);
    }
  });

  it("filters by role for an authenticated COMPLIANCE_MANAGER", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(requestAs(complianceManagerId, "?role=BUSINESS_RISK_OWNER"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.users.every((u: { role: string }) => u.role === "BUSINESS_RISK_OWNER")).toBe(true);
    expect(body.users.some((u: { email: string }) => u.email === businessRiskOwnerEmail)).toBe(true);
  });

  it.each(refusedRoles)("still refuses (404) an authenticated %s once the dev stub is off", async (role) => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(requestAs(refusedIds[role]));
    expect(response.status).toBe(404);
    expect(await response.json()).not.toHaveProperty("users");
  });
});

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
  let adminId: string;

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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [email, adminEmail, businessRiskOwnerEmail] } } });
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
});

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { GET } from "../route";

describe("GET /api/users", () => {
  const email = "test-users-route@example.com";

  beforeAll(async () => {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: "Route Test User", role: "VIEWER" },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { email } }).catch(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is disabled (404) outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET();
    expect(response.status).toBe(404);
  });

  it("lists users with id, name, email, and role", async () => {
    const response = await GET();
    const body = await response.json();

    expect(Array.isArray(body.users)).toBe(true);
    const user = body.users.find((u: { email: string }) => u.email === email);
    expect(user).toMatchObject({ name: "Route Test User", email, role: "VIEWER" });
    expect(typeof user.id).toBe("string");
  });
});

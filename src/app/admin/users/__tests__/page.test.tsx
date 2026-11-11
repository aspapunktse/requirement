import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import UsersPage from "../page";

// /admin/users (#364): Admins only. Read-only here.
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "VIEWER"];

describe("the Users page", () => {
  const users: Record<string, string> = {};

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-364-page-${role}-${SUFFIX}@example.com`, name: `Test 364 Page ${role}`, role } })).id;
    }
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  const render = async (userId: string | null) => {
    acting.userId = userId;
    return renderToStaticMarkup(await UsersPage());
  };

  it("shows an Admin the User list with the Users and their roles", async () => {
    const html = await render(users.ADMIN);
    expect(html).toContain("Admin / Users");
    expect(html).toContain("New user");
    expect(html).toContain(`Test 364 Page SYSTEM_OWNER`);
    expect(html).toContain(`test-364-page-VIEWER-${SUFFIX}@example.com`);
  });

  it("refuses everyone else, and asks for a user when there is none", async () => {
    for (const role of ["COMPLIANCE_MANAGER", "SYSTEM_OWNER", "VIEWER"]) {
      const html = await render(users[role]);
      expect(html).toContain("Only Admins can manage Users.");
      expect(html).not.toContain("New user");
    }
    expect(await render(null)).toContain("Pick a user to act as first.");
  });
});

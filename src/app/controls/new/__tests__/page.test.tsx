import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// The client form reads the router; a static render has none.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});

import NewControlPage from "../page";

// The New Control page (#412), rendered per role.
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];
const CURATORS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

describe("the New Control page", { timeout: 30_000 }, () => {
  const users: Record<string, string> = {};

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-412-${role}-${SUFFIX}@example.com`, name: `Test 412 ${role}`, role } })).id;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${SUFFIX}@example.com` } } });
  });

  async function html(role: UserRole | null) {
    acting.userId = role ? users[role] : null;
    return renderToStaticMarkup(await NewControlPage());
  }

  it.each(CURATORS)("shows the create form to the %s", async (role) => {
    const markup = await html(role);
    expect(markup).toContain("New Control");
    expect(markup).toContain('aria-label="Code"');
    expect(markup).toContain("Create Control");
  });

  it.each(ROLES.filter((role) => !CURATORS.includes(role)))("refuses the %s and links back to the Control Library", async (role) => {
    const markup = await html(role);
    expect(markup).toContain("Only Compliance Managers and Admins can create Controls.");
    expect(markup).toContain('href="/controls"');
    expect(markup).not.toContain("Create Control");
    expect(markup).not.toContain('aria-label="Code"');
  });

  it("asks for a user when none is acting", async () => {
    expect(await html(null)).toContain("Pick a user to act as first.");
  });
});

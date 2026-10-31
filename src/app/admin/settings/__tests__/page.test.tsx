import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});

import SettingsPage from "../page";

// /admin/settings (#240): Admins only. Read-only here, so no setting is written.
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];

describe("the Settings page", () => {
  const users: Record<string, string> = {};

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-240-${role}-${SUFFIX}@example.com`, name: `Test 240 ${role}`, role } })).id;
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  const render = async (userId: string | null) => {
    acting.userId = userId;
    return renderToStaticMarkup(await SettingsPage());
  };

  it("shows an Admin the Systems list section with both settings at their defaults", async () => {
    const html = await render(users.ADMIN);
    expect(html).toContain("Settings");
    expect(html).toContain("Systems list");
    expect(html).toContain("Stale Draft after");
    expect(html).toContain("Under N% met");
  });

  it("shows an Admin the Organization section with a text input for the name", async () => {
    const html = await render(users.ADMIN);
    expect(html).toContain("Organization");
    expect(html).toMatch(/<input[^>]*id="setting-organization\.name"[^>]*type="text"|<input[^>]*type="text"[^>]*id="setting-organization\.name"/);
    expect(html).toContain("Organization name");
  });

  it.each(ROLES.filter((role) => role !== "ADMIN"))("refuses a %s", async (role) => {
    const html = await render(users[role]);
    expect(html).toContain("Only Admins can change settings.");
    expect(html).not.toContain("Stale Draft after");
  });

  it("asks for a user first when nobody is acting", async () => {
    const html = await render(null);
    expect(html).toContain("Pick a user to act as first.");
    expect(html).not.toContain("Stale Draft after");
  });
});

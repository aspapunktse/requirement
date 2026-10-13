import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});

import ControlLibraryReadPage from "../page";
import AdminControlsPage from "../../admin/controls/page";

// The read-only Control Library page (#169), rendered per role.
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "SYSTEM_OWNER",
  "RISK_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
  "INTERNAL_AUDITOR",
];
const CURATORS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

// Each render reads the whole seeded Control Library on a dev database, so allow for a loaded machine.
describe("the Control Library page", { timeout: 30_000 }, () => {
  const users: Record<string, string> = {};
  let controlId = "";
  let draftId = "";
  let draftName = "";

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-169-${role}-${SUFFIX}@example.com`, name: `Test 169 ${role}`, role } })).id;
    }
    const draft = await prisma.framework.create({ data: { name: `Test 169 Page Draft ${SUFFIX}`, version: "3", status: "DRAFT" } });
    draftId = draft.id;
    draftName = draft.name;
    const published = await createFixtureFramework("169 page");
    controlId = (
      await prisma.control.create({
        data: { code: `TEST-169-PAGE-${SUFFIX}`, title: `Test 169 page Control ${SUFFIX}`, description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
      })
    ).id;
    await mapControlsToFramework(published.id, [controlId]);
    await mapControlsToFramework(draftId, [controlId]);
  });

  afterAll(async () => {
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.requirement.deleteMany({ where: { frameworkId: draftId } });
    await prisma.framework.deleteMany({ where: { id: draftId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${SUFFIX}@example.com` } } });
  });

  async function html(page: () => Promise<React.ReactNode>, role: UserRole) {
    acting.userId = users[role];
    return renderToStaticMarkup(await page());
  }

  it.each(ROLES)("renders the Control to the %s", async (role) => {
    const markup = await html(ControlLibraryReadPage, role);
    expect(markup).toContain(`Test 169 page Control ${SUFFIX}`);
  });

  it.each(ROLES)("links the editor for the %s only if it can author Controls", async (role) => {
    const markup = await html(ControlLibraryReadPage, role);
    expect(markup.includes('href="/admin/controls"')).toBe(CURATORS.includes(role));
  });

  it.each(ROLES.filter((role) => !CURATORS.includes(role)))("leaks no Draft Framework name in the %s's HTML", async (role) => {
    const markup = await html(ControlLibraryReadPage, role);
    expect(markup).not.toContain(draftName);
    expect(markup).not.toContain(draftId);
  });

  it.each(CURATORS)("shows the %s the Draft mapping, marked", async (role) => {
    const markup = await html(ControlLibraryReadPage, role);
    expect(markup).toContain(draftName);
    expect(markup).toContain("Draft Framework");
  });

  it("points a role that cannot author Controls from the editor to the read-only page", async () => {
    const markup = await html(AdminControlsPage, "VIEWER");
    expect(markup).toContain('href="/controls"');
  });
});

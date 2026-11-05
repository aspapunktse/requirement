import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});

import ControlDetailPage from "../page";
import EditControlPage from "../edit/page";

// The Control page and its editor (#314), rendered per role.
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];
const CURATORS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];
const CODE = `TEST-314-PAGE-${SUFFIX}`;

describe("the Control page and its editor (#314)", { timeout: 30_000 }, () => {
  const users: Record<string, string> = {};
  let controlId = "";
  let draftId = "";
  let draftName = "";

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-314-page-${role}-${SUFFIX}@example.com`, name: `Test 314 page ${role}`, role } })).id;
    }
    const draft = await prisma.framework.create({ data: { name: `Test 314 Page Draft ${SUFFIX}`, version: "3", status: "DRAFT" } });
    draftId = draft.id;
    draftName = draft.name;
    const published = await createFixtureFramework("314 page");
    controlId = (
      await prisma.control.create({
        data: { code: CODE, title: `Test 314 page Control ${SUFFIX}`, description: "d", category: "Test 314", applicability: "ORGANIZATIONAL", originFrameworkId: draftId },
      })
    ).id;
    await mapControlsToFramework(published.id, [controlId]);
    await mapControlsToFramework(draftId, [controlId]);
  });

  afterAll(async () => {
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: controlId } });
    await prisma.requirement.deleteMany({ where: { frameworkId: draftId } });
    await prisma.framework.deleteMany({ where: { id: draftId } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${SUFFIX}@example.com` } } });
  });

  const detail = (code: string, tab?: string) => ControlDetailPage({ params: Promise.resolve({ code: encodeURIComponent(code) }), searchParams: Promise.resolve({ tab }) } as never);
  const edit = (code: string) => EditControlPage({ params: Promise.resolve({ code: encodeURIComponent(code) }), searchParams: Promise.resolve({}) } as never);

  it.each(ROLES)("renders the Control to the %s, with Edit for curators only and no Draft Framework name for the rest", async (role) => {
    acting.userId = users[role];
    const element = await detail(CODE);
    const markup = renderToStaticMarkup(element);
    expect(markup).toContain(`Test 314 page Control ${SUFFIX}`);
    expect(markup.includes(`href="/controls/${CODE}/edit`)).toBe(CURATORS.includes(role));
    if (!CURATORS.includes(role)) {
      expect(markup).not.toContain(draftName);
      expect(JSON.stringify((element as { props: unknown }).props)).not.toContain(draftId);
      expect(markup).toContain("Supplementary");
    }
  });

  it("is a 404 for a code no Control has, and asks for a user when nobody is acting", async () => {
    acting.userId = users.VIEWER;
    await expect(detail(`NO-SUCH-${SUFFIX}`)).rejects.toThrow("NEXT_NOT_FOUND");
    acting.userId = null;
    expect(renderToStaticMarkup((await detail(CODE)) as never)).toContain("Pick a user");
  });

  it.each(CURATORS)("opens the editor for the %s", async (role) => {
    acting.userId = users[role];
    const markup = renderToStaticMarkup(await edit(CODE));
    expect(markup).toContain(`Edit Test 314 page Control ${SUFFIX}`);
    expect(markup).toContain(draftName);
  });

  it.each(ROLES.filter((role) => !CURATORS.includes(role)))("refuses the editor to the %s and reads nothing of the Control", async (role) => {
    acting.userId = users[role];
    const markup = renderToStaticMarkup(await edit(CODE));
    expect(markup).toContain("Only Compliance Managers and Admins can edit Controls.");
    expect(markup).not.toContain(`Test 314 page Control ${SUFFIX}`);
    expect(markup).not.toContain(draftName);
  });

  it("makes the editor a 404 for a curator and an unknown code", async () => {
    acting.userId = users.ADMIN;
    await expect(edit(`NO-SUCH-${SUFFIX}`)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

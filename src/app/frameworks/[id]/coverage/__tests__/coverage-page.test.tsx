import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const acting = vi.hoisted(() => ({ user: null as { id: string; role: UserRole } | null }));
vi.mock("@/lib/acting-user", () => ({ getActingUser: async () => acting.user }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));

import FrameworkCoveragePage from "../page";
import { FrameworkCoverage } from "../FrameworkCoverage";

/**
 * The page itself (#269): who gets the ledger and who gets "not found". A Draft Framework is invisible to every
 * role but Compliance Manager and Admin; no acting user gets the prompt to pick one. Real Postgres, own fixtures.
 */
const suffix = `${process.pid}-${Date.now()}`;
const users: Record<string, { id: string; role: UserRole }> = {};
let publishedId: string;
let draftId: string;

const render = (id: string, section?: string) =>
  FrameworkCoveragePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(section ? { section } : {}) } as never);
/** The element's text, for the plain-message cases. */
const textOf = (element: Awaited<ReturnType<typeof render>>) => (element as { props: { children: string } }).props.children;

beforeAll(async () => {
  for (const [key, role] of [["cm", "COMPLIANCE_MANAGER"], ["admin", "ADMIN"], ["viewer", "VIEWER"], ["owner", "SYSTEM_OWNER"]] as const) {
    const row = await prisma.user.create({ data: { email: `test-269-page-${key}-${suffix}@example.com`, name: `Test 269 ${key}`, role } });
    users[key] = { id: row.id, role };
  }
  publishedId = (await prisma.framework.create({ data: { name: `Test 269 Page Published ${suffix}`, version: "1", status: "PUBLISHED" } })).id;
  draftId = (await prisma.framework.create({ data: { name: `Test 269 Page Draft ${suffix}`, version: "1", status: "DRAFT" } })).id;
  for (const frameworkId of [publishedId, draftId]) {
    await prisma.requirement.create({ data: { frameworkId, code: "P-1", section: "Test 269 S", title: "Test 269 P-1", text: "t" } });
  }
});

afterAll(async () => {
  await prisma.requirement.deleteMany({ where: { frameworkId: { in: [publishedId, draftId] } } });
  await prisma.framework.deleteMany({ where: { id: { in: [publishedId, draftId] } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
});

beforeEach(() => {
  acting.user = null;
});

describe("the Framework coverage page", () => {
  it("asks for an acting user first", async () => {
    expect(textOf(await render(publishedId))).toBe("Pick a user to act as first.");
  });

  it("gives every role the ledger for a Published Framework", async () => {
    for (const key of ["cm", "admin", "viewer", "owner"]) {
      acting.user = users[key];
      const element = (await render(publishedId)) as { type: unknown; props: { view: { framework: { id: string }; requirements: unknown[] } } };
      expect(element.type).toBe(FrameworkCoverage);
      expect(element.props.view.framework.id).toBe(publishedId);
      expect(element.props.view.requirements).toHaveLength(1);
    }
  });

  it("shows a Draft to Compliance Managers and Admins", async () => {
    for (const key of ["cm", "admin"]) {
      acting.user = users[key];
      expect(((await render(draftId)) as { type: unknown }).type).toBe(FrameworkCoverage);
    }
  });

  it("answers 'not found' for a Draft to every other role, and for an unknown Framework to everyone", async () => {
    for (const key of ["viewer", "owner"]) {
      acting.user = users[key];
      expect(textOf(await render(draftId))).toBe("Framework not found.");
    }
    acting.user = users.cm;
    expect(textOf(await render("no-such-framework"))).toBe("Framework not found.");
  });

  it("hands ?section= to the ledger", async () => {
    acting.user = users.cm;
    const element = (await render(publishedId, "Test 269 S")) as { props: { view: { initialSection: string | null } } };
    expect(element.props.view.initialSection).toBe("Test 269 S");
  });
});

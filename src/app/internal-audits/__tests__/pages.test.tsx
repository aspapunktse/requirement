import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

import InternalAuditsPage from "../page";
import InternalAuditPage from "../[id]/page";
import NewInternalAuditPage from "../new/page";
import EditInternalAuditPage from "../[id]/edit/page";

/**
 * The Internal Audit pages (#152) as each role sees them: the list, the detail page and the
 * two form pages. Fixtures only; the pages are rendered to static markup like the Framework
 * lineage test does.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["INTERNAL_AUDITOR", "ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER", "SYSTEM_OWNER", "VIEWER"];
const TITLE = `Test 152 Page audit ${SUFFIX}`;

describe("Internal Audit pages (#152)", () => {
  const users: Record<string, string> = {};
  let auditId: string;
  let launchedId: string;
  let orgOnlyId: string;
  let controlId: string;
  let perSystemControlId: string;
  let systemId: string;

  const params = (id: string) => Promise.resolve({ id });
  async function html(role: string, render: () => Promise<React.ReactNode>) {
    acting.userId = users[role];
    return renderToStaticMarkup(await render());
  }

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (
        await prisma.user.create({ data: { email: `test-152-page-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 152 page ${role}`, role } })
      ).id;
    }
    controlId = (
      await prisma.control.create({
        data: { code: `TEST-152-PAGE-${SUFFIX}`, title: "Test 152 page Control", description: "d", category: "Security", applicability: "ORGANIZATIONAL" },
      })
    ).id;
    perSystemControlId = (
      await prisma.control.create({
        data: { code: `TEST-152-PAGE-PS-${SUFFIX}`, title: "Test 152 page Per-System Control", description: "d", category: "Security", applicability: "PER_SYSTEM" },
      })
    ).id;
    systemId = (await prisma.system.create({ data: { name: `Test 152 page System ${SUFFIX}`, ownerId: users.SYSTEM_OWNER } })).id;
    const dueDate = new Date("2030-05-06T00:00:00Z");
    // The Organization is included but the only target Control is Per-System, so the Organization note shows.
    auditId = (
      await prisma.internalAudit.create({
        data: {
          title: TITLE,
          scopeDescription: "Page scope",
          dueDate,
          includeOrganization: true,
          createdById: users.INTERNAL_AUDITOR,
          controls: { create: [{ controlId: perSystemControlId }] },
          systems: { create: [{ systemId }] },
        },
      })
    ).id;
    launchedId = (
      await prisma.internalAudit.create({
        data: { title: `${TITLE} launched`, dueDate, status: "LAUNCHED", createdById: users.INTERNAL_AUDITOR, controls: { create: [{ controlId }] } },
      })
    ).id;
    orgOnlyId = (
      await prisma.internalAudit.create({
        data: { title: `${TITLE} org`, dueDate, includeOrganization: true, createdById: users.INTERNAL_AUDITOR, controls: { create: [{ controlId }] } },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.internalAudit.deleteMany({ where: { createdById: { in: Object.values(users) } } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: { in: [controlId, perSystemControlId] } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  describe("the list", () => {
    it("shows title, due date and state, with a New Internal Audit action for an Internal Auditor", async () => {
      const markup = await html("INTERNAL_AUDITOR", InternalAuditsPage);
      expect(markup).toContain(TITLE);
      expect(markup).toContain("2030-05-06");
      expect(markup).toContain("Draft");
      expect(markup).toContain("Launched");
      expect(markup).toContain('href="/internal-audits/new"');
      expect(markup).toContain(`href="/internal-audits/${auditId}"`);
    });

    it.each(["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER"])("shows the %s the audits but no New Internal Audit action", async (role) => {
      const markup = await html(role, InternalAuditsPage);
      expect(markup).toContain(TITLE);
      expect(markup).not.toContain("New Internal Audit");
    });

    it.each(["SYSTEM_OWNER", "VIEWER"])("tells the %s it is not available to their role, showing no audit", async (role) => {
      const markup = await html(role, InternalAuditsPage);
      expect(markup).toContain("not available to your role");
      expect(markup).not.toContain(TITLE);
    });
  });

  describe("the detail page", () => {
    it("shows everything on the audit, with Edit and Delete for an Internal Auditor on a draft", async () => {
      const markup = await html("INTERNAL_AUDITOR", () => InternalAuditPage({ params: params(auditId) } as never));
      expect(markup).toContain(TITLE);
      expect(markup).toContain("Page scope");
      expect(markup).toContain("2030-05-06");
      expect(markup).toContain("Test 152 page Per-System Control");
      expect(markup).toContain(`Test 152 page System ${SUFFIX}`);
      expect(markup).toContain(`href="/internal-audits/${auditId}/edit"`);
      expect(markup).toContain("Delete draft");
      expect(markup).toContain("nothing has been sent");
    });

    it.each(["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER"])("shows the %s the audit without Edit or Delete", async (role) => {
      const markup = await html(role, () => InternalAuditPage({ params: params(auditId) } as never));
      expect(markup).toContain(TITLE);
      expect(markup).not.toContain("/edit");
      expect(markup).not.toContain("Delete draft");
    });

    it("offers no Edit or Delete on an audit that is no longer a draft, even to an Internal Auditor", async () => {
      const markup = await html("INTERNAL_AUDITOR", () => InternalAuditPage({ params: params(launchedId) } as never));
      expect(markup).toContain("Launched");
      expect(markup).not.toContain("/edit");
      expect(markup).not.toContain("Delete draft");
    });

    it("notes an included Organization with no Organizational or Both Control, and Systems with no Per-System or Both Control", async () => {
      const both = await html("ADMIN", () => InternalAuditPage({ params: params(auditId) } as never));
      expect(both).toContain("The Organization is included, but none of the target Controls");

      const orgOnly = await html("ADMIN", () => InternalAuditPage({ params: params(orgOnlyId) } as never));
      expect(orgOnly).not.toContain("none of the target Controls");
    });

    it.each(["SYSTEM_OWNER", "VIEWER"])("tells the %s it is not available to their role", async (role) => {
      const markup = await html(role, () => InternalAuditPage({ params: params(auditId) } as never));
      expect(markup).toContain("not available to your role");
      expect(markup).not.toContain(TITLE);
    });

    it("says so when the audit doesn't exist", async () => {
      const markup = await html("ADMIN", () => InternalAuditPage({ params: params("nope") } as never));
      expect(markup).toContain("Internal Audit not found");
    });
  });

  describe("the new and edit pages", () => {
    it("show the form to an Internal Auditor", async () => {
      expect(await html("INTERNAL_AUDITOR", NewInternalAuditPage)).toContain("Create draft");
      const edit = await html("INTERNAL_AUDITOR", () => EditInternalAuditPage({ params: params(auditId) } as never));
      expect(edit).toContain(TITLE);
      expect(edit).toContain("Save");
    });

    it.each(["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER", "VIEWER"])("show the %s no form", async (role) => {
      const created = await html(role, NewInternalAuditPage);
      expect(created).toContain("Only an Internal Auditor");
      expect(created).not.toContain("<form");
      const edited = await html(role, () => EditInternalAuditPage({ params: params(auditId) } as never));
      expect(edited).toContain("Only an Internal Auditor");
      expect(edited).not.toContain("<form");
    });

    it("refuse to edit a launched audit", async () => {
      const markup = await html("INTERNAL_AUDITOR", () => EditInternalAuditPage({ params: params(launchedId) } as never));
      expect(markup).toContain("only be edited or deleted while it is a draft");
      expect(markup).not.toContain("<form");
    });
  });
});

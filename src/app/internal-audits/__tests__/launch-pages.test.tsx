import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { launchInternalAudit } from "@/lib/check-ups";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

import InternalAuditPage from "../[id]/page";

/** The audit page of a draft and of a launched audit (#154), as static markup. Fixtures only. */
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["INTERNAL_AUDITOR", "ADMIN", "RISK_OWNER"];

describe("Internal Audit page: launch and Check-ups (#154)", () => {
  const users: Record<string, string> = {};
  let draftId: string;
  let launchedId: string;
  let controlOwnerId: string;
  let controlId: string;

  async function html(role: string, id: string) {
    acting.userId = users[role];
    return renderToStaticMarkup(await InternalAuditPage({ params: Promise.resolve({ id }) } as never));
  }

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-154-page-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 154 page ${role}`, role } })).id;
    }
    controlOwnerId = (await prisma.user.create({ data: { email: `test-154-page-owner-${SUFFIX}@example.com`, name: "Test 154 page owner", role: "VIEWER" } })).id;
    controlId = (
      await prisma.control.create({
        data: { code: `TEST-154-PAGE-${SUFFIX}`, title: "Test 154 page Control", description: "d", category: "Security", applicability: "BOTH", question: "Is the page Control in place?", ownerId: controlOwnerId },
      })
    ).id;
    const framework = await createFixtureFramework("154 page");
    await mapControlsToFramework(framework.id, [controlId]);
    const systemId = (await prisma.system.create({ data: { name: `Test 154 page System ${SUFFIX}`, ownerId: users.ADMIN, frameworkScopes: { connect: [{ id: framework.id }] } } })).id;
    const data = (title: string) => ({
      title,
      dueDate: new Date("2999-01-01T00:00:00Z"),
      includeOrganization: true,
      createdById: users.INTERNAL_AUDITOR,
      controls: { create: [{ controlId, questions: { create: [{ position: 1, text: "Is the page Control in place?" }] } }] },
      systems: { create: [{ systemId }] },
    });
    draftId = (await prisma.internalAudit.create({ data: data(`Test 154 page draft ${SUFFIX}`) })).id;
    launchedId = (await prisma.internalAudit.create({ data: data(`Test 154 page launched ${SUFFIX}`) })).id;
    await launchInternalAudit(launchedId, users.INTERNAL_AUDITOR);
    await prisma.control.update({ where: { id: controlId }, data: { ownerId: null } });
  });

  afterAll(async () => {
    const audits = await prisma.internalAudit.findMany({ where: { createdById: users.INTERNAL_AUDITOR }, select: { id: true } });
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: audits.map((a) => a.id) } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: audits.map((a) => a.id) } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-154-page-", endsWith: `${SUFFIX}@example.com` } } });
  });

  it("shows an Internal Auditor a draft's question editor, the launch preview and the Launch button", async () => {
    await prisma.control.update({ where: { id: controlId }, data: { ownerId: controlOwnerId } });
    const page = await html("INTERNAL_AUDITOR", draftId);
    expect(page).toContain("Launch preview");
    expect(page).toContain("Launching creates 2 Check-ups (1 System-level, 1 Organization-level)");
    expect(page).toContain("Save questions for TEST-154-PAGE");
    expect(page).toContain("Launch Internal Audit");
    expect(page).toContain("Edit");
  });

  it("names the Control that has no Control Owner and disables Launch", async () => {
    await prisma.control.update({ where: { id: controlId }, data: { ownerId: null } });
    const page = await html("INTERNAL_AUDITOR", draftId);
    expect(page).toContain("Launch is blocked");
    expect(page).toContain("No Control Owner for: TEST-154-PAGE");
    expect(page).toMatch(/<button[^>]*disabled=""[^>]*>Launch Internal Audit/);
  });

  it("shows a reading role the questions and the preview, with no editor and no Launch button", async () => {
    for (const role of ["ADMIN", "RISK_OWNER"]) {
      const page = await html(role, draftId);
      expect(page).toContain("Launch preview");
      expect(page).toContain("Is the page Control in place?");
      expect(page).not.toContain("Save questions");
      expect(page).not.toContain("Launch Internal Audit");
    }
  });

  it("lists a launched audit's Check-ups with the current recipient, and offers no edit, delete or launch", async () => {
    await prisma.control.update({ where: { id: controlId }, data: { ownerId: null } });
    for (const role of ROLES) {
      const page = await html(role, launchedId);
      expect(page).toContain("Check-ups (2 sent)");
      expect(page).toContain("Test 154 page System");
      expect(page).toContain("Organization");
      expect(page).toContain("Test 154 page ADMIN"); // the System's owner
      expect(page).toContain("No Control Owner"); // the Control's owner was cleared after launch
      expect(page).toContain("Is the page Control in place?");
      expect(page).not.toContain("Delete draft");
      expect(page).not.toContain("Launch Internal Audit");
      expect(page).not.toContain("Save questions");
      expect(page).not.toContain("/edit");
    }
  });
});

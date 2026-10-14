import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { launchInternalAudit } from "@/lib/check-ups";
import { evaluateCheckUp } from "@/lib/check-up-evaluations";
import { withdrawCheckUp } from "@/lib/check-up-withdrawals";
import { closeInternalAudit } from "@/lib/internal-audit-closing";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

import InternalAuditPage from "../[id]/page";
import InternalAuditsPage from "../page";
import CheckUpPage from "@/app/check-ups/[id]/page";

/** Withdrawing and closing on the audit list, the audit page and the Check-up page (#158), as static markup. Fixtures only. */
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["INTERNAL_AUDITOR", "ADMIN", "RISK_OWNER"];

describe("Withdrawing and closing: pages (#158)", () => {
  const users: Record<string, string> = {};
  let recipientId: string;
  let auditId: string;
  let title: string;
  const checkUpOf: Record<"A" | "B" | "C", string> = { A: "", B: "", C: "" };
  const codes: Record<"A" | "B" | "C", string> = { A: "", B: "", C: "" };

  const auditPage = async (role: string) => {
    acting.userId = users[role];
    return renderToStaticMarkup(await InternalAuditPage({ params: Promise.resolve({ id: auditId }) } as never));
  };
  const checkUpPage = async (userId: string, id: string) => {
    acting.userId = userId;
    return renderToStaticMarkup(await CheckUpPage({ params: Promise.resolve({ id }) } as never));
  };
  const auditor = () => ({ id: users.INTERNAL_AUDITOR, role: "INTERNAL_AUDITOR" as const });
  const answer = async (checkUpId: string) => {
    const questions = await prisma.checkUpQuestion.findMany({ where: { checkUpId } });
    await prisma.checkUpResponse.create({
      data: {
        checkUpId,
        respondedById: recipientId,
        lastChangedById: recipientId,
        evidenceLinks: [],
        answers: { create: questions.map((q) => ({ questionId: q.id, answer: "YES" as const, description: "" })) },
      },
    });
  };

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-158-page-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 158 page ${role}`, role } })).id;
    }
    recipientId = (await prisma.user.create({ data: { email: `test-158-page-recipient-${SUFFIX}@example.com`, name: "Test 158 page recipient", role: "SYSTEM_OWNER" } })).id;
    const controls = [];
    for (const label of ["A", "B", "C"] as const) {
      codes[label] = `TEST-158-PAGE-${label}-${SUFFIX}`;
      controls.push(
        await prisma.control.create({ data: { code: codes[label], title: `Test 158 page Control ${label}`, description: "d", category: "Security", applicability: "PER_SYSTEM" } }),
      );
    }
    const framework = await createFixtureFramework("158 page");
    await mapControlsToFramework(framework.id, controls.map((c) => c.id));
    const systemId = (await prisma.system.create({ data: { name: `Test 158 page System ${SUFFIX}`, ownerId: recipientId, frameworkScopes: { connect: [{ id: framework.id }] } } })).id;
    title = `Test 158 page audit ${SUFFIX}`;
    auditId = (
      await prisma.internalAudit.create({
        data: {
          title,
          dueDate: new Date("2999-01-01T00:00:00Z"),
          createdById: users.INTERNAL_AUDITOR,
          controls: { create: controls.map((c) => ({ controlId: c.id, questions: { create: [{ position: 1, text: "Is it in place?" }] } })) },
          systems: { create: [{ systemId }] },
        },
      })
    ).id;
    await launchInternalAudit(auditId, users.INTERNAL_AUDITOR);
    const checkUps = await prisma.checkUp.findMany({ where: { internalAuditId: auditId }, select: { id: true, controlId: true } });
    for (const [label, control] of [["A", controls[0]], ["B", controls[1]], ["C", controls[2]]] as const) {
      checkUpOf[label] = checkUps.find((c) => c.controlId === control.id)!.id;
    }
  });

  afterAll(async () => {
    const audits = await prisma.internalAudit.findMany({ where: { createdById: users.INTERNAL_AUDITOR }, select: { id: true } });
    await prisma.changeEvent.deleteMany({ where: { systemId: null, action: "CHECK_UP_EVALUATED", detail: { contains: SUFFIX } } });
    await prisma.risk.deleteMany({ where: { checkUp: { internalAuditId: { in: audits.map((a) => a.id) } } } });
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: audits.map((a) => a.id) } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: audits.map((a) => a.id) } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-158-page-", endsWith: `${SUFFIX}@example.com` } } });
  });

  // The tests run in order and share the audit: open, then partly withdrawn, then finished, then closed.

  it("offers an Internal Auditor a Withdraw action per open Check-up and a disabled Close naming what is open", async () => {
    const page = await auditPage("INTERNAL_AUDITOR");
    expect(page.match(/aria-label="Withdraw this Check-up"/g)).toHaveLength(3);
    expect(page).toContain("Close this Internal Audit");
    expect(page).toContain("Still open (3)");
    for (const label of ["A", "B", "C"] as const) expect(page).toContain(`${codes[label]} for System &quot;Test 158 page System ${SUFFIX}&quot;`);
    expect(page).toMatch(/<button[^>]*disabled=""[^>]*>Close Internal Audit/);
    expect(page).toContain("0 withdrawn");
  });

  it("shows a reading role what is open, but neither a Withdraw action nor a Close button", async () => {
    for (const role of ["ADMIN", "RISK_OWNER"]) {
      const page = await auditPage(role);
      expect(page).toContain("Still open (3)");
      expect(page).not.toContain("Withdraw this Check-up");
      expect(page).not.toContain("Close Internal Audit");
    }
  });

  it("shows a withdrawn Check-up with its reason, who and when, counts it as withdrawn and names the rest", async () => {
    await withdrawCheckUp(checkUpOf.A, auditor(), { reason: "The Control no longer applies here" });
    const page = await auditPage("INTERNAL_AUDITOR");
    expect(page).toContain("3 sent, 0 answered, 0 evaluated, 1 withdrawn, 0 overdue");
    expect(page).toContain("Withdrawn");
    expect(page).toContain("The Control no longer applies here");
    expect(page).toContain("Test 158 page INTERNAL_AUDITOR, ");
    expect(page.match(/aria-label="Withdraw this Check-up"/g)).toHaveLength(2);
    expect(page).toContain("Still open (2)");
    expect(page).not.toContain(`${codes.A} for System`);
    expect(page).toMatch(/<button[^>]*disabled=""[^>]*>Close Internal Audit/);
  });

  it("shows the withdrawn Check-up's page with the reason, who and when, and offers no answer form, evaluation or withdrawal", async () => {
    for (const userId of [users.INTERNAL_AUDITOR, users.ADMIN, recipientId]) {
      const page = await checkUpPage(userId, checkUpOf.A);
      expect(page).toContain("Withdrawn by Test 158 page INTERNAL_AUDITOR on ");
      expect(page).toContain("The Control no longer applies here");
      expect(page).toContain("This Check-up has been withdrawn");
      expect(page).not.toContain("Withdraw this Check-up");
      expect(page).not.toContain("Evaluate this Check-up");
      expect(page).not.toContain("Submit response");
      expect(page).not.toContain("Not evaluated yet");
    }
  });

  it("offers the Internal Auditor, and nobody else, a Withdraw action on an open Check-up's page", async () => {
    expect(await checkUpPage(users.INTERNAL_AUDITOR, checkUpOf.B)).toContain("Withdraw this Check-up");
    for (const userId of [users.ADMIN, users.RISK_OWNER, recipientId]) expect(await checkUpPage(userId, checkUpOf.B)).not.toContain("Withdraw this Check-up");
  });

  it("enables Close once every Check-up is evaluated or withdrawn", async () => {
    await answer(checkUpOf.B);
    await evaluateCheckUp(checkUpOf.B, auditor(), { outcome: "CONFORMING" });
    await withdrawCheckUp(checkUpOf.C, auditor(), { reason: "Duplicate of another Check-up" });
    const page = await auditPage("INTERNAL_AUDITOR");
    expect(page).toContain("3 sent, 1 answered, 1 evaluated, 2 withdrawn, 0 overdue");
    expect(page).toContain("Every Check-up is evaluated or withdrawn");
    expect(page).not.toContain("Still open");
    expect(page).toMatch(/<button[^>]*>Close Internal Audit/);
    expect(page).not.toMatch(/<button[^>]*disabled=""[^>]*>Close Internal Audit/);
    expect(page).not.toContain("Withdraw this Check-up");
  });

  it("shows a closed audit as closed, with who closed it, and offers no action at all", async () => {
    await closeInternalAudit(auditId, users.INTERNAL_AUDITOR);
    for (const role of ROLES) {
      const page = await auditPage(role);
      expect(page).toContain("Closed");
      expect(page).toMatch(/Closed \d{4}-\d{2}-\d{2} by Test 158 page INTERNAL_AUDITOR/);
      expect(page).toContain("read-only for everyone");
      expect(page).not.toContain("Close Internal Audit");
      expect(page).not.toContain("Close this Internal Audit");
      expect(page).not.toContain("Withdraw this Check-up");
      expect(page).not.toContain("Launch Internal Audit");
      expect(page).not.toContain("Delete draft");
      expect(page).not.toContain("/edit");
    }
  });

  it("offers no evaluation or withdrawal on a closed audit's Check-up page, and shows its state", async () => {
    const page = await checkUpPage(users.INTERNAL_AUDITOR, checkUpOf.B);
    expect(page).toContain("(closed)");
    expect(page).not.toContain("Withdraw this Check-up");
    expect(page).not.toContain("Evaluate this Check-up");
    expect(page).toContain("Evaluated by");
  });

  it("lists the audit as Closed on the audit list", async () => {
    acting.userId = users.ADMIN;
    const page = renderToStaticMarkup(await InternalAuditsPage());
    const row = page.slice(page.indexOf(title));
    expect(row.slice(0, row.indexOf("</tr>"))).toContain("Closed");
  });
});

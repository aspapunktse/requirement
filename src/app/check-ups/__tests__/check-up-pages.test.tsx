import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { launchInternalAudit } from "@/lib/check-ups";
import { evaluateCheckUp } from "@/lib/check-up-evaluations";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";

const acting = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/acting-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/acting-user")>();
  return { ...original, getActingUser: async () => (acting.userId ? prisma.user.findUnique({ where: { id: acting.userId } }) : null) };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));

import CheckUpPage from "../[id]/page";
import MyCheckUpsPage from "../page";
import InternalAuditPage from "@/app/internal-audits/[id]/page";

/** The Check-up page, "Your Check-ups" and the audit page's progress (#155), as static markup. Fixtures only. */
const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["INTERNAL_AUDITOR", "ADMIN", "VIEWER", "SYSTEM_OWNER"];

describe("Check-up pages (#155)", () => {
  const users: Record<string, string> = {};
  let recipientId: string;
  let auditId: string;
  let answeredId: string;
  let openId: string;

  async function render(userId: string, element: (id: string) => Promise<React.ReactElement>, id = "") {
    acting.userId = userId;
    return renderToStaticMarkup(await element(id));
  }
  const checkUpPage = (userId: string, id: string) => render(userId, (i) => CheckUpPage({ params: Promise.resolve({ id: i }) } as never), id);

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-155-page-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 155 page ${role}`, role } })).id;
    }
    recipientId = (await prisma.user.create({ data: { email: `test-155-page-recipient-${SUFFIX}@example.com`, name: "Test 155 page recipient", role: "SYSTEM_OWNER" } })).id;
    const cA = await prisma.control.create({ data: { code: `TEST-155-PAGE-A-${SUFFIX}`, title: "Test 155 page Control A", description: "d", category: "Security", applicability: "PER_SYSTEM" } });
    const cB = await prisma.control.create({ data: { code: `TEST-155-PAGE-B-${SUFFIX}`, title: "Test 155 page Control B", description: "d", category: "Security", applicability: "PER_SYSTEM" } });
    const framework = await createFixtureFramework("155 page");
    await mapControlsToFramework(framework.id, [cA.id, cB.id]);
    const systemId = (await prisma.system.create({ data: { name: `Test 155 page System ${SUFFIX}`, ownerId: recipientId, frameworkScopes: { connect: [{ id: framework.id }] } } })).id;
    const audit = await prisma.internalAudit.create({
      data: {
        title: `Test 155 page audit ${SUFFIX}`,
        dueDate: new Date("2999-01-01T00:00:00Z"),
        createdById: users.INTERNAL_AUDITOR,
        controls: {
          create: [cA, cB].map((c) => ({ controlId: c.id, questions: { create: [{ position: 1, text: "Is it in place?" }, { position: 2, text: "Is it tested?" }] } })),
        },
        systems: { create: [{ systemId }] },
      },
    });
    auditId = audit.id;
    await launchInternalAudit(auditId, users.INTERNAL_AUDITOR);
    const checkUps = await prisma.checkUp.findMany({ where: { internalAuditId: auditId }, include: { control: true, questions: { orderBy: { position: "asc" } } } });
    const answered = checkUps.find((c) => c.control.id === cA.id)!;
    answeredId = answered.id;
    openId = checkUps.find((c) => c.control.id === cB.id)!.id;
    await prisma.checkUpResponse.create({
      data: {
        checkUpId: answeredId,
        respondedById: recipientId,
        lastChangedById: recipientId,
        // A stored value that isn't http(s) must never become a link.
        evidenceLinks: ["https://example.com/policy.pdf", "javascript:alert(1)"],
        answers: {
          create: [
            { questionId: answered.questions[0].id, answer: "YES", description: "" },
            { questionId: answered.questions[1].id, answer: "NO", description: "Tested only in staging" },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    const audits = await prisma.internalAudit.findMany({ where: { createdById: users.INTERNAL_AUDITOR }, select: { id: true } });
    // The System-less Change Event of the evaluation test (#156) names this run through the audit title and Control code.
    await prisma.changeEvent.deleteMany({ where: { systemId: null, action: "CHECK_UP_EVALUATED", detail: { contains: SUFFIX } } });
    // A Nonconformity's Risk (#157) is Restrict on its Check-up.
    await prisma.risk.deleteMany({ where: { checkUp: { internalAuditId: { in: audits.map((a) => a.id) } } } });
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: audits.map((a) => a.id) } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: audits.map((a) => a.id) } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-155-page-", endsWith: `${SUFFIX}@example.com` } } });
  });

  it("gives the recipient the answer form for an open Check-up, without the audit", async () => {
    const html = await checkUpPage(recipientId, openId);
    expect(html).toContain("Submit response");
    expect(html).toContain("Is it tested?");
    expect(html).not.toContain(`/internal-audits/${auditId}`);
    expect(html).toContain("Your Check-ups");
  });

  it("gives the recipient the form filled in for an answered Check-up, to change it", async () => {
    const html = await checkUpPage(recipientId, answeredId);
    expect(html).toContain("Save changes");
    expect(html).toContain("Tested only in staging");
    expect(html).toContain("https://example.com/policy.pdf");
    expect(html).not.toContain("javascript:");
  });

  it("shows the reading roles the response read-only, with safe evidence links that open in a new tab", async () => {
    for (const role of ["ADMIN", "INTERNAL_AUDITOR"]) {
      const html = await checkUpPage(users[role], answeredId);
      expect(html).not.toContain("Save changes");
      expect(html).not.toContain("Submit response");
      expect(html).toContain("Tested only in staging");
      expect(html).toContain("No");
      expect(html).toMatch(/<a [^>]*href="https:\/\/example\.com\/policy\.pdf"[^>]*>/);
      expect(html).toMatch(/target="_blank"/);
      expect(html).toMatch(/rel="noopener noreferrer"/);
      expect(html).not.toContain("javascript:");
      expect(html).toContain(`/internal-audits/${auditId}`);
    }
  });

  it("says an open Check-up is not answered yet to a reading role", async () => {
    expect(await checkUpPage(users.ADMIN, openId)).toContain("Not answered yet");
  });

  it("shows nothing to anyone else, nor whether the Check-up exists", async () => {
    for (const role of ["VIEWER", "SYSTEM_OWNER"]) {
      const html = await checkUpPage(users[role], answeredId);
      expect(html).toContain("not available to you");
      expect(html).not.toContain("Tested only in staging");
    }
    expect(await checkUpPage(users.VIEWER, "no-such-check-up")).toBe(await checkUpPage(users.VIEWER, answeredId));
  });

  it("lists the recipient's Check-ups, open and answered, and nobody else's", async () => {
    const mine = await render(recipientId, () => MyCheckUpsPage());
    expect(mine).toContain(`/check-ups/${answeredId}`);
    expect(mine).toContain(`/check-ups/${openId}`);
    expect(mine).toContain("Answered");
    const admin = await render(users.ADMIN, () => MyCheckUpsPage());
    expect(admin).toContain("No Check-ups are addressed to you");
  });

  it("shows the audit's progress and links every Check-up row to its response", async () => {
    acting.userId = users.INTERNAL_AUDITOR;
    const html = renderToStaticMarkup(await InternalAuditPage({ params: Promise.resolve({ id: auditId }) } as never));
    expect(html).toContain("2 sent, 1 answered, 0 evaluated, 0 withdrawn, 0 overdue");
    expect(html).toContain(`/check-ups/${answeredId}`);
    expect(html).toContain("Answered: read the response");
    expect(html).toContain("Not answered");
  });

  describe("evaluating (#156)", () => {
    const auditPage = async (userId: string) => {
      acting.userId = userId;
      return renderToStaticMarkup(await InternalAuditPage({ params: Promise.resolve({ id: auditId }) } as never));
    };

    it("offers an Internal Auditor the evaluation form on an answered Check-up only, and nobody else", async () => {
      const html = await checkUpPage(users.INTERNAL_AUDITOR, answeredId);
      expect(html).toContain("Evaluate this Check-up");
      expect(html).toContain("Record evaluation");
      expect(html).toContain("evaluation is final");
      expect(await checkUpPage(users.INTERNAL_AUDITOR, openId)).not.toContain("Record evaluation");
      for (const userId of [users.ADMIN, recipientId]) {
        const other = await checkUpPage(userId, answeredId);
        expect(other).not.toContain("Record evaluation");
      }
      expect(await checkUpPage(users.ADMIN, answeredId)).toContain("Not evaluated yet");
    });

    it("tells the audit page how many await evaluation, and links the next one for an Internal Auditor only", async () => {
      const auditor = await auditPage(users.INTERNAL_AUDITOR);
      expect(auditor).toContain("1 awaiting evaluation");
      expect(auditor).toContain("Evaluate the next one");
      expect(auditor).toContain("Awaiting evaluation</a>");
      const admin = await auditPage(users.ADMIN);
      expect(admin).toContain("1 awaiting evaluation");
      expect(admin).not.toContain("Evaluate the next one");
    });

    it("shows an evaluated Check-up's outcome and comment to everyone who can read it, with the response frozen", async () => {
      await evaluateCheckUp(answeredId, { id: users.INTERNAL_AUDITOR, role: "INTERNAL_AUDITOR" }, { outcome: "NONCONFORMITY", comment: "Only tested in staging" });

      for (const userId of [recipientId, users.INTERNAL_AUDITOR, users.ADMIN]) {
        const html = await checkUpPage(userId, answeredId);
        expect(html).toContain("Nonconformity");
        expect(html).toContain("Only tested in staging");
        expect(html).toContain("Test 155 page INTERNAL_AUDITOR");
        expect(html).toContain("Tested only in staging");
        expect(html).not.toContain("Save changes");
        expect(html).not.toContain("Record evaluation");
        expect(html).toContain("can no longer be changed");
      }
      expect(await checkUpPage(users.VIEWER, answeredId)).toContain("not available to you");
    });

    it("shows the Risk a Nonconformity opened to the audit readers, with what the evaluation did to the target, and not to the recipient", async () => {
      for (const userId of [users.INTERNAL_AUDITOR, users.ADMIN]) {
        const html = await checkUpPage(userId, answeredId);
        expect(html).toContain("Risk opened");
        expect(html).toContain("Internal Audit Nonconformity)");
        expect(html).toContain("Only tested in staging");
        // The target had no stored Assessment, so nothing was set back and the page says so.
        expect(html).toContain("Not changed: the System");
      }
      expect(await checkUpPage(recipientId, answeredId)).not.toContain("Risk opened");
    });

    it("shows the outcome in the recipient's list and the audit page, which counts it as evaluated", async () => {
      const mine = await render(recipientId, () => MyCheckUpsPage());
      expect(mine).toContain("Nonconformity");
      const html = await auditPage(users.INTERNAL_AUDITOR);
      expect(html).toContain("2 sent, 1 answered, 1 evaluated, 0 withdrawn, 0 overdue");
      expect(html).toContain("Nonconformity");
      expect(html).not.toContain("awaiting evaluation");
    });
  });
});

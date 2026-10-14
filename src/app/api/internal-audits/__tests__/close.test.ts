import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInternalAudit } from "@/lib/internal-audits";
import { listCheckUps } from "@/lib/check-ups";
import { listMyCheckUps } from "@/lib/check-up-tasks";
import { lockCheckUp } from "@/lib/check-up-responses";
import { requestAs } from "@/test/provider-fixtures";
import { ALL_ROLES, createCheckUpScenario } from "@/test/check-up-fixtures";
import { GET as getAudit, PATCH as patchAudit, DELETE as deleteAudit } from "../[id]/route";
import { POST as postClose } from "../[id]/close/route";
import { POST as postLaunch } from "../[id]/launch/route";
import { PUT as putQuestions } from "../[id]/controls/[controlId]/questions/route";
import { PUT as putResponse } from "../../check-ups/[id]/response/route";
import { POST as postEvaluation } from "../../check-ups/[id]/evaluation/route";
import { POST as postWithdrawal } from "../../check-ups/[id]/withdrawal/route";

/**
 * Closing an Internal Audit and what a closed audit freezes (#158). Fixtures only (CI's database is
 * migrated, not seeded). The describe blocks run in order and share one audit: it starts launched
 * with one Check-up per kind, is brought to "every Check-up evaluated or withdrawn", closed, and
 * then every write on it is tried as every role.
 */

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Closing an Internal Audit (#158)", () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  const allUsers = () => [...Object.values(s.roleUser), s.secondAuditor, s.systemOwner, s.controlOwner];

  const close = (userId: string | null, id = s.auditId) => postClose(requestAs(`/api/internal-audits/${id}/close`, userId, "POST"), ctx(id));
  const withdraw = (checkUpId: string, userId: string, body: unknown = { reason: "Not needed" }) =>
    postWithdrawal(requestAs(`/api/check-ups/${checkUpId}/withdrawal`, userId, "POST", body), ctx(checkUpId));
  const evaluate = (checkUpId: string, userId: string, body: unknown = { outcome: "CONFORMING" }) =>
    postEvaluation(requestAs(`/api/check-ups/${checkUpId}/evaluation`, userId, "POST", body), ctx(checkUpId));

  /** Everything a refused write must leave alone: the audit and its tables, the Check-ups' tables, Risks and Change Events. */
  async function everything() {
    const auditIds = (await prisma.internalAudit.findMany({ where: { createdById: s.roleUser.INTERNAL_AUDITOR }, select: { id: true } })).map((a) => a.id);
    const checkUpIds = (await prisma.checkUp.findMany({ where: { internalAuditId: { in: auditIds } }, select: { id: true } })).map((c) => c.id);
    return JSON.parse(
      JSON.stringify({
        audits: await prisma.internalAudit.findMany({ where: { id: { in: auditIds } }, orderBy: { id: "asc" } }),
        auditControls: await prisma.internalAuditControl.findMany({ where: { internalAuditId: { in: auditIds } }, orderBy: { id: "asc" }, include: { questions: { orderBy: { id: "asc" } } } }),
        auditSystems: await prisma.internalAuditSystem.findMany({ where: { internalAuditId: { in: auditIds } }, orderBy: { id: "asc" } }),
        checkUps: await prisma.checkUp.findMany({ where: { id: { in: checkUpIds } }, orderBy: { id: "asc" }, include: { questions: { orderBy: { id: "asc" } } } }),
        responses: await prisma.checkUpResponse.findMany({ where: { checkUpId: { in: checkUpIds } }, orderBy: { id: "asc" }, include: { answers: { orderBy: { id: "asc" } } } }),
        evaluations: await prisma.checkUpEvaluation.findMany({ where: { checkUpId: { in: checkUpIds } }, orderBy: { id: "asc" } }),
        withdrawals: await prisma.checkUpWithdrawal.findMany({ where: { checkUpId: { in: checkUpIds } }, orderBy: { id: "asc" } }),
        risks: await prisma.risk.findMany({ where: { OR: [{ systemId: s.systemId }, { checkUpId: { in: checkUpIds } }] }, orderBy: { id: "asc" } }),
        events: await prisma.changeEvent.findMany({
          where: { OR: [{ systemId: s.systemId }, { actorId: { in: allUsers() } }, { systemId: null, detail: { contains: s.suffix } }] },
          orderBy: { id: "asc" },
        }),
      }),
    );
  }
  const auditRow = () => prisma.internalAudit.findUniqueOrThrow({ where: { id: s.auditId } });
  const events = () => prisma.changeEvent.findMany({ where: { systemId: null, detail: { contains: s.suffix } }, orderBy: { id: "asc" } });

  beforeAll(async () => {
    s = await createCheckUpScenario("158c", { systemControls: 2, organizationControls: 1 });
  });

  afterAll(async () => {
    await s.cleanup();
  });

  /** The Check-up of the first / second System Control, or of the Organization Control. */
  const target = (n: "SYS1" | "SYS2" | "ORG1") =>
    n === "ORG1" ? s.find(s.organizationControls[0].code, true) : s.find(s.systemControls[n === "SYS1" ? 0 : 1].code);

  describe("who can close, and when", () => {
    it("launched what the tests below expect", () => {
      expect(s.checkUps).toHaveLength(3);
      expect(s.checkUps.filter((c) => c.target.kind === "organization")).toHaveLength(1);
    });

    it("refuses every role but the Internal Auditor with a 403, and an anonymous caller with a 401, changing nothing", async () => {
      const before = await everything();
      for (const role of ALL_ROLES.filter((r) => r !== "INTERNAL_AUDITOR")) expect((await close(s.roleUser[role])).status, role).toBe(403);
      expect((await close(s.systemOwner)).status).toBe(403);
      expect((await close(s.controlOwner)).status).toBe(403);
      expect((await close(null)).status).toBe(401);
      expect(await everything()).toEqual(before);
    });

    it("answers 404 for an audit that doesn't exist", async () => {
      expect((await close(s.roleUser.INTERNAL_AUDITOR, "no-such-audit")).status).toBe(404);
    });

    it("refuses a draft with a 409, changing nothing: a draft is deleted, not closed", async () => {
      const draftId = await createInternalAudit(
        { title: `Test 158c draft ${s.suffix}`, dueDate: s.dueDate, includeOrganization: false, controlIds: [s.systemControls[0].id], systemIds: [s.systemId] },
        s.roleUser.INTERNAL_AUDITOR,
      );
      const before = await everything();
      const response = await close(s.roleUser.INTERNAL_AUDITOR, draftId);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/draft/);
      expect(await everything()).toEqual(before);
      expect((await prisma.internalAudit.findUniqueOrThrow({ where: { id: draftId } })).status).toBe("DRAFT");
    });
  });

  describe("while a Check-up is neither evaluated nor withdrawn", () => {
    it("is refused with a 409 naming every open Check-up by Control code and target, changing nothing", async () => {
      const before = await everything();
      const response = await close(s.roleUser.INTERNAL_AUDITOR);
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toMatch(/3 Check-ups are neither evaluated nor withdrawn/);
      // By Control code: the fixture codes sort ORG1 before SYS1 and SYS2.
      expect(body.problems).toEqual([
        `${s.organizationControls[0].code} for the Organization`,
        `${s.systemControls[0].code} for System "${s.systemName}"`,
        `${s.systemControls[1].code} for System "${s.systemName}"`,
      ]);
      expect(await everything()).toEqual(before);
      const row = await auditRow();
      expect(row).toMatchObject({ status: "LAUNCHED", closedAt: null, closedById: null });
    });

    it("is refused for an answered Check-up that has not been evaluated, which it names", async () => {
      await s.answer(target("SYS1").id, s.systemOwner);
      await s.answer(target("ORG1").id, s.controlOwner);
      const before = await everything();
      const response = await close(s.roleUser.INTERNAL_AUDITOR);
      expect(response.status).toBe(409);
      expect((await response.json()).problems).toContain(`${s.systemControls[0].code} for System "${s.systemName}"`);
      expect(await everything()).toEqual(before);
    });

    it("is still refused with one Check-up left, naming only that one", async () => {
      expect((await evaluate(target("SYS1").id, s.roleUser.INTERNAL_AUDITOR)).status).toBe(201);
      expect((await withdraw(target("SYS2").id, s.secondAuditor)).status).toBe(201);
      const before = await everything();
      const response = await close(s.roleUser.INTERNAL_AUDITOR);
      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toMatch(/1 Check-up is neither/);
      expect(body.problems).toEqual([`${s.organizationControls[0].code} for the Organization`]);
      expect(await everything()).toEqual(before);
    });
  });

  describe("waiting for a write in flight", () => {
    it("waits for an evaluation that holds the Check-up's lock, then sees it and closes", async () => {
      const orgCheckUp = target("ORG1");
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const held = new Promise<void>((resolve) => (locked = resolve));
      const holder = new PrismaClient();
      const done = holder
        .$transaction(async (tx) => {
          await lockCheckUp(tx, orgCheckUp.id);
          // An evaluation in the middle of its transaction: written, not yet committed.
          await tx.checkUpEvaluation.create({ data: { checkUpId: orgCheckUp.id, outcome: "CONFORMING", comment: "", evaluatedById: s.roleUser.INTERNAL_AUDITOR } });
          locked();
          await released;
        })
        .finally(() => holder.$disconnect());
      await held;

      const closing = close(s.roleUser.INTERNAL_AUDITOR);
      // The close is waiting on the lock: nothing is closed yet.
      expect(await Promise.race([closing.then(() => true), sleep(400).then(() => false)])).toBe(false);
      expect((await auditRow()).status).toBe("LAUNCHED");

      release();
      await done;
      const response = await closing;
      expect(response.status).toBe(200);
      expect((await auditRow()).status).toBe("CLOSED");
    });
  });

  describe("closing", () => {
    it("recorded who closed the audit and when, and wrote no Change Event beyond the evaluations", async () => {
      const row = await auditRow();
      expect(row.status).toBe("CLOSED");
      expect(row.closedById).toBe(s.roleUser.INTERNAL_AUDITOR);
      expect(row.closedAt).not.toBeNull();
      expect(row.launchedAt).not.toBeNull();
      // Decision 1a: closing writes none. The events here are the evaluations' (the withdrawal wrote none, and the last evaluation was made by hand).
      expect((await events()).filter((e) => e.action !== "CHECK_UP_EVALUATED")).toEqual([]);
      expect(await events()).toHaveLength(1);
    });

    it("reads back as closed, with who closed it, to every reading role", async () => {
      const body = await (await getAudit(requestAs(`/api/internal-audits/${s.auditId}`, s.roleUser.ADMIN, "GET"), ctx(s.auditId))).json();
      expect(body.internalAudit).toMatchObject({ status: "CLOSED", closedBy: { id: s.roleUser.INTERNAL_AUDITOR } });
      expect(body.internalAudit.closedAt).toEqual(expect.any(String));
      const rows = await listCheckUps(s.auditId);
      expect(rows.filter((r) => r.withdrawn)).toHaveLength(1);
      expect(rows.filter((r) => r.evaluated)).toHaveLength(2);
    });

    it("keeps closed Check-ups in the recipient's list, but never open", async () => {
      const mine = await listMyCheckUps({ id: s.systemOwner, role: "SYSTEM_OWNER" });
      const ours = mine.filter((c) => c.audit.title === s.auditTitle);
      expect(ours).toHaveLength(2);
      expect(ours.every((c) => !c.open && !c.overdue && c.audit.status === "CLOSED")).toBe(true);
    });

    it("is refused a second time with a 409, leaving who closed it and when untouched", async () => {
      const before = await auditRow();
      const response = await close(s.secondAuditor);
      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatch(/closed already/);
      expect(await auditRow()).toEqual(before);
    });
  });

  describe("once closed, every write on the audit and its Check-ups is refused for every role", () => {
    const writes = () => {
      const checkUps = s.checkUps;
      const control = s.systemControls[0];
      return [
        ["edit the audit", (u: string) => patchAudit(requestAs(`/api/internal-audits/${s.auditId}`, u, "PATCH", { title: "Renamed after closing" }), ctx(s.auditId))],
        ["delete the audit", (u: string) => deleteAudit(requestAs(`/api/internal-audits/${s.auditId}`, u, "DELETE"), ctx(s.auditId))],
        [
          "change a Control's questions",
          (u: string) =>
            putQuestions(requestAs(`/api/internal-audits/${s.auditId}/controls/${control.id}/questions`, u, "PUT", { questions: ["Rewritten?"] }), {
              params: Promise.resolve({ id: s.auditId, controlId: control.id }),
            } as never),
        ],
        ["launch it", (u: string) => postLaunch(requestAs(`/api/internal-audits/${s.auditId}/launch`, u, "POST"), ctx(s.auditId))],
        ["close it again", (u: string) => close(u)],
        ...checkUps.flatMap((c) => [
          [
            `answer ${c.control.code}`,
            async (u: string) => {
              const questions = await prisma.checkUpQuestion.findMany({ where: { checkUpId: c.id } });
              const body = { answers: questions.map((q) => ({ questionId: q.id, answer: "NO", description: "After closing" })), evidenceLinks: [] };
              return putResponse(requestAs(`/api/check-ups/${c.id}/response`, u, "PUT", body), ctx(c.id));
            },
          ],
          [`evaluate ${c.control.code}`, (u: string) => evaluate(c.id, u, { outcome: "NONCONFORMITY", comment: "After closing" })],
          [`withdraw ${c.control.code}`, (u: string) => withdraw(c.id, u, { reason: "After closing" })],
        ]),
      ] as [string, (userId: string) => Promise<Response>][];
    };

    it("refuses every write as every role, with a 409 for the Internal Auditor and a 403 or 409 for the rest, and changes nothing", async () => {
      const before = await everything();
      const callers: [string, string][] = [
        ...ALL_ROLES.map((role) => [role, s.roleUser[role]] as [string, string]),
        ["second auditor", s.secondAuditor],
        ["System Owner (recipient)", s.systemOwner],
        ["Control Owner (recipient)", s.controlOwner],
      ];
      for (const [label, call] of writes()) {
        for (const [who, userId] of callers) {
          const status = (await call(userId)).status;
          expect([403, 409], `${who} tried to ${label}: ${status}`).toContain(status);
          // An Internal Auditor is refused by the audit's state (409), except where the role itself can never act: nobody answers for the recipient.
          if ((who === "INTERNAL_AUDITOR" || who === "second auditor") && !label.startsWith("answer")) expect(status, `${who} tried to ${label}`).toBe(409);
        }
      }
      expect(await everything()).toEqual(before);
    }, 60_000);

    it("refuses the recipient's answer with a 409, because the Check-up is evaluated or withdrawn", async () => {
      for (const [label, answer] of writes().filter(([l]) => l.startsWith("answer"))) {
        const response = await answer(label.includes(s.organizationControls[0].code) ? s.controlOwner : s.systemOwner);
        expect(response.status, label).toBe(409);
        expect((await response.json()).error).toMatch(/evaluated|withdrawn/);
      }
    });
  });
});

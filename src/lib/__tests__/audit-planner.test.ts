import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listRepeatableAudits, loadPlannerData } from "@/lib/audit-planner";
import { isDueForAudit } from "@/lib/internal-audit-rules";

/**
 * What the audit planner (#393) reads: each Control's last audited date and the audits it can repeat. Fixtures only;
 * every row carries this run's suffix, and the audits are found through this file's own user.
 */
const SUFFIX = `${process.pid}-${Date.now()}`;
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

describe("audit planner data (#393)", { timeout: 60_000 }, () => {
  let userId: string;
  let ownerId: string;
  const controls: Record<string, string> = {};
  const systems: Record<string, string> = {};
  const audits: Record<string, string> = {};

  async function control(label: string) {
    controls[label] = (await prisma.control.create({ data: { code: `TEST-393L-${label}-${SUFFIX}`, title: `Test 393 ${label}`, description: "d", category: "Security", applicability: "PER_SYSTEM", question: "Q?" } })).id;
  }
  async function audit(label: string, status: "DRAFT" | "LAUNCHED" | "CLOSED", controlLabels: string[], systemLabels: string[], launchedDaysAgo: number | null, includeOrganization = false) {
    const created = await prisma.internalAudit.create({
      data: {
        title: `Test 393 ${label} ${SUFFIX}`,
        dueDate: new Date(),
        includeOrganization,
        status,
        createdById: userId,
        launchedAt: launchedDaysAgo === null ? null : daysAgo(launchedDaysAgo),
        launchedById: launchedDaysAgo === null ? null : userId,
        controls: { create: controlLabels.map((l) => ({ controlId: controls[l] })) },
        systems: { create: systemLabels.map((l) => ({ systemId: systems[l] })) },
      },
    });
    audits[label] = created.id;
    return created.id;
  }
  async function checkUp(auditLabel: string, controlLabel: string, systemLabel: string) {
    return prisma.checkUp.create({ data: { internalAuditId: audits[auditLabel], controlId: controls[controlLabel], systemId: systems[systemLabel] } });
  }
  const lastAudited = async (label: string) => (await loadPlannerData()).controls.find((c) => c.id === controls[label])?.lastAudited ?? null;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { email: `test-393l-auditor-${SUFFIX}@example.com`, name: "Test 393L Auditor", role: "INTERNAL_AUDITOR" } })).id;
    ownerId = (await prisma.user.create({ data: { email: `test-393l-owner-${SUFFIX}@example.com`, name: "Test 393L Owner", role: "SYSTEM_OWNER" } })).id;
    for (const label of ["NEVER", "EVAL", "WITHDRAWN", "OPEN", "GONE"]) await control(label);
    for (const label of ["LIVE", "CLOSED"]) {
      systems[label] = (await prisma.system.create({ data: { name: `Test 393L System ${label} ${SUFFIX}`, ownerId, evaluationClosedAt: label === "CLOSED" ? new Date() : null } })).id;
    }
    await audit("history", "CLOSED", ["EVAL", "WITHDRAWN", "OPEN"], ["LIVE"], 400);
  }, 60_000);

  afterAll(async () => {
    const auditIds = (await prisma.internalAudit.findMany({ where: { createdById: userId }, select: { id: true } })).map((a) => a.id);
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: auditIds } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-393l-", endsWith: `${SUFFIX}@example.com` } } });
  }, 60_000);

  describe("last audited", () => {
    it("is the latest evaluation of any Check-up of the Control, whatever the outcome, and never for a Control with none", async () => {
      const older = await checkUp("history", "EVAL", "LIVE");
      const evaluatedAt = daysAgo(100);
      await prisma.checkUpEvaluation.create({ data: { checkUpId: older.id, outcome: "NONCONFORMITY", comment: "c", evaluatedById: userId, evaluatedAt: daysAgo(300) } });
      const newer = await prisma.checkUp.create({ data: { internalAuditId: audits.history, controlId: controls.EVAL, systemId: null } });
      await prisma.checkUpEvaluation.create({ data: { checkUpId: newer.id, outcome: "CONFORMING", evaluatedById: userId, evaluatedAt } });

      expect(await lastAudited("EVAL")).toBe(evaluatedAt.toISOString());
      expect(await lastAudited("NEVER")).toBeNull();
    });

    it("does not count a withdrawn Check-up, nor one that was only launched or answered", async () => {
      const withdrawn = await checkUp("history", "WITHDRAWN", "LIVE");
      await prisma.checkUpEvaluation.create({ data: { checkUpId: withdrawn.id, outcome: "CONFORMING", evaluatedById: userId, evaluatedAt: daysAgo(5) } });
      await prisma.checkUpWithdrawal.create({ data: { checkUpId: withdrawn.id, reason: "Test", withdrawnById: userId } });
      await checkUp("history", "OPEN", "LIVE");

      expect(await lastAudited("WITHDRAWN")).toBeNull();
      expect(await lastAudited("OPEN")).toBeNull();
    });

    it("feeds the due-for-audit rule: never audited and 12 months or more are due, 11 months is not", async () => {
      const now = new Date("2026-11-18T12:00:00Z");
      expect(isDueForAudit(null, now)).toBe(true);
      expect(isDueForAudit("2025-11-18T23:59:00Z", now)).toBe(true); // exactly 12 months
      expect(isDueForAudit("2025-11-19T00:00:00Z", now)).toBe(false);
      expect(isDueForAudit("2025-12-18T00:00:00Z", now)).toBe(false);
    });
  });

  describe("repeatable audits", () => {
    it("offers launched and closed audits, newest first, never a draft", async () => {
      await audit("draft", "DRAFT", ["EVAL"], ["LIVE"], null);
      await audit("recent", "LAUNCHED", ["EVAL", "OPEN"], ["LIVE"], 3, true);
      const mine = (await listRepeatableAudits()).filter((a) => Object.values(audits).includes(a.id));
      expect(mine.map((a) => a.id)).toEqual([audits.recent, audits.history]);
      expect(mine[0]).toMatchObject({ status: "LAUNCHED", includeOrganization: true, controlIds: [controls.EVAL, controls.OPEN].sort(), systemIds: [systems.LIVE] });
      expect(mine[1].status).toBe("CLOSED");
    });

    it("leaves out a System closed since, and a Control that no longer exists, without comment", async () => {
      const id = await audit("shrunk", "LAUNCHED", ["EVAL", "GONE"], ["LIVE", "CLOSED"], 1);
      await prisma.control.delete({ where: { id: controls.GONE } });
      const copy = (await listRepeatableAudits()).find((a) => a.id === id)!;
      expect(copy.controlIds).toEqual([controls.EVAL]);
      expect(copy.systemIds).toEqual([systems.LIVE]);
    });
  });
});

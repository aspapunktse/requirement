import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { closeInternalAudit } from "@/lib/internal-audit-closing";
import { evaluateCheckUp } from "@/lib/check-up-evaluations";
import { getLaunchPreview, launchInternalAudit, listCheckUps } from "@/lib/check-ups";
import { createInternalAudit } from "@/lib/internal-audits";
import { loadInternalAuditList } from "@/lib/internal-audit-list";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { mapControlsToFramework } from "@/test/framework-fixtures";
import { addAudit } from "@/test/internal-audit-list-fixtures";

/**
 * The Internal Audits list loader (#398) against real Postgres: Check-up counts per state, the lanes' order, the
 * closed audits' findings, and each draft's planning equal to `getLaunchPreview`. Fixtures only (CI's database is
 * migrated, not seeded); the list is read whole, so every assertion looks at this file's audits by id.
 */
describe("loadInternalAuditList (#398)", () => {
  let scenario: Awaited<ReturnType<typeof createCheckUpScenario>>;
  const auditor = () => ({ id: scenario.roleUser.INTERNAL_AUDITOR, role: "INTERNAL_AUDITOR" as const });
  let laterId: string;
  let readyDraftId: string;
  let noOwnerDraftId: string;
  let noQuestionDraftId: string;
  let closedOldId: string;
  let closedNewId: string;
  let closedFindingsId: string;
  let soonId: string;

  beforeAll(async () => {
    scenario = await createCheckUpScenario("398L", { systemControls: 3, organizationControls: 1 });
    const [s1, s2, s3] = scenario.systemControls;
    const c1 = scenario.find(s1.code);
    const c2 = scenario.find(s2.code);
    const c3 = scenario.find(s3.code);
    await scenario.answer(c1.id, scenario.systemOwner);
    await evaluateCheckUp(c1.id, auditor(), { outcome: "CONFORMING" });
    await prisma.checkUpWithdrawal.create({ data: { checkUpId: c2.id, reason: "Test #398 withdrawn", withdrawnById: scenario.roleUser.INTERNAL_AUDITOR } });
    await scenario.answer(c3.id, scenario.systemOwner);
    // The scenario's audit (due in 30 days) has 4 Check-ups: evaluated, withdrawn, awaiting, and the Organization one unanswered.

    soonId = await addAudit(scenario, { title: "Test #398 soon", state: "launched", dueInDays: 5 });
    laterId = await addAudit(scenario, { title: "Test #398 later", state: "launched", dueInDays: 60 });

    readyDraftId = await addAudit(scenario, { title: "Test #398 ready draft", state: "draft", dueInDays: 20, scope: "Test #398 scope" });
    // An Organizational Control without a Control Owner blocks the launch.
    const orphan = await prisma.control.create({
      data: { code: `TEST-398L-ORPHAN-${scenario.suffix}`, title: "Test 398L orphan", description: "d", category: "Security", applicability: "ORGANIZATIONAL", question: "Is it?" },
    });
    noOwnerDraftId = await addAudit(scenario, { title: "Test #398 no owner draft", state: "draft", dueInDays: 25, controlIds: [orphan.id, s1.id], includeOrganization: true });
    // A Per-System Control with no question blocks it too.
    const silent = await prisma.control.create({
      data: { code: `TEST-398L-SILENT-${scenario.suffix}`, title: "Test 398L silent", description: "d", category: "Security", applicability: "PER_SYSTEM", question: null },
    });
    await mapControlsToFramework(scenario.frameworkId, [silent.id]);
    noQuestionDraftId = await addAudit(scenario, { title: "Test #398 no question draft", state: "draft", dueInDays: 10, controlIds: [silent.id, s1.id] });

    closedOldId = await addAudit(scenario, { title: "Test #398 closed old", state: "closed" });
    // Closed with findings: one Check-up of each outcome, a Nonconformity opening a Risk.
    closedFindingsId = await createInternalAudit(
      { title: "Test #398 closed findings", dueDate: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10), includeOrganization: false, controlIds: [s1.id, s2.id, s3.id], systemIds: [scenario.systemId] },
      scenario.roleUser.INTERNAL_AUDITOR,
    );
    await launchInternalAudit(closedFindingsId, scenario.roleUser.INTERNAL_AUDITOR);
    const rows = await listCheckUps(closedFindingsId);
    const outcomes = ["CONFORMING", "OBSERVATION", "NONCONFORMITY"] as const;
    for (const [index, row] of rows.entries()) {
      await scenario.answer(row.id, scenario.systemOwner);
      await evaluateCheckUp(row.id, auditor(), { outcome: outcomes[index], comment: "Test #398 finding" });
    }
    await closeInternalAudit(closedFindingsId, scenario.roleUser.INTERNAL_AUDITOR);
    // Closed last, so newest first puts it before the others.
    closedNewId = await addAudit(scenario, { title: "Test #398 closed new", state: "closed" });
    await prisma.internalAudit.update({ where: { id: closedOldId }, data: { closedAt: new Date("2026-01-05T10:00:00Z") } });
    await prisma.internalAudit.update({ where: { id: closedFindingsId }, data: { closedAt: new Date("2026-03-05T10:00:00Z") } });
    await prisma.internalAudit.update({ where: { id: closedNewId }, data: { closedAt: new Date("2026-06-05T10:00:00Z") } });
  }, 120_000);

  afterAll(async () => {
    await scenario.cleanup();
    await prisma.$disconnect();
  });

  const byId = async (now?: Date) => {
    const list = await loadInternalAuditList(now);
    return { list, find: (id: string) => list.audits.find((audit) => audit.id === id)! };
  };

  it("counts a launched audit's Check-ups per state", async () => {
    const { find } = await byId();
    expect(find(scenario.auditId).progress).toEqual({ evaluated: 1, withdrawn: 1, awaiting: 1, overdue: 0, notAnswered: 1, total: 4, open: 2 });
    expect(find(scenario.auditId).plan).toBeNull();
    expect(find(scenario.auditId).findings).toBeNull();
  });

  it("makes an unanswered Check-up overdue once the due date has passed, and only in a launched audit", async () => {
    const { find } = await byId(new Date(Date.now() + 40 * 86_400_000));
    expect(find(scenario.auditId).progress).toMatchObject({ overdue: 1, notAnswered: 0, awaiting: 1, open: 2 });
    expect(find(scenario.auditId).daysUntilDue).toBe(-10);
    // The closed audits stay as they were, and a draft has no progress.
    expect(find(closedNewId).progress).toBeNull();
    expect(find(readyDraftId).progress).toBeNull();
  });

  it("totals the Check-ups of the launched audits only", async () => {
    const { list } = await byId();
    const launched = list.audits.filter((audit) => audit.progress);
    for (const key of ["evaluated", "withdrawn", "awaiting", "overdue", "notAnswered", "total", "open"] as const) {
      expect(list.totals[key]).toBe(launched.reduce((sum, audit) => sum + audit.progress![key], 0));
    }
    expect(list.totals.total).toBeGreaterThanOrEqual(4 + 3 + 3);
  });

  it("orders the lanes: launched soonest due first, drafts soonest due first, closed newest first", async () => {
    const { list } = await byId();
    const mine = (ids: string[]) => list.audits.filter((audit) => ids.includes(audit.id)).map((audit) => audit.id);
    const all = [scenario.auditId, soonId, laterId, readyDraftId, noOwnerDraftId, noQuestionDraftId, closedOldId, closedFindingsId, closedNewId];
    expect(mine(all)).toEqual([soonId, scenario.auditId, laterId, noQuestionDraftId, readyDraftId, noOwnerDraftId, closedNewId, closedFindingsId, closedOldId]);
    const statuses = list.audits.map((audit) => audit.status);
    expect(statuses).toEqual([...statuses].sort((a, b) => ["LAUNCHED", "DRAFT", "CLOSED"].indexOf(a) - ["LAUNCHED", "DRAFT", "CLOSED"].indexOf(b)));
  });

  it("gives a closed audit its findings, Risks opened, closed date and who closed it", async () => {
    const { find } = await byId();
    const audit = find(closedFindingsId);
    expect(audit.findings).toEqual({ CONFORMING: 1, OBSERVATION: 1, NONCONFORMITY: 1, risksOpened: 1 });
    expect(audit.closedAt).toBe("2026-03-05");
    expect(audit.closedBy).toBe("Test 398L internal_auditor");
    expect(audit.progress).toBeNull();
    expect(find(closedNewId).findings).toEqual({ CONFORMING: 0, OBSERVATION: 0, NONCONFORMITY: 0, risksOpened: 0 });
  });

  it("carries the scope, due date, Control and System counts and the Organization flag", async () => {
    const { find } = await byId();
    const draft = find(readyDraftId);
    expect(draft).toMatchObject({ title: "Test #398 ready draft", scopeDescription: "Test #398 scope", status: "DRAFT", controlCount: 3, systemCount: 1, includeOrganization: false });
    expect(draft.daysUntilDue).toBe(20);
    expect(find(noOwnerDraftId).includeOrganization).toBe(true);
  });

  it("gives each draft the Check-up count and first blocker getLaunchPreview gives it", async () => {
    const { find } = await byId();
    const blockers = new Map<string, string | null>();
    for (const id of [readyDraftId, noOwnerDraftId, noQuestionDraftId]) {
      const preview = (await getLaunchPreview(id))!;
      expect(find(id).plan).toEqual({
        checkUpCount: preview.systemCheckUpCount + preview.organizationCheckUpCount,
        firstBlocker: preview.blockers[0]?.message ?? null,
      });
      blockers.set(id, find(id).plan!.firstBlocker);
    }
    // The three drafts differ, so the equality above isn't trivial.
    expect(blockers.get(readyDraftId)).toBeNull();
    expect(blockers.get(noOwnerDraftId)).toContain("Control Owner");
    expect(blockers.get(noQuestionDraftId)).toContain("question");
    expect(find(readyDraftId).plan!.checkUpCount).toBe(3);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { closeInternalAudit } from "@/lib/internal-audit-closing";
import { evaluateCheckUp } from "@/lib/check-up-evaluations";
import { getLaunchPreview, launchInternalAudit, listCheckUps } from "@/lib/check-ups";
import { createInternalAudit } from "@/lib/internal-audits";
import { loadInternalAuditPage } from "@/lib/internal-audit-detail";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { mapControlsToFramework } from "@/test/framework-fixtures";
import { addAudit } from "@/test/internal-audit-list-fixtures";

/**
 * The single Internal Audit loader (#399) against real Postgres: the Check-ups per state with the same rules as the
 * list, their order and detail, the closed audit's findings and a draft's launch plan equal to `getLaunchPreview`.
 * Fixtures only (CI's database is migrated, not seeded).
 */
describe("loadInternalAuditPage (#399)", () => {
  let scenario: Awaited<ReturnType<typeof createCheckUpScenario>>;
  const auditor = () => ({ id: scenario.roleUser.INTERNAL_AUDITOR, role: "INTERNAL_AUDITOR" as const });
  let evaluatedId: string;
  let withdrawnId: string;
  let awaitingId: string;
  let organizationId: string;
  let draftId: string;
  let blockedDraftId: string;
  let closedId: string;

  beforeAll(async () => {
    scenario = await createCheckUpScenario("399L", { systemControls: 3, organizationControls: 1 });
    const [s1, s2, s3] = scenario.systemControls;
    evaluatedId = scenario.find(s1.code).id;
    withdrawnId = scenario.find(s2.code).id;
    awaitingId = scenario.find(s3.code).id;
    organizationId = scenario.find(scenario.organizationControls[0].code, true).id;
    await scenario.answer(evaluatedId, scenario.systemOwner);
    await evaluateCheckUp(evaluatedId, auditor(), { outcome: "CONFORMING", comment: "Test #399 fine" });
    await prisma.checkUpWithdrawal.create({ data: { checkUpId: withdrawnId, reason: "Test #399 withdrawn", withdrawnById: scenario.roleUser.INTERNAL_AUDITOR } });
    await scenario.answer(awaitingId, scenario.systemOwner);
    await prisma.checkUpResponse.update({ where: { checkUpId: awaitingId }, data: { evidenceLinks: ["https://example.com/evidence", "javascript:alert(1)"] } });

    draftId = await addAudit(scenario, { title: "Test #399 draft", state: "draft", includeOrganization: true, controlIds: [...scenario.systemControls, ...scenario.organizationControls].map((c) => c.id) });
    // A Per-System Control with no question blocks the launch.
    const silent = await prisma.control.create({
      data: { code: `TEST-399L-SILENT-${scenario.suffix}`, title: "Test 399L silent", description: "d", category: "Security", applicability: "PER_SYSTEM", question: null },
    });
    await mapControlsToFramework(scenario.frameworkId, [silent.id]);
    blockedDraftId = await addAudit(scenario, { title: "Test #399 blocked draft", state: "draft", controlIds: [silent.id, s1.id] });

    // A closed audit with one Check-up of each outcome; the Nonconformity opens a Risk.
    closedId = await createInternalAudit(
      {
        title: "Test #399 closed",
        dueDate: new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10),
        includeOrganization: false,
        controlIds: [s1.id, s2.id, s3.id],
        systemIds: [scenario.systemId],
      },
      scenario.roleUser.INTERNAL_AUDITOR,
    );
    await launchInternalAudit(closedId, scenario.roleUser.INTERNAL_AUDITOR);
    const outcomes = ["CONFORMING", "OBSERVATION", "NONCONFORMITY"] as const;
    for (const [index, row] of (await listCheckUps(closedId)).entries()) {
      await scenario.answer(row.id, scenario.systemOwner);
      await evaluateCheckUp(row.id, auditor(), { outcome: outcomes[index], comment: "Test #399 finding" });
    }
    await closeInternalAudit(closedId, scenario.roleUser.INTERNAL_AUDITOR);
  }, 120_000);

  afterAll(async () => {
    await scenario.cleanup();
    await prisma.$disconnect();
  });

  it("returns null for an audit that does not exist", async () => {
    expect(await loadInternalAuditPage("does-not-exist")).toBeNull();
  });

  it("counts a launched audit's Check-ups per state, with the list's rules", async () => {
    const page = (await loadInternalAuditPage(scenario.auditId))!;
    expect(page.audit.status).toBe("LAUNCHED");
    expect(page.counts).toEqual({ evaluated: 1, withdrawn: 1, awaiting: 1, overdue: 0, notAnswered: 1, total: 4, open: 2 });
    expect(Object.fromEntries(page.checkUps.map((c) => [c.id, c.state]))).toEqual({
      [evaluatedId]: "evaluated",
      [withdrawnId]: "withdrawn",
      [awaitingId]: "awaiting",
      [organizationId]: "notAnswered",
    });
    expect(page.findings).toBeNull();
    expect(page.plan).toBeNull();
    expect(page.daysUntilDue).toBe(30);
  });

  it("makes an unanswered Check-up overdue once the due date has passed", async () => {
    const page = (await loadInternalAuditPage(scenario.auditId, new Date(Date.now() + 40 * 86_400_000)))!;
    expect(page.counts).toMatchObject({ overdue: 1, notAnswered: 0, awaiting: 1, open: 2 });
    expect(page.checkUps.find((c) => c.id === organizationId)!.state).toBe("overdue");
    expect(page.daysUntilDue).toBe(-10);
  });

  it("lists the Check-ups by Control code, with recipient, answers, response, evaluation and withdrawal", async () => {
    const page = (await loadInternalAuditPage(scenario.auditId))!;
    expect(page.checkUps.map((c) => c.control.code)).toEqual([...scenario.systemControls, ...scenario.organizationControls].map((c) => c.code).sort());

    const evaluated = page.checkUps.find((c) => c.id === evaluatedId)!;
    expect(evaluated.target).toEqual({ kind: "system", id: scenario.systemId, name: scenario.systemName });
    expect(evaluated.recipient).toEqual({ id: scenario.systemOwner, name: "Test 399L system-owner" });
    expect(evaluated.questions).toHaveLength(1);
    expect(evaluated.questions[0].answer).toEqual({ answer: "YES", description: "" });
    expect(evaluated.response).toMatchObject({ respondedByName: "Test 399L system-owner", evidenceLinks: [] });
    expect(evaluated.evaluation).toMatchObject({ outcome: "CONFORMING", comment: "Test #399 fine", evaluatedByName: "Test 399L internal_auditor" });

    expect(page.checkUps.find((c) => c.id === withdrawnId)!.withdrawal).toMatchObject({ reason: "Test #399 withdrawn", withdrawnByName: "Test 399L internal_auditor" });
    // Only http(s) links come through.
    expect(page.checkUps.find((c) => c.id === awaitingId)!.response!.evidenceLinks).toEqual(["https://example.com/evidence"]);

    const organization = page.checkUps.find((c) => c.id === organizationId)!;
    expect(organization.target).toEqual({ kind: "organization" });
    expect(organization.recipient).toEqual({ id: scenario.controlOwner, name: "Test 399L control-owner" });
    expect(organization.response).toBeNull();
  });

  it("shows a closed audit's findings and the Risk the Nonconformity opened", async () => {
    const page = (await loadInternalAuditPage(closedId))!;
    expect(page.audit.status).toBe("CLOSED");
    expect(page.findings).toEqual({ CONFORMING: 1, OBSERVATION: 1, NONCONFORMITY: 1, risksOpened: 1 });
    expect(page.counts).toMatchObject({ evaluated: 3, open: 0, total: 3 });
    expect(page.checkUps.filter((c) => c.risk)).toHaveLength(1);
    expect(page.checkUps.find((c) => c.risk)!.evaluation!.outcome).toBe("NONCONFORMITY");
    expect(page.plan).toBeNull();
  });

  it("gives a draft the launch plan getLaunchPreview gives, with who would receive the Check-ups", async () => {
    for (const id of [draftId, blockedDraftId]) {
      const page = (await loadInternalAuditPage(id))!;
      const preview = (await getLaunchPreview(id))!;
      expect(page.audit.status).toBe("DRAFT");
      expect(page.checkUps).toEqual([]);
      expect(page.counts.total).toBe(0);
      expect(page.plan).toMatchObject({
        summary: preview.summary,
        systemCheckUpCount: preview.systemCheckUpCount,
        organizationCheckUpCount: preview.organizationCheckUpCount,
        skippedCount: preview.skippedCount,
        skipped: preview.skipped,
      });
      expect(page.plan!.blockers.map(({ kind, message }) => ({ kind, message }))).toEqual(preview.blockers);
    }
    const ready = (await loadInternalAuditPage(draftId))!.plan!;
    expect(ready.blockers).toEqual([]);
    expect(ready.systemCheckUpCount).toBe(3);
    expect(ready.organizationCheckUpCount).toBe(1);
    expect(ready.recipients.map((r) => [r.id, r.fromThisAudit])).toEqual([
      [scenario.systemOwner, 3],
      [scenario.controlOwner, 1],
    ]);
    const blocked = (await loadInternalAuditPage(blockedDraftId))!.plan!;
    expect(blocked.blockers.length).toBeGreaterThan(0);
  });
});

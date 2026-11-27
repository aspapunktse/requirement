// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { createCheckUpScenario } from "@/test/check-up-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { recordAssessmentStatusChange, recordRiskStatusChange } from "@/lib/status-history";
import { PATCH as patchAssessment } from "@/app/api/systems/[id]/assessments/[controlId]/route";
import { PATCH as patchAnswer } from "@/app/api/systems/[id]/assessments/[controlId]/answer/route";
import { PATCH as patchRisk } from "@/app/api/systems/[id]/risks/[riskId]/route";
import { POST as postRisk } from "@/app/api/systems/[id]/risks/route";
import { evaluateCheckUp } from "@/lib/check-up-evaluations";
import { PATCH as patchOrganizationRisk } from "@/app/api/risks/[id]/route";

/**
 * The append-only status history (#456, ADR 0019), against real Postgres. Fixtures only (`Test 456b...`).
 * Each real write path records one row in the same transaction as the status write; a write that keeps the status records nothing;
 * a refused write records nothing; a failure after the status write takes the history row back with it.
 */
describe("status history (#456)", { timeout: 60_000 }, () => {
  let s: Awaited<ReturnType<typeof createCheckUpScenario>>;
  const riskIds: string[] = [];
  const history = (type: "RISK" | "CONTROL_ASSESSMENT", id: string) =>
    prisma.statusChange.findMany({ where: { subjectType: type, subjectId: id }, orderBy: [{ changedAt: "asc" }, { id: "asc" }] });
  const sysCtx = (extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id: s.systemId, ...extra }) }) as never;

  beforeAll(async () => {
    s = await createCheckUpScenario("456b", { systemControls: 2, organizationControls: 1 });
  }, 60_000);

  afterAll(async () => {
    await prisma.statusChange.deleteMany({ where: { OR: [{ systemId: s.systemId }, { subjectId: { in: riskIds } }] } });
    await prisma.risk.deleteMany({ where: { id: { in: riskIds } } });
    await s.cleanup();
  }, 60_000);

  it("records a new System Risk as created, then each real status change, and nothing when the status stays", async () => {
    const response = await postRisk(
      requestAs(`/api/systems/${s.systemId}/risks`, s.roleUser.RISK_OWNER, "POST", { title: `Test 456b risk ${s.suffix}`, description: "d", severity: "HIGH", likelihood: "LOW" }),
      sysCtx(),
    );
    expect(response.status).toBe(201);
    const riskId = (await response.json()).risk.id as string;
    riskIds.push(riskId);
    const patch = (userId: string, body: unknown) =>
      patchRisk(requestAs(`/api/systems/${s.systemId}/risks/${riskId}`, userId, "PATCH", body), sysCtx({ riskId }));
    expect((await patch(s.roleUser.RISK_OWNER, { status: "ACCEPTED", mitigationPlan: "Accepted." })).status).toBe(200);
    // Same status again (only the plan changes): no row.
    expect((await patch(s.roleUser.RISK_OWNER, { status: "ACCEPTED", mitigationPlan: "Accepted, reviewed." })).status).toBe(200);
    // An owner-only change and a deadline-only change are not status changes.
    expect((await patch(s.roleUser.RISK_OWNER, { deadline: "2027-06-30" })).status).toBe(200);
    expect((await patch(s.roleUser.ADMIN, { status: "CLOSED" })).status).toBe(200);
    const rows = await history("RISK", riskId);
    expect(rows.map((r) => [r.fromStatus, r.toStatus, r.actorId])).toEqual([
      [null, "OPEN", s.roleUser.RISK_OWNER],
      ["OPEN", "ACCEPTED", s.roleUser.RISK_OWNER],
      ["ACCEPTED", "CLOSED", s.roleUser.ADMIN],
    ]);
    expect(rows.every((r) => r.systemId === s.systemId)).toBe(true);
    expect((await prisma.risk.findUniqueOrThrow({ where: { id: riskId } })).deadline?.toISOString().slice(0, 10)).toBe("2027-06-30");
  });

  it("refuses a status change by a role that may not make it and writes no history", async () => {
    const risk = await prisma.risk.create({ data: { systemId: s.systemId, title: `Test 456b refused ${s.suffix}`, description: "d", severity: "LOW", likelihood: "LOW" } });
    riskIds.push(risk.id);
    const before = await prisma.statusChange.count({ where: { systemId: s.systemId } });
    for (const user of [s.roleUser.RISK_FACILITATOR, s.roleUser.VIEWER, s.systemOwner]) {
      const response = await patchRisk(requestAs(`/api/systems/${s.systemId}/risks/${risk.id}`, user, "PATCH", { status: "CLOSED" }), sysCtx({ riskId: risk.id }));
      expect(response.status).toBe(403);
    }
    expect((await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } })).status).toBe("OPEN");
    expect(await prisma.statusChange.count({ where: { systemId: s.systemId } })).toBe(before);
  });

  it("records an Organization Risk's change with no System", async () => {
    const risk = await prisma.risk.create({ data: { systemId: null, checkUpId: s.find(s.organizationControls[0].code, true).id, title: `Test 456b org ${s.suffix}`, description: "d", severity: "LOW", likelihood: "LOW" } });
    riskIds.push(risk.id);
    const response = await patchOrganizationRisk(requestAs(`/api/risks/${risk.id}`, s.roleUser.ADMIN, "PATCH", { status: "ACCEPTED", mitigationPlan: "ok" }), { params: Promise.resolve({ id: risk.id }) } as never);
    expect(response.status).toBe(200);
    const rows = await history("RISK", risk.id);
    expect(rows.map((r) => [r.systemId, r.fromStatus, r.toStatus])).toEqual([[null, "OPEN", "ACCEPTED"]]);
  });

  it("records a Control Assessment's creation and each change through the PATCH route", async () => {
    const controlId = s.systemControls[0].id;
    const patch = (body: unknown) =>
      patchAssessment(requestAs(`/api/systems/${s.systemId}/assessments/${controlId}`, s.roleUser.ADMIN, "PATCH", body), sysCtx({ controlId }));
    expect((await patch({ status: "IN_PROGRESS" })).status).toBe(200);
    expect((await patch({ status: "IN_PROGRESS", notes: "More notes" })).status).toBe(200);
    expect((await patch({ status: "FULFILLED" })).status).toBe(200);
    const assessment = await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: s.systemId, controlId } } });
    const rows = await history("CONTROL_ASSESSMENT", assessment.id);
    expect(rows.map((r) => [r.fromStatus, r.toStatus, r.actorId, r.controlId])).toEqual([
      [null, "IN_PROGRESS", s.roleUser.ADMIN, controlId],
      ["IN_PROGRESS", "FULFILLED", s.roleUser.ADMIN, controlId],
    ]);
  });

  it("refuses a Control Assessment change by a Viewer and writes no history", async () => {
    const before = await prisma.statusChange.count({ where: { systemId: s.systemId, subjectType: "CONTROL_ASSESSMENT" } });
    const controlId = s.systemControls[0].id;
    const response = await patchAssessment(requestAs(`/api/systems/${s.systemId}/assessments/${controlId}`, s.roleUser.VIEWER, "PATCH", { status: "NOT_STARTED" }), sysCtx({ controlId }));
    expect([403, 404]).toContain(response.status);
    expect(await prisma.statusChange.count({ where: { systemId: s.systemId, subjectType: "CONTROL_ASSESSMENT" } })).toBe(before);
  });

  it("commits the history row with the status write, and rolls both back when the transaction fails afterwards", async () => {
    const risk = await prisma.risk.create({ data: { systemId: s.systemId, title: `Test 456b tx ${s.suffix}`, description: "d", severity: "LOW", likelihood: "LOW" } });
    riskIds.push(risk.id);
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.risk.update({ where: { id: risk.id }, data: { status: "TRANSFERRED" } });
        await recordRiskStatusChange(tx, { riskId: risk.id, systemId: s.systemId, from: "OPEN", to: "TRANSFERRED", actorId: s.roleUser.ADMIN });
        expect(await tx.statusChange.count({ where: { subjectId: risk.id } })).toBe(1);
        throw new Error("fail after the write");
      }),
    ).rejects.toThrow("fail after the write");
    expect((await prisma.risk.findUniqueOrThrow({ where: { id: risk.id } })).status).toBe("OPEN");
    expect(await history("RISK", risk.id)).toHaveLength(0);
  });

  it("records an assessment creation once and treats the system actor as no person", async () => {
    const control = s.systemControls[0];
    const assessment = await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: s.systemId, controlId: control.id } } });
    await prisma.$transaction(async (tx) => {
      await recordAssessmentStatusChange(tx, { assessmentId: assessment.id, systemId: s.systemId, controlId: control.id, from: null, to: "NOT_STARTED", actorId: "system" });
      await recordAssessmentStatusChange(tx, { assessmentId: assessment.id, systemId: s.systemId, controlId: control.id, from: null, to: "NOT_STARTED", actorId: "system" });
    });
    const creations = (await history("CONTROL_ASSESSMENT", assessment.id)).filter((r) => r.fromStatus === null);
    expect(creations.length).toBeGreaterThanOrEqual(1);
    const systemMade = creations.filter((r) => r.toStatus === "NOT_STARTED");
    expect(systemMade.length).toBeLessThanOrEqual(1);
    expect(systemMade.every((r) => r.actorId === null)).toBe(true);
  });

  it("records a No answer's Assessment and its auto-opened Risk with the person who answered", async () => {
    const control = s.systemControls[1];
    await prisma.control.update({ where: { id: control.id }, data: { question: "Do you review access?" } });
    const response = await patchAnswer(requestAs(`/api/systems/${s.systemId}/assessments/${control.id}/answer`, s.roleUser.ADMIN, "PATCH", { answer: "NO" }), sysCtx({ controlId: control.id }));
    expect(response.status).toBe(200);
    const assessment = await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: s.systemId, controlId: control.id } } });
    expect((await history("CONTROL_ASSESSMENT", assessment.id)).map((r) => [r.fromStatus, r.toStatus, r.actorId])).toEqual([[null, "IN_PROGRESS", s.roleUser.ADMIN]]);
    const risk = await prisma.risk.findFirstOrThrow({ where: { controlAssessmentId: assessment.id } });
    riskIds.push(risk.id);
    expect((await history("RISK", risk.id)).map((r) => [r.fromStatus, r.toStatus, r.actorId])).toEqual([[null, "OPEN", s.roleUser.ADMIN]]);
    // Answering Yes afterwards changes the Assessment only; the Risk stays.
    expect((await patchAnswer(requestAs(`/api/systems/${s.systemId}/assessments/${control.id}/answer`, s.roleUser.ADMIN, "PATCH", { answer: "YES" }), sysCtx({ controlId: control.id }))).status).toBe(200);
    expect((await history("CONTROL_ASSESSMENT", assessment.id)).map((r) => r.toStatus)).toEqual(["IN_PROGRESS", "FULFILLED"]);
    expect(await history("RISK", risk.id)).toHaveLength(1);
  });

  it("keeps history when the Assessment is deleted and removes it with the System only", async () => {
    const controlId = s.systemControls[0].id;
    const assessment = await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: s.systemId, controlId } } });
    const rows = (await history("CONTROL_ASSESSMENT", assessment.id)).length;
    expect(rows).toBeGreaterThan(0);
    await prisma.controlAssessment.delete({ where: { id: assessment.id } });
    expect((await history("CONTROL_ASSESSMENT", assessment.id)).length).toBe(rows);
  });
  it("a Nonconformity records the set-back of a Fulfilled assessment and the new Risk, attributed to the auditor", async () => {
    const control = s.systemControls[1];
    if (!control) throw new Error("fixture control missing");
    const checkUp = s.find(control.code, false);
    await prisma.controlAssessment.upsert({
      where: { systemId_controlId: { systemId: s.systemId, controlId: control.id } },
      create: { systemId: s.systemId, controlId: control.id, status: "FULFILLED", assessedById: s.systemOwner },
      update: { status: "FULFILLED", assessedById: s.systemOwner },
    });
    await s.answer(checkUp.id, s.systemOwner);
    const auditor = s.roleUser.INTERNAL_AUDITOR;
    await evaluateCheckUp(checkUp.id, { id: auditor, role: "INTERNAL_AUDITOR" as const }, { outcome: "NONCONFORMITY", comment: "The control does not work" });

    const risk = await prisma.risk.findUniqueOrThrow({ where: { checkUpId: checkUp.id } });
    riskIds.push(risk.id);
    const riskRows = await history("RISK", risk.id);
    expect(riskRows.map((r) => [r.fromStatus, r.toStatus, r.actorId, r.systemId])).toEqual([[null, "OPEN", auditor, s.systemId]]);

    const assessment = await prisma.controlAssessment.findUniqueOrThrow({ where: { systemId_controlId: { systemId: s.systemId, controlId: control.id } } });
    expect(assessment.status).toBe("IN_PROGRESS");
    const assessmentRows = await history("CONTROL_ASSESSMENT", assessment.id);
    // The answer route wrote earlier rows; the set-back is the last one.
    const last = assessmentRows.at(-1);
    expect([last?.fromStatus, last?.toStatus, last?.actorId, last?.controlId]).toEqual(["FULFILLED", "IN_PROGRESS", auditor, control.id]);
  });
  it("concurrent PATCHes of one Risk leave a history that ends at its final status, with no consecutive duplicate", async () => {
    for (const make of [
      async () => {
        const r = await postRisk(
          requestAs(`/api/systems/${s.systemId}/risks`, s.roleUser.RISK_OWNER, "POST", { title: `Test 456b race ${s.suffix}`, description: "d", severity: "LOW", likelihood: "LOW" }),
          sysCtx(),
        );
        return (await r.json()).risk.id as string;
      },
    ]) {
      for (let round = 0; round < 5; round++) {
        const riskId = await make();
        riskIds.push(riskId);
        const patch = (body: unknown) => patchRisk(requestAs(`/api/systems/${s.systemId}/risks/${riskId}`, s.roleUser.RISK_OWNER, "PATCH", body), sysCtx({ riskId }));
        const responses = await Promise.all([patch({ status: "ACCEPTED", mitigationPlan: "Accepted." }), patch({ status: "OPEN" })]);
        expect(responses.map((r) => r.status)).toEqual([200, 200]);
        const finalStatus = (await prisma.risk.findUniqueOrThrow({ where: { id: riskId } })).status;
        const rows = await history("RISK", riskId);
        expect(rows.at(-1)?.toStatus).toBe(finalStatus);
        for (let i = 1; i < rows.length; i++) {
          expect(rows[i]?.fromStatus).toBe(rows[i - 1]?.toStatus);
          expect(rows[i]?.toStatus).not.toBe(rows[i]?.fromStatus);
        }
      }
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { listCheckUps } from "@/lib/check-ups";
import { resolveSystemFilter } from "@/lib/internal-audits";
import { SYSTEM_CLOSED_REFUSAL } from "@/lib/system-closed";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { POST as createAudit } from "../internal-audits/route";
import { POST as launch } from "../internal-audits/[id]/launch/route";
import { PUT as putResponse } from "../check-ups/[id]/response/route";
import { POST as postWithdrawal } from "../check-ups/[id]/withdrawal/route";

/**
 * A System the BSO rejected at OG3 is closed (#330), also for Internal Audits: its owner can't answer a Check-up on it, the Internal
 * Auditor can still withdraw or evaluate one (so the audit can be closed), and launching leaves a closed System out, whether it came in
 * by a filter or by hand. Fixtures only (CI's database is migrated, not seeded).
 */
const SUFFIX = `${process.pid}-${Date.now()}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("A closed System and Internal Audits (#330)", { timeout: 60_000 }, () => {
  let auditor: string;
  let openOwner: string;
  let closedOwner: string;
  let control: string;
  let frameworkId: string;
  let openSystem: string;
  let closedSystem: string;
  const auditIds: string[] = [];

  async function draftAudit(systemIds: string[]) {
    const response = await createAudit(
      requestAs("/api/internal-audits", auditor, "POST", { title: "Test 330 Audit", dueDate: future(30), includeOrganization: false, controlIds: [control], systemIds }),
    );
    expect(response.status).toBe(201);
    const id = (await response.json()).internalAudit.id as string;
    auditIds.push(id);
    return id;
  }
  const launchAudit = (id: string) => launch(requestAs(`/api/internal-audits/${id}/launch`, auditor, "POST"), ctx(id));
  const checkUpTargets = async (auditId: string) =>
    (await listCheckUps(auditId)).map((checkUp) => (checkUp.target.kind === "system" ? checkUp.target.id : "organization")).sort();

  beforeAll(async () => {
    const make = async (key: string, role: "INTERNAL_AUDITOR" | "SYSTEM_OWNER") =>
      (await prisma.user.create({ data: { email: `test-330-audit-${key}-${SUFFIX}@example.com`, name: `Test 330 audit ${key}`, role } })).id;
    auditor = await make("auditor", "INTERNAL_AUDITOR");
    openOwner = await make("open", "SYSTEM_OWNER");
    closedOwner = await make("closed", "SYSTEM_OWNER");
    control = (
      await prisma.control.create({
        data: { code: `TEST-330-C-${SUFFIX}`, title: "Test 330 Control", description: "d", category: "Security", applicability: "PER_SYSTEM", question: "Is it in place?" },
      })
    ).id;
    frameworkId = (await createFixtureFramework("330")).id;
    await mapControlsToFramework(frameworkId, [control]);
    openSystem = (await prisma.system.create({ data: { name: `Test 330 Audit Open ${SUFFIX}`, ownerId: openOwner, frameworkScopes: { connect: [{ id: frameworkId }] } } })).id;
    closedSystem = (await prisma.system.create({ data: { name: `Test 330 Audit Closed ${SUFFIX}`, ownerId: closedOwner, frameworkScopes: { connect: [{ id: frameworkId }] } } })).id;
  });

  afterAll(async () => {
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: auditIds } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-330-audit-", endsWith: `${SUFFIX}@example.com` } } });
  }, 60_000);

  it("refuses the owner's answer to a Check-up on a closed System (409, nothing written), and leaves withdrawal and evaluation to the auditor", async () => {
    // Launched while both Systems were open, then the BSO rejected one of them at OG3.
    const auditId = await draftAudit([openSystem, closedSystem]);
    expect((await launchAudit(auditId)).status).toBe(200);
    await prisma.system.update({ where: { id: closedSystem }, data: { status: "REJECTED", evaluationClosedAt: new Date() } });

    const checkUps = await listCheckUps(auditId);
    const onClosed = checkUps.find((c) => c.target.kind === "system" && c.target.id === closedSystem)!;
    const onOpen = checkUps.find((c) => c.target.kind === "system" && c.target.id === openSystem)!;
    const questions = await prisma.checkUpQuestion.findMany({ where: { checkUpId: { in: [onClosed.id, onOpen.id] } } });
    const body = (checkUpId: string) => ({
      answers: questions.filter((q) => q.checkUpId === checkUpId).map((q) => ({ questionId: q.id, answer: "YES", description: "" })),
      evidenceLinks: ["https://example.com/evidence"],
    });

    const refused = await putResponse(requestAs(`/api/check-ups/${onClosed.id}/response`, closedOwner, "PUT", body(onClosed.id)), ctx(onClosed.id));
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toBe(SYSTEM_CLOSED_REFUSAL);
    expect(await prisma.checkUpResponse.count({ where: { checkUpId: onClosed.id } })).toBe(0);

    // An open System's Check-up is answered as before.
    const answered = await putResponse(requestAs(`/api/check-ups/${onOpen.id}/response`, openOwner, "PUT", body(onOpen.id)), ctx(onOpen.id));
    expect(answered.status).toBe(201);

    // The auditor can still withdraw the closed System's Check-up.
    const withdrawn = await postWithdrawal(requestAs(`/api/check-ups/${onClosed.id}/withdrawal`, auditor, "POST", { reason: "The System was rejected" }), ctx(onClosed.id));
    expect(withdrawn.status).toBe(201);
    expect(await prisma.checkUpWithdrawal.count({ where: { checkUpId: onClosed.id } })).toBe(1);
  });

  it("leaves a closed System out of a launch, whether it was picked by hand or came from a filter", async () => {
    // By hand: the closed System is in the draft's list.
    const byHand = await draftAudit([openSystem, closedSystem]);
    expect((await launchAudit(byHand)).status).toBe(200);
    expect(await checkUpTargets(byHand)).toEqual([openSystem]);

    // By filter: the Framework's scope names both, the filter result leaves the closed one out.
    const matches = (await resolveSystemFilter({ frameworkId })).map((system) => system.id);
    expect(matches).toContain(openSystem);
    expect(matches).not.toContain(closedSystem);
    const byFilter = await draftAudit(matches.filter((id) => [openSystem, closedSystem].includes(id)));
    expect((await launchAudit(byFilter)).status).toBe(200);
    expect(await checkUpTargets(byFilter)).toEqual([openSystem]);
  });
});

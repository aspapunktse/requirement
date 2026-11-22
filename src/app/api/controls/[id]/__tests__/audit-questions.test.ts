import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { PUT } from "../audit-questions/route";
import { POST as createAudit } from "../../../internal-audits/route";
import { POST as launch } from "../../../internal-audits/[id]/launch/route";
import { POST as preview } from "../../../internal-audits/preview/route";
import { loadPlannerData } from "@/lib/audit-planner";
import { loadControlPageView } from "@/app/controls/[code]/control-page-data";

/**
 * Audit Questions (#404): a Control's standing, ordered questions, curated by the Compliance Manager, the Admin and
 * the Internal Auditor (`PUT /api/controls/[id]/audit-questions`, one all-or-nothing write, no Change Event). A new
 * Internal Audit draft starts from a copy of them, or from the Self-Assessment Question when there are none; the
 * draft and a launched Check-up keep their own copy. Fixtures only (CI's database is migrated, not seeded).
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER", "SYSTEM_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];
const CURATING: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"];
const REFUSED = ROLES.filter((role) => !CURATING.includes(role));

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("Audit Questions (#404)", { timeout: 60_000 }, () => {
  const users = {} as Record<UserRole, string>;
  let ownerId: string;
  let withBank: { id: string; code: string };
  let withoutBank: { id: string; code: string };
  let orgControl: { id: string; code: string };
  let systemId: string;

  const makeControl = async (label: string, applicability: "ORGANIZATIONAL" | "PER_SYSTEM", question: string | null) => {
    const code = `TEST-404-${label}-${SUFFIX}`;
    const control = await prisma.control.create({
      data: { code, title: `Test 404 Control ${label}`, description: "d", category: "Security", applicability, question, ownerId },
    });
    return { id: control.id, code };
  };
  const put = (role: UserRole | null, controlId: string, body: unknown) =>
    PUT(requestAs(`/api/controls/${controlId}/audit-questions`, role ? users[role] : null, "PUT", body), idCtx(controlId));
  const bankOf = async (controlId: string) => (await prisma.controlAuditQuestion.findMany({ where: { controlId }, orderBy: { position: "asc" } })).map((q) => q.text);
  const asAuditor = (method: string, url: string, body?: unknown) => requestAs(url, users.INTERNAL_AUDITOR, method, body);
  const selection = (controlIds: string[], extra: Record<string, unknown> = {}) => ({
    title: "Test 404 Audit",
    dueDate: future(30),
    includeOrganization: true,
    controlIds,
    systemIds: [systemId],
    ...extra,
  });
  async function createDraft(controlIds: string[], extra: Record<string, unknown> = {}) {
    const response = await createAudit(asAuditor("POST", "/api/internal-audits", selection(controlIds, extra)));
    expect(response.status).toBe(201);
    return (await response.json()).internalAudit as { id: string };
  }
  const draftQuestions = async (auditId: string, controlId: string) =>
    (
      await prisma.internalAuditControl.findUniqueOrThrow({
        where: { internalAuditId_controlId: { internalAuditId: auditId, controlId } },
        include: { questions: { orderBy: { position: "asc" } } },
      })
    ).questions.map((q) => q.text);

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-404-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 404 ${role}`, role } })).id;
    }
    ownerId = (await prisma.user.create({ data: { email: `test-404-owner-${SUFFIX}@example.com`, name: "Test 404 Owner", role: "SYSTEM_OWNER" } })).id;
    const framework = await createFixtureFramework("404");
    const facet = await prisma.deploymentFacet.create({ data: { name: `Test 404 Facet ${SUFFIX}` } });
    withBank = await makeControl("BANK", "PER_SYSTEM", "Is it in place?");
    withoutBank = await makeControl("NOBANK", "PER_SYSTEM", "Is the other in place?");
    orgControl = await makeControl("ORG", "ORGANIZATIONAL", null);
    // Facet-scoped, so they can't leak into other files' Systems.
    for (const control of [withBank, withoutBank]) await prisma.control.update({ where: { id: control.id }, data: { deploymentFacets: { connect: { id: facet.id } } } });
    await mapControlsToFramework(framework.id, [withBank.id, withoutBank.id]);
    systemId = (
      await prisma.system.create({
        data: { name: `Test 404 System ${SUFFIX}`, ownerId, frameworkScopes: { connect: [{ id: framework.id }] }, deploymentFacets: { connect: [{ id: facet.id }] } },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    const audits = (await prisma.internalAudit.findMany({ where: { createdById: { in: Object.values(users) } }, select: { id: true } })).map((a) => a.id);
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: audits } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: audits } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.deploymentFacet.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-404-", endsWith: `${SUFFIX}@example.com` } } });
  }, 60_000);

  it.each(CURATING)("lets the %s save, reorder, trim and replace the list, writing no Change Event", async (role) => {
    const saved = await put(role, withBank.id, { questions: ["  First?  ", "Second?", "Third?"] });
    expect(saved.status).toBe(200);
    expect((await saved.json()).questions).toEqual(["First?", "Second?", "Third?"]);
    expect(await bankOf(withBank.id)).toEqual(["First?", "Second?", "Third?"]);

    const reordered = await put(role, withBank.id, { questions: ["Third?", "First?", "New?"] });
    expect(reordered.status).toBe(200);
    expect(await bankOf(withBank.id)).toEqual(["Third?", "First?", "New?"]);
    expect(await prisma.changeEvent.count({ where: { actorId: { in: Object.values(users) } } })).toBe(0);
  });

  it("refuses every other role and an anonymous request with nothing changed", async () => {
    await put("ADMIN", withBank.id, { questions: ["Keep me?"] });
    for (const role of REFUSED) {
      expect((await put(role, withBank.id, { questions: ["Hijack?"] })).status, role).toBe(403);
    }
    expect((await put(null, withBank.id, { questions: ["Hijack?"] })).status).toBe(401);
    expect(await bankOf(withBank.id)).toEqual(["Keep me?"]);
  });

  it("refuses blank, repeated, over-long and malformed lists (400) and an unknown Control (404), changing nothing", async () => {
    await put("ADMIN", withBank.id, { questions: ["Keep me?"] });
    for (const body of [
      { questions: ["Fine?", "   "] },
      { questions: [""] },
      { questions: ["Same?", " Same? "] },
      { questions: ["x".repeat(2001)] },
      { questions: Array.from({ length: 21 }, (_, i) => `Q${i}?`) },
      { questions: "nope" },
      {},
    ]) {
      expect((await put("ADMIN", withBank.id, body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect(await bankOf(withBank.id)).toEqual(["Keep me?"]);
    expect((await put("ADMIN", "no-such-control", { questions: ["A?"] })).status).toBe(404);
  });

  it("shows the list on the Control page to everyone and says who may curate it", async () => {
    await put("ADMIN", withBank.id, { questions: ["One?", "Two?"] });
    for (const role of ROLES) {
      const view = await loadControlPageView({ id: users[role], name: role, role }, withBank.code);
      expect(view?.auditQuestions, role).toEqual(["One?", "Two?"]);
      expect(view?.canCurateAuditQuestions, role).toBe(CURATING.includes(role));
    }
  });

  describe("a draft starts from the bank", () => {
    it("copies the bank, falls back to the Self-Assessment Question and lets an Organizational Control start non-empty", async () => {
      await put("INTERNAL_AUDITOR", withBank.id, { questions: ["Bank 1?", "Bank 2?"] });
      await prisma.controlAuditQuestion.deleteMany({ where: { controlId: { in: [withoutBank.id, orgControl.id] } } });
      await put("INTERNAL_AUDITOR", orgControl.id, { questions: ["Org bank?"] });
      const draft = await createDraft([withBank.id, withoutBank.id, orgControl.id]);
      expect(await draftQuestions(draft.id, withBank.id)).toEqual(["Bank 1?", "Bank 2?"]);
      expect(await draftQuestions(draft.id, withoutBank.id)).toEqual(["Is the other in place?"]);
      expect(await draftQuestions(draft.id, orgControl.id)).toEqual(["Org bank?"]);
      await prisma.controlAuditQuestion.deleteMany({ where: { controlId: orgControl.id } });
    });

    it("keeps the planner's first question on top of the bank: it replaces the first, the rest stay", async () => {
      await put("ADMIN", withBank.id, { questions: ["Bank 1?", "Bank 2?"] });
      const draft = await createDraft([withBank.id], { firstQuestions: { [withBank.id]: "Edited first?" } });
      expect(await draftQuestions(draft.id, withBank.id)).toEqual(["Edited first?", "Bank 2?"]);
    });

    it("uses the bank for the launch preview and for launch, and the draft and Check-ups keep their copy when the bank changes", async () => {
      await put("ADMIN", withBank.id, { questions: ["Launch 1?", "Launch 2?"] });
      const planned = await preview(asAuditor("POST", "/api/internal-audits/preview", selection([withBank.id], { includeOrganization: false })));
      expect(planned.status).toBe(200);
      expect((await planned.json()).preview.blockers).toEqual([]);

      const draft = await createDraft([withBank.id], { includeOrganization: false });
      await put("ADMIN", withBank.id, { questions: ["Changed?"] });
      expect(await draftQuestions(draft.id, withBank.id)).toEqual(["Launch 1?", "Launch 2?"]);

      const launched = await launch(asAuditor("POST", `/api/internal-audits/${draft.id}/launch`), idCtx(draft.id));
      expect(launched.status).toBe(200);
      await put("ADMIN", withBank.id, { questions: ["Changed again?"] });
      const checkUps = await prisma.checkUp.findMany({ where: { internalAuditId: draft.id }, include: { questions: { orderBy: { position: "asc" } } } });
      expect(checkUps).toHaveLength(1);
      expect(checkUps[0].questions.map((q) => q.text)).toEqual(["Launch 1?", "Launch 2?"]);
    });

    it("shows the planner the first Audit Question as the Control's starting question, else the Self-Assessment Question", async () => {
      await put("ADMIN", withBank.id, { questions: ["Planner 1?", "Planner 2?"] });
      await prisma.controlAuditQuestion.deleteMany({ where: { controlId: withoutBank.id } });
      const { controls } = await loadPlannerData();
      expect(controls.find((c) => c.id === withBank.id)?.question).toBe("Planner 1?");
      expect(controls.find((c) => c.id === withoutBank.id)?.question).toBe("Is the other in place?");
    });

    it("deleting a Control deletes its Audit Questions", async () => {
      const code = `TEST-404-GONE-${SUFFIX}`;
      const gone = await prisma.control.create({ data: { code, title: "Test 404 gone", description: "d", category: "Security", applicability: "ORGANIZATIONAL" } });
      await put("ADMIN", gone.id, { questions: ["Bye?"] });
      await prisma.control.delete({ where: { id: gone.id } });
      expect(await prisma.controlAuditQuestion.count({ where: { controlId: gone.id } })).toBe(0);
    });
  });
});

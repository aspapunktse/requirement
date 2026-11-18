import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { POST as createAudit } from "../route";
import { GET as getAudit, PATCH as patchAudit } from "../[id]/route";
import { POST as launch } from "../[id]/launch/route";
import { PUT as putQuestions } from "../[id]/controls/[controlId]/questions/route";
import { POST as preview } from "../preview/route";

/**
 * The audit planner's launch preview (#393): `POST /api/internal-audits/preview` is `planLaunch` on an unsaved
 * selection, so it must say what the saved draft's launch preview says and what launching really creates. Also the
 * first questions the planner sends on create and edit. Fixtures only (CI's database is migrated, not seeded):
 * names and codes carry this run's suffix and every audit is found through this file's own users.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER", "SYSTEM_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER", "INTERNAL_AUDITOR"];
const NOT_WRITING = ROLES.filter((role) => role !== "INTERNAL_AUDITOR");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const qctx = (id: string, controlId: string) => ({ params: Promise.resolve({ id, controlId }) }) as never;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("Audit planner preview (#393)", { timeout: 60_000 }, () => {
  const users = {} as Record<UserRole, string>;
  const owners: string[] = [];
  let controlOwner: string;
  let c1: { id: string; code: string };
  let c2: { id: string; code: string };
  let cOrg: { id: string; code: string };
  let cNoQuestion: { id: string; code: string };
  let systems: string[];

  async function makeControl(label: string, applicability: "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH", extra: Record<string, unknown> = {}) {
    const code = `TEST-393-${label}-${SUFFIX}`;
    const control = await prisma.control.create({ data: { code, title: `Test 393 Control ${label}`, description: "d", category: "Security", applicability, ...extra } });
    return { id: control.id, code };
  }
  const ownAudits = () => ({ createdById: { in: Object.values(users) } });
  const as = (role: UserRole, method: string, url: string, body?: unknown) => requestAs(url, users[role], method, body);
  const previewOf = async (body: unknown, role: UserRole = "INTERNAL_AUDITOR") => {
    const response = await preview(as(role, "POST", "/api/internal-audits/preview", body));
    expect(response.status).toBe(200);
    return (await response.json()).preview as {
      summary: string;
      systemCheckUpCount: number;
      organizationCheckUpCount: number;
      skippedCount: number;
      blockers: { kind: string; message: string; controlIds: string[] }[];
      perControl: Record<string, number>;
      recipients: { id: string; name: string; roles: string[]; fromThisAudit: number; alreadyOpen: number }[];
    };
  };
  const selection = (overrides: Record<string, unknown> = {}) => ({
    title: "Test 393 Audit",
    dueDate: future(30),
    includeOrganization: true,
    controlIds: [c1.id, c2.id, cOrg.id],
    systemIds: systems,
    ...overrides,
  });
  async function createDraft(overrides: Record<string, unknown> = {}) {
    const response = await createAudit(as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", selection(overrides)));
    expect(response.status).toBe(201);
    return (await response.json()).internalAudit as { id: string };
  }
  const questionsOf = async (id: string, controlId: string) =>
    (
      await prisma.internalAuditControl.findUniqueOrThrow({
        where: { internalAuditId_controlId: { internalAuditId: id, controlId } },
        include: { questions: { orderBy: { position: "asc" } } },
      })
    ).questions.map((q) => q.text);
  const auditCount = () => prisma.internalAudit.count({ where: ownAudits() });

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-393-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 393 ${role}`, role } })).id;
    }
    for (const label of ["1", "2"]) {
      owners.push((await prisma.user.create({ data: { email: `test-393-owner${label}-${SUFFIX}@example.com`, name: `Test 393 Owner ${label}`, role: "SYSTEM_OWNER" } })).id);
    }
    controlOwner = (await prisma.user.create({ data: { email: `test-393-co-${SUFFIX}@example.com`, name: "Test 393 Control Owner", role: "COMPLIANCE_MANAGER" } })).id;
    c1 = await makeControl("C1", "PER_SYSTEM", { question: "Is C1 in place?" });
    c2 = await makeControl("C2", "BOTH", { question: "Is C2 in place?", ownerId: controlOwner });
    cOrg = await makeControl("ORG", "ORGANIZATIONAL", { question: "Is the policy approved?", ownerId: controlOwner });
    cNoQuestion = await makeControl("NOQ", "PER_SYSTEM");
    const framework = await createFixtureFramework("393");
    await mapControlsToFramework(framework.id, [c1.id, c2.id, cNoQuestion.id]);
    systems = [];
    for (const [index, ownerId] of owners.entries()) {
      systems.push((await prisma.system.create({ data: { name: `Test 393 System ${index + 1} ${SUFFIX}`, ownerId, frameworkScopes: { connect: [{ id: framework.id }] } } })).id);
    }
  }, 60_000);

  afterAll(async () => {
    const auditIds = (await prisma.internalAudit.findMany({ where: ownAudits(), select: { id: true } })).map((a) => a.id);
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: auditIds } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-393-", endsWith: `${SUFFIX}@example.com` } } });
  }, 60_000);

  it("says what the saved draft's launch preview says and what launching creates, and who receives it", async () => {
    const body = selection();
    const planned = await previewOf(body);
    const draft = await createDraft();

    const saved = (await (await getAudit(as("INTERNAL_AUDITOR", "GET", `/api/internal-audits/${draft.id}`), ctx(draft.id))).json()).launchPreview;
    expect(planned).toMatchObject({
      summary: saved.summary,
      systemCheckUpCount: saved.systemCheckUpCount,
      organizationCheckUpCount: saved.organizationCheckUpCount,
      skippedCount: saved.skippedCount,
    });
    expect(planned.blockers.map((b) => b.kind)).toEqual(saved.blockers.map((b: { kind: string }) => b.kind));
    expect(planned.systemCheckUpCount).toBe(4); // C1 and C2 on 2 Systems
    expect(planned.organizationCheckUpCount).toBe(2); // C2 and ORG
    expect(planned.perControl).toEqual({ [c1.id]: 2, [c2.id]: 3, [cOrg.id]: 1 });

    const launched = await launch(as("INTERNAL_AUDITOR", "POST", `/api/internal-audits/${draft.id}/launch`), ctx(draft.id));
    expect(launched.status).toBe(200);
    const created = await prisma.checkUp.findMany({ where: { internalAuditId: draft.id }, include: { system: { select: { ownerId: true } }, control: { select: { ownerId: true } } } });
    expect(created).toHaveLength(planned.systemCheckUpCount + planned.organizationCheckUpCount);
    const receivedBy = new Map<string, number>();
    for (const checkUp of created) {
      const recipient = checkUp.system ? checkUp.system.ownerId : checkUp.control.ownerId;
      receivedBy.set(recipient!, (receivedBy.get(recipient!) ?? 0) + 1);
    }
    expect(Object.fromEntries(planned.recipients.map((r) => [r.id, r.fromThisAudit]))).toEqual(Object.fromEntries(receivedBy));
    expect(planned.recipients.find((r) => r.id === controlOwner)?.roles).toEqual(["Control Owner"]);
    expect(planned.recipients.find((r) => r.id === owners[0])?.roles).toEqual(["System Owner"]);
  });

  it("counts a recipient's Check-ups from launched audits that are neither evaluated nor withdrawn as already open", async () => {
    // The previous test launched an audit: every Check-up of it is open.
    const before = await previewOf(selection({ controlIds: [c1.id], includeOrganization: false, systemIds: [systems[0]] }));
    expect(before.recipients).toHaveLength(1);
    expect(before.recipients[0]).toMatchObject({ id: owners[0], fromThisAudit: 1, alreadyOpen: 2 });

    const launchedCheckUps = await prisma.checkUp.findMany({ where: { systemId: systems[0], internalAudit: { createdById: users.INTERNAL_AUDITOR } }, orderBy: { id: "asc" } });
    await prisma.checkUpEvaluation.create({ data: { checkUpId: launchedCheckUps[0].id, outcome: "CONFORMING", evaluatedById: users.INTERNAL_AUDITOR } });
    await prisma.checkUpWithdrawal.create({ data: { checkUpId: launchedCheckUps[1].id, reason: "Test", withdrawnById: users.INTERNAL_AUDITOR } });
    const after = await previewOf(selection({ controlIds: [c1.id], includeOrganization: false, systemIds: [systems[0]] }));
    expect(after.recipients[0].alreadyOpen).toBe(0);
  });

  it("reports a Control with no question as a blocker, and an edited first question clears it", async () => {
    const without = await previewOf(selection({ controlIds: [cNoQuestion.id], includeOrganization: false }));
    expect(without.blockers).toEqual([expect.objectContaining({ kind: "no-questions", controlIds: [cNoQuestion.id] })]);

    const withQuestion = await previewOf(selection({ controlIds: [cNoQuestion.id], includeOrganization: false, firstQuestions: { [cNoQuestion.id]: "Is it done?" } }));
    expect(withQuestion.blockers).toEqual([]);
    expect(withQuestion.systemCheckUpCount).toBe(2);
  });

  it("starts from a saved draft's own questions when editing it", async () => {
    const draft = await createDraft({ controlIds: [cNoQuestion.id], includeOrganization: false });
    expect((await previewOf(selection({ internalAuditId: draft.id, controlIds: [cNoQuestion.id], includeOrganization: false }))).blockers).toHaveLength(1);
    const put = await putQuestions(as("INTERNAL_AUDITOR", "PUT", "x", { questions: ["Written on the draft?"] }), qctx(draft.id, cNoQuestion.id));
    expect(put.status).toBe(200);
    const edited = await previewOf(selection({ internalAuditId: draft.id, controlIds: [cNoQuestion.id], includeOrganization: false }));
    expect(edited.blockers).toEqual([]);
  });

  it("answers an empty selection with an empty plan and its blockers, and writes nothing", async () => {
    const before = await auditCount();
    const empty = await previewOf({});
    expect(empty).toMatchObject({ systemCheckUpCount: 0, organizationCheckUpCount: 0, recipients: [] });
    expect(empty.blockers.length).toBeGreaterThan(0);
    expect(await auditCount()).toBe(before);
  });

  it("refuses everyone but an Internal Auditor, and a malformed body, changing nothing", async () => {
    const before = await auditCount();
    for (const role of NOT_WRITING) {
      const response = await preview(as(role, "POST", "/api/internal-audits/preview", selection()));
      expect(response.status, role).toBe(403);
    }
    expect((await preview(requestAs("/api/internal-audits/preview", null, "POST", selection()))).status).toBe(401);
    expect((await preview(as("INTERNAL_AUDITOR", "POST", "/api/internal-audits/preview", { controlIds: "nope" }))).status).toBe(400);
    expect(await auditCount()).toBe(before);
  });

  describe("first questions on create and edit", () => {
    it("stores an edited first question on create, keeps the default of an unedited Control, and drops it when blank", async () => {
      const draft = await createDraft({ controlIds: [c1.id, c2.id, cNoQuestion.id], includeOrganization: false, firstQuestions: { [c1.id]: "  Edited C1?  ", [cNoQuestion.id]: "Written NOQ?", [c2.id]: "" } });
      expect(await questionsOf(draft.id, c1.id)).toEqual(["Edited C1?"]);
      expect(await questionsOf(draft.id, cNoQuestion.id)).toEqual(["Written NOQ?"]);
      expect(await questionsOf(draft.id, c2.id)).toEqual([]);

      const plain = await createDraft({ controlIds: [c1.id], includeOrganization: false });
      expect(await questionsOf(plain.id, c1.id)).toEqual(["Is C1 in place?"]);
    });

    it("replaces the first question of a Control that stays in the draft on edit, and leaves the others alone", async () => {
      const draft = await createDraft({ controlIds: [c1.id, c2.id], includeOrganization: false });
      const patch = await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { controlIds: [c1.id, c2.id], firstQuestions: { [c1.id]: "Changed on edit?" } }), ctx(draft.id));
      expect(patch.status).toBe(200);
      expect(await questionsOf(draft.id, c1.id)).toEqual(["Changed on edit?"]);
      expect(await questionsOf(draft.id, c2.id)).toEqual(["Is C2 in place?"]);
    });

    it("refuses a question that is too long, creating nothing", async () => {
      const before = await auditCount();
      const response = await createAudit(as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", selection({ firstQuestions: { [c1.id]: "x".repeat(2001) } })));
      expect(response.status).toBe(400);
      expect(await auditCount()).toBe(before);
    });
  });
});

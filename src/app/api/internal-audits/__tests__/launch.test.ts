import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma, type UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listCheckUps } from "@/lib/check-ups";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { POST as createAudit } from "../route";
import { GET as getAudit, PATCH as patchAudit, DELETE as deleteAudit } from "../[id]/route";
import { POST as launch } from "../[id]/launch/route";
import { PUT as putQuestions } from "../[id]/controls/[controlId]/questions/route";

/**
 * Check-up questions and launching an Internal Audit (#154). Fixtures only (CI's database is
 * migrated, not seeded): every name and code carries this run's suffix, and every audit is found
 * through this file's own users, since the other Internal Audit test files run in parallel.
 * The fixture Controls apply to the fixture Systems through a fixture Framework that only the
 * fixture Systems have in scope; `systemOut` has no scope, so no Control applies to it.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = [
  "ADMIN",
  "COMPLIANCE_MANAGER",
  "RISK_OWNER",
  "SYSTEM_OWNER",
  "REVIEWER",
  "BUSINESS_RISK_OWNER",
  "VIEWER",
  "INTERNAL_AUDITOR",
];
const READING: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER", "INTERNAL_AUDITOR"];
const NOT_WRITING = ROLES.filter((role) => role !== "INTERNAL_AUDITOR");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const qctx = (id: string, controlId: string) => ({ params: Promise.resolve({ id, controlId }) }) as never;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("Check-up questions and launch (#154)", { timeout: 60_000 }, () => {
  const users = {} as Record<UserRole, string>;
  const ownerIds: string[] = []; // three System owners
  let controlOwnerA: string;
  let controlOwnerB: string;
  let c1: { id: string; code: string }; // Per-System, mapped, has a Self-Assessment Question
  let c2: { id: string; code: string }; // Both, mapped, has one, owned by controlOwnerA
  let cOrg: { id: string; code: string }; // Organizational, owned by controlOwnerB
  let cNoQuestion: { id: string; code: string }; // Per-System, mapped, no Self-Assessment Question
  let systems: string[]; // S1..S3, in the fixture Framework's scope, owners ownerIds[0..2]
  let systemOut: string; // not in scope
  let frameworkId: string;

  async function makeControl(label: string, applicability: "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH", extra: Partial<Prisma.ControlUncheckedCreateInput> = {}) {
    const code = `TEST-154-${label}-${SUFFIX}`;
    const control = await prisma.control.create({
      data: { code, title: `Test 154 Control ${label}`, description: "d", category: "Security", applicability, ...extra },
    });
    return { id: control.id, code };
  }

  const ownAudits = () => ({ createdById: { in: Object.values(users) } });

  /** Everything a write could change, for the "no DB change" checks. */
  async function snapshot() {
    return JSON.parse(
      JSON.stringify(
        await prisma.internalAudit.findMany({
          where: ownAudits(),
          orderBy: { id: "asc" },
          include: {
            controls: { orderBy: { id: "asc" }, include: { questions: { orderBy: { position: "asc" } } } },
            systems: { orderBy: { id: "asc" } },
            checkUps: { orderBy: { id: "asc" }, include: { questions: { orderBy: { position: "asc" } } } },
          },
        }),
      ),
    );
  }

  const as = (role: UserRole, method: string, url: string, body?: unknown) => requestAs(url, users[role], method, body);

  async function createDraft(overrides: Record<string, unknown> = {}) {
    const response = await createAudit(
      as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", {
        title: "Test 154 Audit",
        dueDate: future(30),
        includeOrganization: false,
        controlIds: [c1.id],
        systemIds: [systems[0]],
        ...overrides,
      }),
    );
    expect(response.status).toBe(201);
    return (await response.json()).internalAudit as { id: string };
  }

  const launchAs = (role: UserRole, id: string) => launch(as(role, "POST", `/api/internal-audits/${id}/launch`), ctx(id));
  const questionsOf = async (id: string, controlId: string) => {
    const row = await prisma.internalAuditControl.findUniqueOrThrow({
      where: { internalAuditId_controlId: { internalAuditId: id, controlId } },
      include: { questions: { orderBy: { position: "asc" } } },
    });
    return row.questions.map((q) => q.text);
  };

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-154-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 154 ${role}`, role } })).id;
    }
    for (const label of ["1", "2", "3"]) {
      ownerIds.push((await prisma.user.create({ data: { email: `test-154-owner${label}-${SUFFIX}@example.com`, name: `Test 154 Owner ${label}`, role: "SYSTEM_OWNER" } })).id);
    }
    controlOwnerA = (await prisma.user.create({ data: { email: `test-154-coa-${SUFFIX}@example.com`, name: "Test 154 Control Owner A", role: "COMPLIANCE_MANAGER" } })).id;
    controlOwnerB = (await prisma.user.create({ data: { email: `test-154-cob-${SUFFIX}@example.com`, name: "Test 154 Control Owner B", role: "RISK_OWNER" } })).id;

    c1 = await makeControl("C1", "PER_SYSTEM", { question: "Is C1 in place?" });
    c2 = await makeControl("C2", "BOTH", { question: "Is C2 in place?", ownerId: controlOwnerA });
    cOrg = await makeControl("ORG", "ORGANIZATIONAL", { question: "Is the policy approved?", ownerId: controlOwnerB });
    cNoQuestion = await makeControl("NOQ", "PER_SYSTEM");

    const framework = await createFixtureFramework("154");
    frameworkId = framework.id;
    await mapControlsToFramework(frameworkId, [c1.id, c2.id, cNoQuestion.id]);
    systems = [];
    for (const [index, ownerId] of ownerIds.entries()) {
      systems.push(
        (await prisma.system.create({ data: { name: `Test 154 System ${index + 1} ${SUFFIX}`, ownerId, frameworkScopes: { connect: [{ id: frameworkId }] } } })).id,
      );
    }
    systemOut = (await prisma.system.create({ data: { name: `Test 154 System Out ${SUFFIX}`, ownerId: ownerIds[0] } })).id;
  }, 60_000);

  afterAll(async () => {
    const audits = await prisma.internalAudit.findMany({ where: ownAudits(), select: { id: true } });
    const auditIds = audits.map((a) => a.id);
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: auditIds } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-154-", endsWith: `${SUFFIX}@example.com` } } });
  }, 60_000);

  describe("the questions of a draft", () => {
    it("starts a Control with its Self-Assessment Question, and none when it has none", async () => {
      const draft = await createDraft({ controlIds: [c1.id, cNoQuestion.id] });
      expect(await questionsOf(draft.id, c1.id)).toEqual(["Is C1 in place?"]);
      expect(await questionsOf(draft.id, cNoQuestion.id)).toEqual([]);

      const body = await (await getAudit(as("INTERNAL_AUDITOR", "GET", `/api/internal-audits/${draft.id}`), ctx(draft.id))).json();
      const byCode = Object.fromEntries(body.internalAudit.controls.map((c: { code: string; questions: string[] }) => [c.code, c.questions]));
      expect(byCode[c1.code]).toEqual(["Is C1 in place?"]);
      expect(byCode[cNoQuestion.code]).toEqual([]);
    });

    it("takes a copy when the Control is added: later edits to the Control don't change the draft", async () => {
      const control = await makeControl("COPY", "PER_SYSTEM", { question: "Original?" });
      const draft = await createDraft({ controlIds: [control.id] });
      await prisma.control.update({ where: { id: control.id }, data: { question: "Edited?" } });
      expect(await questionsOf(draft.id, control.id)).toEqual(["Original?"]);
    });

    it("gives a Control added by an edit its default, keeps the questions of one that stays, and drops those of one removed", async () => {
      const draft = await createDraft({ controlIds: [c1.id, c2.id] });
      expect((await putQuestions(as("INTERNAL_AUDITOR", "PUT", "x", { questions: ["Custom one", "Custom two"] }), qctx(draft.id, c1.id))).status).toBe(200);

      const patch = await patchAudit(
        as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { controlIds: [c1.id, cNoQuestion.id, cOrg.id] }),
        ctx(draft.id),
      );
      expect(patch.status).toBe(200);
      expect(await questionsOf(draft.id, c1.id)).toEqual(["Custom one", "Custom two"]);
      expect(await questionsOf(draft.id, cOrg.id)).toEqual(["Is the policy approved?"]);
      expect(await questionsOf(draft.id, cNoQuestion.id)).toEqual([]);
      expect(await prisma.internalAuditQuestion.count({ where: { internalAuditControl: { internalAuditId: draft.id, controlId: c2.id } } })).toBe(0);

      // Taking C2 off and putting it back starts it from its default again.
      await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { controlIds: [c1.id, c2.id] }), ctx(draft.id));
      expect(await questionsOf(draft.id, c2.id)).toEqual(["Is C2 in place?"]);
    });

    it("replaces the ordered list: edit, add, remove and reorder", async () => {
      const draft = await createDraft();
      const put = (questions: string[]) => putQuestions(as("INTERNAL_AUDITOR", "PUT", "x", { questions }), qctx(draft.id, c1.id));

      const first = await put(["  B?  ", "A?", "C?"]);
      expect(first.status).toBe(200);
      expect((await first.json()).questions).toEqual(["B?", "A?", "C?"]);
      expect(await questionsOf(draft.id, c1.id)).toEqual(["B?", "A?", "C?"]);

      await put(["C?", "B?"]);
      expect(await questionsOf(draft.id, c1.id)).toEqual(["C?", "B?"]);
      await put([]);
      expect(await questionsOf(draft.id, c1.id)).toEqual([]);
    });

    it("refuses a blank question, a wrong body, an unknown audit and a Control that isn't a target, changing nothing", async () => {
      const draft = await createDraft();
      const before = await snapshot();
      const put = (id: string, controlId: string, body: unknown) => putQuestions(as("INTERNAL_AUDITOR", "PUT", "x", body), qctx(id, controlId));

      expect((await put(draft.id, c1.id, { questions: ["ok", "   "] })).status).toBe(400);
      expect((await put(draft.id, c1.id, { questions: "nope" })).status).toBe(400);
      expect((await put(draft.id, c1.id, {})).status).toBe(400);
      expect((await put("no-such-audit", c1.id, { questions: ["q"] })).status).toBe(404);
      expect((await put(draft.id, c2.id, { questions: ["q"] })).status).toBe(404);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("launching", () => {
    it("generates the Check-ups of 2 Controls over 3 Systems plus the Organization, with target and recipient", async () => {
      const draft = await createDraft({ controlIds: [c1.id, c2.id], systemIds: systems, includeOrganization: true });
      await putQuestions(as("INTERNAL_AUDITOR", "PUT", "x", { questions: ["First?", "Second?"] }), qctx(draft.id, c2.id));

      // The preview on the draft says what launch will do.
      const preview = (await (await getAudit(as("INTERNAL_AUDITOR", "GET", `/api/internal-audits/${draft.id}`), ctx(draft.id))).json()).launchPreview;
      expect(preview).toMatchObject({ systemCheckUpCount: 6, organizationCheckUpCount: 1, skippedCount: 0, blockers: [] });

      const response = await launchAs("INTERNAL_AUDITOR", draft.id);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.summary).toMatchObject({ systemCheckUpCount: 6, organizationCheckUpCount: 1, skippedCount: 0 });
      expect(body.internalAudit).toMatchObject({ status: "LAUNCHED", launchedBy: { id: users.INTERNAL_AUDITOR } });
      expect(body.internalAudit.launchedAt).toEqual(expect.any(String));

      const rows = await listCheckUps(draft.id);
      expect(rows).toHaveLength(7);
      // C1 over S1..S3, then C2 over S1..S3 and the Organization.
      expect(rows.map((r) => `${r.control.code}|${r.target.kind === "system" ? r.target.id : "org"}|${r.recipient?.id}`)).toEqual([
        ...systems.map((s, i) => `${c1.code}|${s}|${ownerIds[i]}`),
        ...systems.map((s, i) => `${c2.code}|${s}|${ownerIds[i]}`),
        `${c2.code}|org|${controlOwnerA}`,
      ]);
      expect(rows[0].questions).toEqual(["Is C1 in place?"]);
      expect(rows[6].questions).toEqual(["First?", "Second?"]);

      const stored = await prisma.checkUp.findMany({ where: { internalAuditId: draft.id }, include: { questions: { orderBy: { position: "asc" } } } });
      expect(stored.filter((c) => c.systemId === null)).toHaveLength(1);
      expect(stored.every((c) => c.questions.length > 0)).toBe(true);
    });

    it("skips and counts a System a Control doesn't apply to, and says which", async () => {
      const draft = await createDraft({ controlIds: [c1.id], systemIds: [systems[0], systemOut] });
      const body = await (await launchAs("INTERNAL_AUDITOR", draft.id)).json();
      expect(body.summary).toMatchObject({ systemCheckUpCount: 1, organizationCheckUpCount: 0, skippedCount: 1 });
      expect(body.summary.skipped).toEqual([{ control: expect.objectContaining({ code: c1.code }), systems: [expect.objectContaining({ id: systemOut })] }]);
      expect(await prisma.checkUp.findMany({ where: { internalAuditId: draft.id }, select: { systemId: true } })).toEqual([{ systemId: systems[0] }]);
    });

    it("gives an Organizational Control only an Organization-level Check-up", async () => {
      const draft = await createDraft({ controlIds: [cOrg.id, c1.id], systemIds: [systems[0]], includeOrganization: true });
      expect((await launchAs("INTERNAL_AUDITOR", draft.id)).status).toBe(200);
      const rows = await prisma.checkUp.findMany({ where: { internalAuditId: draft.id }, select: { controlId: true, systemId: true } });
      expect(rows).toHaveLength(2);
      expect(rows).toContainEqual({ controlId: cOrg.id, systemId: null });
      expect(rows).toContainEqual({ controlId: c1.id, systemId: systems[0] });
    });

    it("is refused, with no DB change, while an Organization-level Control has no Control Owner", async () => {
      const noOwner = await makeControl("NOOWNER", "BOTH", { question: "Owned?" });
      await mapControlsToFramework(frameworkId, [noOwner.id]);
      const draft = await createDraft({ controlIds: [noOwner.id, c2.id], systemIds: [systems[0]], includeOrganization: true });
      const before = await snapshot();

      const response = await launchAs("INTERNAL_AUDITOR", draft.id);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain(noOwner.code);
      expect(body.error).not.toContain(c2.code);
      expect(await snapshot()).toEqual(before);
      expect((await prisma.internalAudit.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("DRAFT");

      // The preview names the same Control, and assigning an owner unblocks it.
      const preview = (await (await getAudit(as("INTERNAL_AUDITOR", "GET", `/api/internal-audits/${draft.id}`), ctx(draft.id))).json()).launchPreview;
      expect(preview.blockers).toEqual([expect.objectContaining({ kind: "no-control-owner" })]);
      await prisma.control.update({ where: { id: noOwner.id }, data: { ownerId: controlOwnerB } });
      expect((await launchAs("INTERNAL_AUDITOR", draft.id)).status).toBe(200);
    });

    it("is refused, naming the Control, when a target Control has no question", async () => {
      const draft = await createDraft({ controlIds: [c1.id, cNoQuestion.id] });
      const before = await snapshot();
      const response = await launchAs("INTERNAL_AUDITOR", draft.id);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain(cNoQuestion.code);
      expect(await snapshot()).toEqual(before);

      await putQuestions(as("INTERNAL_AUDITOR", "PUT", "x", { questions: ["Written by the auditor?"] }), qctx(draft.id, cNoQuestion.id));
      expect((await launchAs("INTERNAL_AUDITOR", draft.id)).status).toBe(200);
      const checkUp = await prisma.checkUp.findFirstOrThrow({ where: { internalAuditId: draft.id, controlId: cNoQuestion.id }, include: { questions: true } });
      expect(checkUp.questions.map((q) => q.text)).toEqual(["Written by the auditor?"]);
    });

    it("is refused when the due date has passed since the draft was made, and when nothing would be generated", async () => {
      const lapsed = await createDraft();
      await prisma.internalAudit.update({ where: { id: lapsed.id }, data: { dueDate: new Date(Date.UTC(2020, 0, 1)) } });
      const before = await snapshot();
      const response = await launchAs("INTERNAL_AUDITOR", lapsed.id);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain("past");

      const empty = await createDraft({ controlIds: [c1.id], systemIds: [systemOut] });
      const emptyResponse = await launchAs("INTERNAL_AUDITOR", empty.id);
      expect(emptyResponse.status).toBe(400);
      expect((await emptyResponse.json()).error).toContain("no Check-up");
      expect(await prisma.checkUp.count({ where: { internalAuditId: { in: [lapsed.id, empty.id] } } })).toBe(0);
      expect((await snapshot()).filter((a: { id: string }) => a.id === lapsed.id)).toEqual(before.filter((a: { id: string }) => a.id === lapsed.id));
    });

    it("keeps each Check-up's questions when the Control's Self-Assessment Question is edited afterwards", async () => {
      const control = await makeControl("EDIT", "PER_SYSTEM", { question: "Before?" });
      await mapControlsToFramework(frameworkId, [control.id]);
      const draft = await createDraft({ controlIds: [control.id] });
      await launchAs("INTERNAL_AUDITOR", draft.id);
      await prisma.control.update({ where: { id: control.id }, data: { question: "After?", title: "Renamed" } });
      expect((await listCheckUps(draft.id))[0].questions).toEqual(["Before?"]);
    });

    it("is refused the second time, changing nothing", async () => {
      const draft = await createDraft();
      expect((await launchAs("INTERNAL_AUDITOR", draft.id)).status).toBe(200);
      const before = await snapshot();
      const again = await launchAs("INTERNAL_AUDITOR", draft.id);
      expect(again.status).toBe(409);
      expect(await snapshot()).toEqual(before);
    });

    it("answers 404 for an unknown audit", async () => {
      expect((await launchAs("INTERNAL_AUDITOR", "no-such-audit")).status).toBe(404);
    });

    it("is safe against two launches at once: exactly one wins", async () => {
      const draft = await createDraft({ controlIds: [c1.id], systemIds: systems });
      const results = await Promise.all([launchAs("INTERNAL_AUDITOR", draft.id), launchAs("INTERNAL_AUDITOR", draft.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prisma.checkUp.count({ where: { internalAuditId: draft.id } })).toBe(3);
    });
  });

  describe("a launched audit", () => {
    it("can't be edited or deleted, and its questions can't be changed", async () => {
      const draft = await createDraft({ controlIds: [c1.id, c2.id], systemIds: systems });
      await launchAs("INTERNAL_AUDITOR", draft.id);
      const before = await snapshot();

      const patch = await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { title: "Test 154 Changed" }), ctx(draft.id));
      const controls = await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { controlIds: [c1.id] }), ctx(draft.id));
      const del = await deleteAudit(as("INTERNAL_AUDITOR", "DELETE", `/api/internal-audits/${draft.id}`), ctx(draft.id));
      const put = await putQuestions(as("INTERNAL_AUDITOR", "PUT", "x", { questions: ["Changed?"] }), qctx(draft.id, c1.id));
      expect([patch.status, controls.status, del.status, put.status]).toEqual([409, 409, 409, 409]);
      expect(await snapshot()).toEqual(before);
    });

    it("shows its Check-ups to the reading roles, with the recipient derived now", async () => {
      const draft = await createDraft({ controlIds: [c2.id], systemIds: [systems[0]], includeOrganization: true });
      await launchAs("INTERNAL_AUDITOR", draft.id);

      for (const role of READING) {
        const body = await (await getAudit(as(role, "GET", `/api/internal-audits/${draft.id}`), ctx(draft.id))).json();
        expect(body.launchPreview).toBeNull();
        expect(body.checkUps).toHaveLength(2);
      }
      const recipients = async () => (await listCheckUps(draft.id)).map((r) => r.recipient?.id ?? null);
      expect(await recipients()).toEqual([ownerIds[0], controlOwnerA]);

      // The System's owner and the Control Owner change after launch: the recipient follows.
      await prisma.system.update({ where: { id: systems[0] }, data: { ownerId: ownerIds[2] } });
      await prisma.control.update({ where: { id: c2.id }, data: { ownerId: controlOwnerB } });
      expect(await recipients()).toEqual([ownerIds[2], controlOwnerB]);

      // A Control with its owner cleared since: no recipient (the page says "No Control Owner").
      await prisma.control.update({ where: { id: c2.id }, data: { ownerId: null } });
      expect(await recipients()).toEqual([ownerIds[2], null]);

      await prisma.system.update({ where: { id: systems[0] }, data: { ownerId: ownerIds[0] } });
      await prisma.control.update({ where: { id: c2.id }, data: { ownerId: controlOwnerA } });
    });

    it("can't have its Controls, Systems or the audit deleted from under its Check-ups", async () => {
      const control = await makeControl("KEEP", "BOTH", { question: "Kept?", ownerId: controlOwnerA });
      await mapControlsToFramework(frameworkId, [control.id]);
      const system = await prisma.system.create({ data: { name: `Test 154 System Keep ${SUFFIX}`, ownerId: ownerIds[0], frameworkScopes: { connect: [{ id: frameworkId }] } } });
      const draft = await createDraft({ controlIds: [control.id], systemIds: [system.id], includeOrganization: true });
      await launchAs("INTERNAL_AUDITOR", draft.id);
      const before = await snapshot();

      const refused = async (promise: Promise<unknown>) => {
        const error = await promise.then(() => null, (e) => e);
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2003");
      };
      await refused(prisma.control.delete({ where: { id: control.id } }));
      await refused(prisma.system.delete({ where: { id: system.id } }));
      await refused(prisma.internalAudit.delete({ where: { id: draft.id } }));
      await refused(prisma.user.delete({ where: { id: users.INTERNAL_AUDITOR } }));
      await refused(prisma.internalAuditControl.deleteMany({ where: { internalAuditId: draft.id } }));
      expect(await snapshot()).toEqual(before);
    });

    it("allows one Check-up per audit, Control and target: System-level and Organization-level alike", async () => {
      const draft = await createDraft({ controlIds: [c2.id], systemIds: [systems[0]], includeOrganization: true });
      await launchAs("INTERNAL_AUDITOR", draft.id);
      const duplicate = (systemId: string | null) => prisma.checkUp.create({ data: { internalAuditId: draft.id, controlId: c2.id, systemId } });
      for (const systemId of [systems[0], null]) {
        const error = await duplicate(systemId).then(() => null, (e) => e);
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((error as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      }
      // A different System is a different target, and the pair must be a target Control of the audit.
      await expect(duplicate(systems[1])).resolves.toBeTruthy();
      await expect(prisma.checkUp.create({ data: { internalAuditId: draft.id, controlId: c1.id, systemId: systems[0] } })).rejects.toMatchObject({ code: "P2003" });
    });
  });

  describe("who may edit questions and launch", () => {
    it.each(NOT_WRITING)("%s gets 403 on both, and nothing changes", async (role) => {
      const draft = await createDraft({ controlIds: [c1.id], systemIds: systems });
      const before = await snapshot();
      const put = await putQuestions(as(role, "PUT", "x", { questions: ["Hijacked?"] }), qctx(draft.id, c1.id));
      const launched = await launchAs(role, draft.id);
      expect([put.status, launched.status]).toEqual([403, 403]);
      expect(await snapshot()).toEqual(before);
    });

    it("answers 401 to a request with no acting user", async () => {
      const draft = await createDraft();
      const none = (method: string) => requestAs("/x", null, method, { questions: ["q"] });
      expect((await launch(none("POST"), ctx(draft.id))).status).toBe(401);
      expect((await putQuestions(none("PUT"), qctx(draft.id, c1.id))).status).toBe(401);
    });

    it("lets any Internal Auditor launch a draft another one made", async () => {
      const other = await prisma.user.create({ data: { email: `test-154-other-ia-${SUFFIX}@example.com`, name: "Test 154 Other Auditor", role: "INTERNAL_AUDITOR" } });
      const draft = await createDraft();
      const response = await launch(requestAs("/x", other.id, "POST"), ctx(draft.id));
      expect(response.status).toBe(200);
      expect((await response.json()).internalAudit.launchedBy.id).toBe(other.id);
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInternalAudit } from "@/lib/internal-audits";
import { launchInternalAudit, listCheckUps } from "@/lib/check-ups";
import { checkUpProgress } from "@/lib/check-up-response-rules";
import { getCheckUpTasks, listMyCheckUps } from "@/lib/check-up-tasks";
import { roleView } from "@/app/home/role-view";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { requestAs } from "@/test/provider-fixtures";
import { GET as getCheckUp } from "../[id]/route";
import { PUT as putResponse } from "../[id]/response/route";

/**
 * Answering a Check-up (#155). Fixtures only (CI's database is migrated, not seeded): every name and
 * code carries this run's suffix and every audit is found through this file's own users. The
 * fixture Controls apply to the fixture Systems through a fixture Framework that only the fixture
 * Systems have in scope.
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

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const day = (iso: string, offset: number) => new Date(Date.parse(`${iso}T12:00:00.000Z`) + offset * 86_400_000);

describe("Answering a Check-up (#155)", () => {
  const roleUser = {} as Record<UserRole, string>;
  let ownerA: string; // SYSTEM_OWNER, owns S1
  let ownerB: string; // SYSTEM_OWNER, owns nothing at first
  let cmOwner: string; // COMPLIANCE_MANAGER recorded as owner of S2
  let iaOwner: string; // INTERNAL_AUDITOR recorded as owner of S3
  let controlOwner: string; // RISK_OWNER, owns cBoth and cOrg
  let otherControlOwner: string; // REVIEWER, owns nothing at first
  let cSys: { id: string; code: string };
  let cBoth: { id: string; code: string };
  let cOrg: { id: string; code: string };
  let s1: string;
  let s2: string;
  let s3: string;
  let auditId: string;
  let dueDate: string;
  let checkUps: Awaited<ReturnType<typeof listCheckUps>>;

  const as = (userId: string, method: string, url: string, body?: unknown) => requestAs(url, userId, method, body);
  const find = (code: string, target: string | null) =>
    checkUps.find((c) => c.control.code === code && (target === null ? c.target.kind === "organization" : c.target.kind === "system" && c.target.id === target))!;
  const put = (checkUpId: string, userId: string, body: unknown) =>
    putResponse(as(userId, "PUT", `/api/check-ups/${checkUpId}/response`, body), ctx(checkUpId));
  const read = (checkUpId: string, userId: string) => getCheckUp(as(userId, "GET", `/api/check-ups/${checkUpId}`), ctx(checkUpId));

  /** An answer to every question of the Check-up. */
  async function fullBody(checkUpId: string, overrides: Record<string, unknown> = {}) {
    const questions = await prisma.checkUpQuestion.findMany({ where: { checkUpId }, orderBy: { position: "asc" } });
    return {
      answers: questions.map((q, i) => ({ questionId: q.id, answer: i === 0 ? "YES" : "NO", description: i === 0 ? "" : "We have not done it yet" })),
      evidenceLinks: ["https://example.com/evidence"],
      ...overrides,
    };
  }

  const responseRows = (ids: string[]) =>
    prisma.checkUpResponse.findMany({
      where: { checkUpId: { in: ids } },
      orderBy: { id: "asc" },
      include: { answers: { orderBy: { id: "asc" } } },
    });

  /** Everything a response could change besides itself, for the "touches nothing else" checks. */
  async function elsewhere() {
    const systems = [s1, s2, s3];
    return JSON.parse(
      JSON.stringify({
        assessments: await prisma.controlAssessment.findMany({ where: { systemId: { in: systems } }, orderBy: { id: "asc" } }),
        implementations: await prisma.organizationControlImplementation.findMany({ where: { controlId: { in: [cSys.id, cBoth.id, cOrg.id] } }, orderBy: { id: "asc" } }),
        risks: await prisma.risk.findMany({ where: { systemId: { in: systems } }, orderBy: { id: "asc" } }),
        events: await prisma.changeEvent.findMany({
          where: { OR: [{ systemId: { in: systems } }, { actorId: { in: [...Object.values(roleUser), ownerA, ownerB, cmOwner, iaOwner, controlOwner, otherControlOwner] } }] },
          orderBy: { id: "asc" },
        }),
      }),
    );
  }

  async function makeUser(label: string, role: UserRole) {
    return (await prisma.user.create({ data: { email: `test-155-${label}-${SUFFIX}@example.com`, name: `Test 155 ${label}`, role } })).id;
  }
  async function makeControl(label: string, applicability: "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH", ownerId?: string) {
    const code = `TEST-155-${label}-${SUFFIX}`;
    const control = await prisma.control.create({
      data: { code, title: `Test 155 Control ${label}`, description: "d", category: "Security", applicability, question: `Is ${label} in place?`, ...(ownerId && { ownerId }) },
    });
    return { id: control.id, code };
  }

  beforeAll(async () => {
    for (const role of ROLES) roleUser[role] = await makeUser(role.toLowerCase(), role);
    ownerA = await makeUser("owner-a", "SYSTEM_OWNER");
    ownerB = await makeUser("owner-b", "SYSTEM_OWNER");
    cmOwner = await makeUser("cm-owner", "COMPLIANCE_MANAGER");
    iaOwner = await makeUser("ia-owner", "INTERNAL_AUDITOR");
    controlOwner = await makeUser("control-owner", "RISK_OWNER");
    otherControlOwner = await makeUser("other-control-owner", "REVIEWER");

    cSys = await makeControl("SYS", "PER_SYSTEM");
    cBoth = await makeControl("BOTH", "BOTH", controlOwner);
    cOrg = await makeControl("ORG", "ORGANIZATIONAL", controlOwner);
    const framework = await createFixtureFramework("155");
    await mapControlsToFramework(framework.id, [cSys.id, cBoth.id]);
    const make = async (label: string, ownerId: string) =>
      (await prisma.system.create({ data: { name: `Test 155 System ${label} ${SUFFIX}`, ownerId, frameworkScopes: { connect: [{ id: framework.id }] } } })).id;
    s1 = await make("1", ownerA);
    s2 = await make("2", cmOwner);
    s3 = await make("3", iaOwner);

    // Something for a response not to touch.
    await prisma.controlAssessment.create({ data: { systemId: s1, controlId: cSys.id, status: "IN_PROGRESS", selfAssessmentAnswer: "NO" } });
    await prisma.organizationControlImplementation.create({ data: { controlId: cOrg.id, status: "IN_PROGRESS" } });
    await prisma.risk.create({ data: { systemId: s1, title: "Test 155 Risk", description: "d", severity: "LOW", likelihood: "LOW" } });

    dueDate = future(30);
    const audit = await createInternalAudit(
      { title: "Test 155 Audit", dueDate, includeOrganization: true, controlIds: [cSys.id, cBoth.id, cOrg.id], systemIds: [s1, s2, s3] },
      roleUser.INTERNAL_AUDITOR,
    );
    auditId = audit;
    await launchInternalAudit(auditId, roleUser.INTERNAL_AUDITOR);
    checkUps = await listCheckUps(auditId);
  });

  afterAll(async () => {
    const audits = await prisma.internalAudit.findMany({ where: { createdById: roleUser.INTERNAL_AUDITOR }, select: { id: true } });
    const ids = audits.map((a) => a.id);
    await prisma.checkUp.deleteMany({ where: { internalAuditId: { in: ids } } });
    await prisma.internalAudit.deleteMany({ where: { id: { in: ids } } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: "test-155-", endsWith: `${SUFFIX}@example.com` } } });
  });

  it("launched what the tests below expect: System-level and Organization-level Check-ups", () => {
    // cSys and cBoth apply to the three Systems; cBoth and cOrg are audited for the Organization.
    expect(checkUps).toHaveLength(2 * 3 + 2);
    expect(find(cOrg.code, null).recipient?.id).toBe(controlOwner);
    expect(find(cSys.code, s1).recipient?.id).toBe(ownerA);
  });

  describe("My tasks", () => {
    const mine = async (userId: string, role: UserRole, now?: Date) => {
      const tasks = (await getCheckUpTasks({ id: userId, role }, now)).rows;
      const ids = new Set(checkUps.map((c) => `${c.id}:check-up`));
      return tasks.filter((t) => ids.has(t.id));
    };

    it("shows a System-level Check-up to the System's owner and nobody else", async () => {
      const rows = await mine(ownerA, "SYSTEM_OWNER");
      expect(rows.map((r) => r.id).sort()).toEqual([find(cSys.code, s1).id, find(cBoth.code, s1).id].map((id) => `${id}:check-up`).sort());
      expect(rows[0]).toMatchObject({ kind: "Check-up", status: "Open", tone: "accent" });
      expect(rows[0].href).toMatch(/^\/check-ups\//);
      expect(rows.every((r) => r.subtitle?.includes("Test 155 Audit") && r.subtitle.includes(`due ${dueDate}`))).toBe(true);
      expect(await mine(ownerB, "SYSTEM_OWNER")).toEqual([]);
    });

    it("shows an Organization-level Check-up to the Control Owner and nobody else", async () => {
      const rows = await mine(controlOwner, "RISK_OWNER");
      expect(rows.map((r) => r.id).sort()).toEqual([find(cBoth.code, null).id, find(cOrg.code, null).id].map((id) => `${id}:check-up`).sort());
      expect(rows.every((r) => r.subtitle?.startsWith("Organization"))).toBe(true);
      expect(await mine(otherControlOwner, "REVIEWER")).toEqual([]);
    });

    it("shows nothing to a role that isn't a recipient, the Admin and the Internal Auditor included", async () => {
      for (const role of ROLES) expect(await mine(roleUser[role], role)).toEqual([]);
    });

    it("shows a Compliance Manager recorded as a System's owner its Check-ups, and an Internal Auditor none", async () => {
      expect((await mine(cmOwner, "COMPLIANCE_MANAGER")).length).toBe(2);
      expect(await mine(iaOwner, "INTERNAL_AUDITOR")).toEqual([]);
      expect(await listMyCheckUps({ id: iaOwner, role: "INTERNAL_AUDITOR" })).toEqual([]);
    });

    it("is on /home for any role, merged with the role's own tasks", async () => {
      const owner = await roleView({ id: ownerA, name: "A", role: "SYSTEM_OWNER" });
      expect(owner.tasks?.filter((t) => t.kind === "Check-up").length).toBeGreaterThanOrEqual(2);
      expect(owner.tiles.map((t) => t.title)).toContain("Your Check-ups");

      const risk = await roleView({ id: controlOwner, name: "C", role: "RISK_OWNER" });
      expect(risk.tasks?.filter((t) => t.kind === "Check-up").length).toBeGreaterThanOrEqual(2);

      const admin = await roleView({ id: roleUser.ADMIN, name: "Admin", role: "ADMIN" });
      expect(admin.tasks?.some((t) => t.kind === "Check-up" && checkUps.some((c) => t.id.startsWith(c.id)))).toBeFalsy();
      expect(admin.tiles.map((t) => t.title)).not.toContain("Your Check-ups");

      const viewer = await roleView({ id: roleUser.VIEWER, name: "V", role: "VIEWER" });
      expect(viewer.tasks).toEqual([]);

      const auditor = await roleView({ id: iaOwner, name: "I", role: "INTERNAL_AUDITOR" });
      expect(auditor.tasks?.some((t) => t.kind === "Check-up")).toBeFalsy();
    });

    it("marks a task overdue the day after the audit's due date, and not on it", async () => {
      const status = async (now: Date) => (await mine(ownerA, "SYSTEM_OWNER", now))[0];
      expect(await status(day(dueDate, -1))).toMatchObject({ status: "Open", tone: "accent" }); // due tomorrow
      expect(await status(day(dueDate, 0))).toMatchObject({ status: "Open", tone: "accent" }); // due today
      expect(await status(day(dueDate, 1))).toMatchObject({ status: "Overdue", tone: "danger" }); // due yesterday
    });

    it("marks the audit page's rows and counts overdue the same way", async () => {
      const progress = async (now: Date) => checkUpProgress(await listCheckUps(auditId, now));
      expect((await progress(day(dueDate, 0))).overdue).toBe(0);
      expect(await progress(day(dueDate, 1))).toMatchObject({ sent: 8, overdue: 8, answered: 0 });
    });
  });

  describe("answering", () => {
    it("creates the response of a System-level Check-up for its System's owner", async () => {
      const target = find(cSys.code, s1);
      const before = await elsewhere();
      const response = await put(target.id, ownerA, await fullBody(target.id));
      expect(response.status).toBe(201);

      const [row] = await responseRows([target.id]);
      expect(row).toMatchObject({ respondedById: ownerA, lastChangedById: ownerA, evidenceLinks: ["https://example.com/evidence"] });
      expect(row.answers).toHaveLength(1);
      expect(row.answers[0]).toMatchObject({ answer: "YES", description: "" });
      // Submitting changes no status anywhere: no Assessment, implementation, Risk or Change Event.
      expect(await elsewhere()).toEqual(before);
    });

    it("moves the audit page's counts and the task list", async () => {
      const rows = await listCheckUps(auditId);
      expect(checkUpProgress(rows)).toMatchObject({ sent: 8, answered: 1, open: 7 });
      expect(rows.find((r) => r.id === find(cSys.code, s1).id)).toMatchObject({ answered: true, response: { respondedByName: "Test 155 owner-a" } });
      const tasks = (await getCheckUpTasks({ id: ownerA, role: "SYSTEM_OWNER" })).rows;
      expect(tasks.map((t) => t.id)).not.toContain(`${find(cSys.code, s1).id}:check-up`);
      expect(tasks.map((t) => t.id)).toContain(`${find(cBoth.code, s1).id}:check-up`);
      // The answered one stays reachable from "Your Check-ups", and is no longer overdue.
      const mineAll = await listMyCheckUps({ id: ownerA, role: "SYSTEM_OWNER" }, day(dueDate, 5));
      expect(mineAll.find((c) => c.id === find(cSys.code, s1).id)).toMatchObject({ answered: true, open: false, overdue: false });
      expect((await getCheckUpTasks({ id: ownerA, role: "SYSTEM_OWNER" })).total).toBe(2);
    });

    it("changes a submitted response, replacing its answers and links", async () => {
      const target = find(cSys.code, s1);
      const [first] = await responseRows([target.id]);
      const body = await fullBody(target.id);
      body.answers[0] = { ...body.answers[0], answer: "NA", description: "Not relevant here" };
      const response = await put(target.id, ownerA, { ...body, evidenceLinks: [" https://example.com/a ", "https://example.com/a", "http://example.com/b"] });
      expect(response.status).toBe(200);

      const rows = await responseRows([target.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(first.id);
      expect(rows[0].answers).toHaveLength(1);
      expect(rows[0].answers[0]).toMatchObject({ answer: "NA", description: "Not relevant here" });
      expect(rows[0].evidenceLinks).toEqual(["https://example.com/a", "http://example.com/b"]);
      expect(rows[0].respondedAt).toEqual(first.respondedAt);
    });

    it("answers an Organization-level Check-up for its Control Owner, leaving the implementation alone", async () => {
      const target = find(cOrg.code, null);
      const before = await elsewhere();
      expect((await put(target.id, controlOwner, await fullBody(target.id))).status).toBe(201);
      expect(await elsewhere()).toEqual(before);
      expect(before.implementations).toHaveLength(1);
    });

    it("lets a Compliance Manager recorded as a System's owner answer, and refuses an Internal Auditor", async () => {
      const cm = find(cSys.code, s2);
      expect((await put(cm.id, cmOwner, await fullBody(cm.id))).status).toBe(201);

      const ia = find(cSys.code, s3);
      const before = await responseRows([ia.id]);
      const refused = await put(ia.id, iaOwner, await fullBody(ia.id));
      expect(refused.status).toBe(403);
      expect(await responseRows([ia.id])).toEqual(before);
      expect(before).toEqual([]);
    });
  });

  describe("validation", () => {
    it("requires every question to be answered, and names what is missing", async () => {
      const target = find(cBoth.code, s1);
      const response = await put(target.id, ownerA, { answers: [], evidenceLinks: [] });
      expect(response.status).toBe(400);
      expect((await response.json()).problems).toEqual(["Question 1 needs an answer: Yes, No or N/A"]);
      expect(await responseRows([target.id])).toEqual([]);
    });

    it("requires a description for No and N/A and refuses an unknown answer or question", async () => {
      const target = find(cBoth.code, s1);
      const [q] = await prisma.checkUpQuestion.findMany({ where: { checkUpId: target.id } });
      for (const answers of [
        [{ questionId: q.id, answer: "NO", description: "  " }],
        [{ questionId: q.id, answer: "MAYBE", description: "x" }],
        [{ questionId: q.id, answer: "YES" }, { questionId: "not-a-question", answer: "YES" }],
        [{ questionId: q.id, answer: "YES" }, { questionId: q.id, answer: "NO", description: "x" }],
      ]) {
        expect((await put(target.id, ownerA, { answers })).status).toBe(400);
      }
      expect(await responseRows([target.id])).toEqual([]);
    });

    it.each([
      "javascript:alert(1)",
      "data:text/html,hi",
      "file:///etc/passwd",
      "ftp://example.com/x",
      "/relative",
      "example.com/no-scheme",
      "not a url",
    ])("refuses the evidence link %s, changing nothing", async (link) => {
      const target = find(cBoth.code, s1);
      const response = await put(target.id, ownerA, await fullBody(target.id, { evidenceLinks: ["https://example.com/fine", link] }));
      expect(response.status).toBe(400);
      expect(await responseRows([target.id])).toEqual([]);
    });

    it("refuses an over-long evidence link, changing nothing", async () => {
      const target = find(cBoth.code, s1);
      const response = await put(target.id, ownerA, await fullBody(target.id, { evidenceLinks: [`https://example.com/${"a".repeat(2100)}`] }));
      expect(response.status).toBe(400);
      expect(await responseRows([target.id])).toEqual([]);
    });

    it("refuses more than ten links, and a body of the wrong shape", async () => {
      const target = find(cBoth.code, s1);
      const many = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
      expect((await put(target.id, ownerA, await fullBody(target.id, { evidenceLinks: many }))).status).toBe(400);
      expect((await put(target.id, ownerA, { answers: "nope" })).status).toBe(400);
      expect(await responseRows([target.id])).toEqual([]);
    });

    it("accepts a response with no evidence links", async () => {
      const target = find(cBoth.code, s1);
      expect((await put(target.id, ownerA, await fullBody(target.id, { evidenceLinks: [] }))).status).toBe(201);
      expect((await responseRows([target.id]))[0].evidenceLinks).toEqual([]);
    });
  });

  describe("who may answer", () => {
    it("refuses everyone but the recipient with a 403 and no DB change, the Admin included", async () => {
      const target = find(cBoth.code, s2); // System 2's owner is cmOwner
      const before = await responseRows([target.id]);
      const body = await fullBody(target.id);
      for (const userId of [...Object.values(roleUser), ownerA, ownerB, controlOwner, otherControlOwner]) {
        expect((await put(target.id, userId, body)).status).toBe(403);
      }
      expect(await responseRows([target.id])).toEqual(before);

      const org = find(cBoth.code, null);
      for (const userId of [...Object.values(roleUser), ownerA, otherControlOwner]) {
        expect((await put(org.id, userId, await fullBody(org.id))).status).toBe(403);
      }
      expect(await responseRows([org.id])).toEqual([]);
    });

    it("answers 401 without an acting user and 404 for a Check-up that doesn't exist", async () => {
      const target = find(cBoth.code, s1);
      expect((await putResponse(requestAs(`/api/check-ups/${target.id}/response`, null, "PUT", {}), ctx(target.id))).status).toBe(401);
      expect((await put("no-such-check-up", ownerA, {})).status).toBe(404);
    });

    it("lets nobody answer an Organization-level Check-up whose Control has no Control Owner", async () => {
      const target = find(cOrg.code, null);
      await prisma.checkUpResponse.deleteMany({ where: { checkUpId: target.id } });
      await prisma.control.update({ where: { id: cOrg.id }, data: { ownerId: null } });
      try {
        for (const userId of [controlOwner, roleUser.ADMIN, otherControlOwner]) {
          expect((await put(target.id, userId, await fullBody(target.id))).status).toBe(403);
        }
        expect(await responseRows([target.id])).toEqual([]);
        expect((await listCheckUps(auditId)).find((c) => c.id === target.id)?.recipient).toBeNull();
      } finally {
        await prisma.control.update({ where: { id: cOrg.id }, data: { ownerId: controlOwner } });
      }
    });

    it("follows a change of System owner: the new owner gets the task and may change the response, the old one may not", async () => {
      const target = find(cSys.code, s1); // answered by ownerA above
      await prisma.system.update({ where: { id: s1 }, data: { ownerId: ownerB } });
      try {
        expect((await put(target.id, ownerA, await fullBody(target.id))).status).toBe(403);
        expect((await read(target.id, ownerA)).status).toBe(403);

        // Both of System 1's Check-ups are answered by now, so they sit in "Your Check-ups", not in the tasks.
        expect((await listMyCheckUps({ id: ownerB, role: "SYSTEM_OWNER" })).map((c) => c.id)).toContain(target.id);
        expect(await listMyCheckUps({ id: ownerA, role: "SYSTEM_OWNER" })).toEqual([]);

        expect((await read(target.id, ownerB)).status).toBe(200);
        const body = await fullBody(target.id);
        body.answers[0] = { ...body.answers[0], answer: "YES", description: "Changed by the new owner" };
        expect((await put(target.id, ownerB, body)).status).toBe(200);
        const [row] = await responseRows([target.id]);
        expect(row).toMatchObject({ respondedById: ownerA, lastChangedById: ownerB });
      } finally {
        await prisma.system.update({ where: { id: s1 }, data: { ownerId: ownerA } });
      }
    });

    it("follows a change of Control Owner", async () => {
      const target = find(cBoth.code, null);
      await prisma.control.update({ where: { id: cBoth.id }, data: { ownerId: otherControlOwner } });
      try {
        expect((await getCheckUpTasks({ id: otherControlOwner, role: "REVIEWER" })).rows.map((t) => t.id)).toContain(`${target.id}:check-up`);
        expect((await getCheckUpTasks({ id: controlOwner, role: "RISK_OWNER" })).rows.map((t) => t.id)).not.toContain(`${target.id}:check-up`);
        expect((await put(target.id, controlOwner, await fullBody(target.id))).status).toBe(403);
        expect((await put(target.id, otherControlOwner, await fullBody(target.id))).status).toBe(201);
      } finally {
        await prisma.control.update({ where: { id: cBoth.id }, data: { ownerId: controlOwner } });
      }
    });

    it("refuses a Check-up of an audit that is not launched, but still reads it", async () => {
      const target = find(cBoth.code, s1);
      const before = await responseRows([target.id]);
      await prisma.internalAudit.update({ where: { id: auditId }, data: { status: "CLOSED" } });
      try {
        const refused = await put(target.id, ownerA, await fullBody(target.id));
        expect(refused.status).toBe(409);
        expect(await responseRows([target.id])).toEqual(before);
        expect((await read(target.id, ownerA)).status).toBe(200);
        expect((await getCheckUpTasks({ id: ownerA, role: "SYSTEM_OWNER" })).rows.map((t) => t.id)).not.toContain(`${target.id}:check-up`);
      } finally {
        await prisma.internalAudit.update({ where: { id: auditId }, data: { status: "LAUNCHED" } });
      }
    });
  });

  describe("who reads a Check-up and its response", () => {
    it("shows it to the recipient and the audit-reading roles, with the response and its links", async () => {
      const target = find(cSys.code, s2); // answered by cmOwner above
      for (const userId of [cmOwner, ...READING.map((role) => roleUser[role])]) {
        const response = await read(target.id, userId);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.checkUp.response).toMatchObject({ respondedBy: { id: cmOwner }, evidenceLinks: ["https://example.com/evidence"] });
        expect(body.checkUp.questions[0].answer.answer).toBe("YES");
        expect(body.canAnswer).toBe(userId === cmOwner);
      }
    });

    it("refuses everyone else with a 403, and a Check-up that doesn't exist with a 404", async () => {
      const target = find(cSys.code, s2);
      for (const role of ["SYSTEM_OWNER", "REVIEWER", "BUSINESS_RISK_OWNER", "VIEWER"] as UserRole[]) {
        expect((await read(target.id, roleUser[role])).status).toBe(403);
      }
      expect((await read(target.id, ownerB)).status).toBe(403);
      expect((await read("no-such-check-up", roleUser.ADMIN)).status).toBe(404);
    });

    it("never hands out a stored link that isn't http(s)", async () => {
      const target = find(cSys.code, s2);
      await prisma.checkUpResponse.updateMany({ where: { checkUpId: target.id }, data: { evidenceLinks: ["javascript:alert(1)", "https://example.com/ok"] } });
      const body = await (await read(target.id, roleUser.ADMIN)).json();
      expect(body.checkUp.response.evidenceLinks).toEqual(["https://example.com/ok"]);
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { GET as listAudits, POST as createAudit } from "../route";
import { GET as getAudit, PATCH as patchAudit, DELETE as deleteAudit } from "../[id]/route";

/**
 * Internal Audits (#152): the draft's CRUD and who may do what. Fixtures only (CI's database
 * is migrated but not seeded). The Controls here are unmapped, which is fine: an audit
 * targets Controls directly, whether or not they apply to anything.
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
const NOT_READING = ROLES.filter((role) => !READING.includes(role));
const NOT_WRITING = ROLES.filter((role) => role !== "INTERNAL_AUDITOR");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

function future(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("/api/internal-audits (#152)", () => {
  const users = {} as Record<UserRole, string>;
  let otherAuditorId: string;
  let controlA: { id: string; code: string };
  let controlB: { id: string; code: string };
  let orgControl: { id: string; code: string };
  let systemA: string;
  let systemB: string;
  const extraUserIds: string[] = [];

  async function makeControl(label: string, applicability: "ORGANIZATIONAL" | "PER_SYSTEM" | "BOTH") {
    const code = `TEST-152-${label}-${SUFFIX}`;
    const control = await prisma.control.create({
      data: { code, title: `Test 152 Control ${label}`, description: "d", category: "Security", applicability },
    });
    return { id: control.id, code };
  }

  /** This file's audits only: other 152 test files create audits of their own, in parallel. */
  const ownAudits = () => ({ createdById: { in: [...Object.values(users), otherAuditorId] } });

  /** Everything a write could change, for the "no DB change" checks. */
  async function snapshot() {
    return JSON.parse(
      JSON.stringify(
        await prisma.internalAudit.findMany({
          where: ownAudits(),
          orderBy: { id: "asc" },
          include: { controls: { orderBy: { id: "asc" } }, systems: { orderBy: { id: "asc" } } },
        }),
      ),
    );
  }

  function as(role: UserRole, method: string, url: string, body?: unknown) {
    return requestAs(url, users[role], method, body);
  }

  const goodBody = () => ({
    title: "Test 152 Access review",
    scopeDescription: "Privileged access",
    dueDate: future(30),
    includeOrganization: false,
    controlIds: [controlA.id],
    systemIds: [systemA],
  });

  /** Creates a draft straight through the route as the Internal Auditor. */
  async function createDraft(overrides: Record<string, unknown> = {}) {
    const response = await createAudit(as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", { ...goodBody(), ...overrides }));
    expect(response.status).toBe(201);
    return (await response.json()).internalAudit as { id: string };
  }

  beforeAll(async () => {
    for (const role of ROLES) {
      const user = await prisma.user.create({
        data: { email: `test-152-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test 152 ${role}`, role },
      });
      users[role] = user.id;
    }
    const other = await prisma.user.create({
      data: { email: `test-152-other-ia-${SUFFIX}@example.com`, name: "Test 152 Other Auditor", role: "INTERNAL_AUDITOR" },
    });
    otherAuditorId = other.id;
    extraUserIds.push(other.id);

    controlA = await makeControl("A", "PER_SYSTEM");
    controlB = await makeControl("B", "BOTH");
    orgControl = await makeControl("ORG", "ORGANIZATIONAL");
    const owner = users.SYSTEM_OWNER;
    systemA = (await prisma.system.create({ data: { name: `Test 152 System A ${SUFFIX}`, ownerId: owner } })).id;
    systemB = (await prisma.system.create({ data: { name: `Test 152 System B ${SUFFIX}`, ownerId: owner, status: "ONBOARDED" } })).id;
  });

  afterAll(async () => {
    await prisma.internalAudit.deleteMany({ where: ownAudits() });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { id: { in: [...Object.values(users), ...extraUserIds] } } });
  });

  describe("who may write", () => {
    it.each(NOT_WRITING)("%s gets 403 on POST, PATCH and DELETE, and nothing changes", async (role) => {
      const draft = await createDraft({ title: `Test 152 Guarded ${role}` });
      const before = await snapshot();

      const post = await createAudit(as(role, "POST", "/api/internal-audits", goodBody()));
      const patch = await patchAudit(as(role, "PATCH", `/api/internal-audits/${draft.id}`, { title: "Test 152 Hijacked" }), ctx(draft.id));
      const del = await deleteAudit(as(role, "DELETE", `/api/internal-audits/${draft.id}`), ctx(draft.id));

      expect([post.status, patch.status, del.status]).toEqual([403, 403, 403]);
      expect(await snapshot()).toEqual(before);
    });

    it("answers 401 to a request with no acting user", async () => {
      const unauthenticated = (method: string, url: string, body?: unknown) => requestAs(url, null, method, body);
      expect((await listAudits(unauthenticated("GET", "/api/internal-audits"))).status).toBe(401);
      expect((await createAudit(unauthenticated("POST", "/api/internal-audits", goodBody()))).status).toBe(401);
    });
  });

  describe("who may read", () => {
    it.each(READING)("%s can list and open an audit", async (role) => {
      const draft = await createDraft({ title: `Test 152 Readable ${role}` });

      const list = await listAudits(as(role, "GET", "/api/internal-audits"));
      expect(list.status).toBe(200);
      const listed = (await list.json()).internalAudits as { id: string; title: string }[];
      expect(listed.map((audit) => audit.id)).toContain(draft.id);

      const one = await getAudit(as(role, "GET", `/api/internal-audits/${draft.id}`), ctx(draft.id));
      expect(one.status).toBe(200);
      expect((await one.json()).internalAudit).toMatchObject({ id: draft.id, status: "DRAFT" });
    });

    it.each(NOT_READING)("%s gets 403 on the list and on an audit", async (role) => {
      const draft = await createDraft({ title: `Test 152 Hidden ${role}` });
      expect((await listAudits(as(role, "GET", "/api/internal-audits"))).status).toBe(403);
      expect((await getAudit(as(role, "GET", `/api/internal-audits/${draft.id}`), ctx(draft.id))).status).toBe(403);
    });

    it("answers 404 for an audit that doesn't exist", async () => {
      const response = await getAudit(as("ADMIN", "GET", "/api/internal-audits/nope"), ctx("nope"));
      expect(response.status).toBe(404);
    });
  });

  describe("create", () => {
    it("creates a draft with its Controls and hand-picked Systems", async () => {
      const response = await createAudit(
        as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", {
          ...goodBody(),
          title: "  Test 152 Created  ",
          controlIds: [controlA.id, controlB.id, controlA.id],
          systemIds: [systemA, systemB],
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.internalAudit).toMatchObject({
        title: "Test 152 Created",
        scopeDescription: "Privileged access",
        status: "DRAFT",
        includeOrganization: false,
        createdBy: { id: users.INTERNAL_AUDITOR },
      });
      expect(body.internalAudit.dueDate).toBe(future(30));
      expect(body.internalAudit.controls.map((c: { code: string }) => c.code)).toEqual([controlA.code, controlB.code]);
      expect(body.internalAudit.systems.map((s: { id: string }) => s.id).sort()).toEqual([systemA, systemB].sort());
    });

    it("accepts the Organization instead of any System", async () => {
      const response = await createAudit(
        as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", {
          ...goodBody(),
          title: "Test 152 Org only",
          systemIds: [],
          includeOrganization: true,
          controlIds: [orgControl.id],
        }),
      );
      expect(response.status).toBe(201);
      expect((await response.json()).internalAudit).toMatchObject({ includeOrganization: true, systems: [] });
    });

    it("accepts a due date of today", async () => {
      const response = await createAudit(as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", { ...goodBody(), title: "Test 152 Today", dueDate: future(0) }));
      expect(response.status).toBe(201);
    });

    it.each([
      ["a blank title", { title: "   " }, /title/i],
      ["no title", { title: undefined }, /title/i],
      ["no Control", { controlIds: [] }, /Control/],
      ["no due date", { dueDate: null }, /due date/i],
      ["neither a System nor the Organization", { systemIds: [], includeOrganization: false }, /System or include the Organization/],
      ["a past due date", { dueDate: "2001-01-01" }, /past/i],
      ["an impossible due date", { dueDate: "2026-02-31" }, /valid date/i],
      ["an unknown Control", { controlIds: ["nope"] }, /Controls don't exist/],
      ["an unknown System", { systemIds: ["nope"] }, /Systems don't exist/],
    ])("refuses %s with a 400 naming it, and creates nothing", async (_name, overrides, message) => {
      const before = await snapshot();
      const response = await createAudit(
        as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", { ...goodBody(), title: "Test 152 Invalid", ...overrides }),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(message);
      expect(await snapshot()).toEqual(before);
    });

    it("names every missing thing at once", async () => {
      const response = await createAudit(as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", {}));
      const body = await response.json();
      expect(response.status).toBe(400);
      expect(body.problems).toHaveLength(4);
    });

    it("refuses a body of the wrong shape", async () => {
      const response = await createAudit(as("INTERNAL_AUDITOR", "POST", "/api/internal-audits", { ...goodBody(), controlIds: "all" }));
      expect(response.status).toBe(400);
    });
  });

  describe("edit", () => {
    it("changes the fields, the Controls and the Systems, by any Internal Auditor", async () => {
      const draft = await createDraft({ title: "Test 152 Edit me", controlIds: [controlA.id], systemIds: [systemA] });
      const controlRowBefore = await prisma.internalAuditControl.findFirstOrThrow({ where: { internalAuditId: draft.id, controlId: controlA.id } });
      const otherAuditor = await prisma.user.findUniqueOrThrow({ where: { id: otherAuditorId } });

      const response = await patchAudit(
        requestAs(`/api/internal-audits/${draft.id}`, otherAuditor.id, "PATCH", {
          title: "Test 152 Edited",
          scopeDescription: "New scope",
          dueDate: future(60),
          includeOrganization: true,
          controlIds: [controlA.id, controlB.id],
          systemIds: [systemB],
        }),
        ctx(draft.id),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.internalAudit).toMatchObject({
        title: "Test 152 Edited",
        scopeDescription: "New scope",
        dueDate: future(60),
        includeOrganization: true,
        createdBy: { id: users.INTERNAL_AUDITOR },
      });
      expect(body.internalAudit.controls.map((c: { id: string }) => c.id).sort()).toEqual([controlA.id, controlB.id].sort());
      expect(body.internalAudit.systems.map((s: { id: string }) => s.id)).toEqual([systemB]);
      // The pair that stayed keeps its row, so anything hung off it later survives an edit.
      const controlRowAfter = await prisma.internalAuditControl.findFirstOrThrow({ where: { internalAuditId: draft.id, controlId: controlA.id } });
      expect(controlRowAfter.id).toBe(controlRowBefore.id);
    });

    it("leaves the Controls and Systems alone when they aren't in the body", async () => {
      const draft = await createDraft({ title: "Test 152 Partial" });
      const response = await patchAudit(
        as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { title: "Test 152 Partial renamed" }),
        ctx(draft.id),
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.internalAudit.controls).toHaveLength(1);
      expect(body.internalAudit.systems).toHaveLength(1);
    });

    it("keeps a past due date that isn't being changed, but refuses changing it to a past one", async () => {
      const draft = await createDraft({ title: "Test 152 Old date" });
      await prisma.internalAudit.update({ where: { id: draft.id }, data: { dueDate: new Date("2001-01-01T00:00:00Z") } });

      const unchanged = await patchAudit(
        as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { title: "Test 152 Old date renamed", dueDate: "2001-01-01" }),
        ctx(draft.id),
      );
      expect(unchanged.status).toBe(200);

      const changed = await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { dueDate: "2002-02-02" }), ctx(draft.id));
      expect(changed.status).toBe(400);
    });

    it.each([
      ["a blank title", { title: " " }, /title/i],
      ["removing every Control", { controlIds: [] }, /Control/],
      ["a past due date", { dueDate: "2001-01-01" }, /past/i],
      ["removing the last System without the Organization", { systemIds: [] }, /System or include the Organization/],
      ["an unknown System", { systemIds: ["nope"] }, /Systems don't exist/],
    ])("refuses %s with a 400 and changes nothing", async (_name, patch, message) => {
      const draft = await createDraft({ title: "Test 152 Stay valid" });
      const before = await snapshot();
      const response = await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, patch), ctx(draft.id));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(message);
      expect(await snapshot()).toEqual(before);
    });

    it("allows dropping the last System when the Organization is included in the same edit", async () => {
      const draft = await createDraft({ title: "Test 152 Org swap" });
      const response = await patchAudit(
        as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { systemIds: [], includeOrganization: true }),
        ctx(draft.id),
      );
      expect(response.status).toBe(200);
    });

    it("refuses an empty edit, and 404s on a missing audit", async () => {
      const draft = await createDraft({ title: "Test 152 Empty edit" });
      expect((await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, {}), ctx(draft.id))).status).toBe(400);
      expect((await patchAudit(as("INTERNAL_AUDITOR", "PATCH", "/api/internal-audits/nope", { title: "x" }), ctx("nope"))).status).toBe(404);
    });

    it("refuses to edit or delete an audit that is no longer a draft", async () => {
      const draft = await createDraft({ title: "Test 152 Launched" });
      await prisma.internalAudit.update({ where: { id: draft.id }, data: { status: "LAUNCHED" } });
      const before = await snapshot();

      const patch = await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { title: "Test 152 Launched edited" }), ctx(draft.id));
      const del = await deleteAudit(as("INTERNAL_AUDITOR", "DELETE", `/api/internal-audits/${draft.id}`), ctx(draft.id));

      expect([patch.status, del.status]).toEqual([409, 409]);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("delete", () => {
    it("deletes a draft with its Control and System rows, leaving the Controls and Systems", async () => {
      const draft = await createDraft({ title: "Test 152 Delete me" });

      const response = await deleteAudit(as("INTERNAL_AUDITOR", "DELETE", `/api/internal-audits/${draft.id}`), ctx(draft.id));

      expect(response.status).toBe(204);
      expect(await prisma.internalAudit.count({ where: { id: draft.id } })).toBe(0);
      expect(await prisma.internalAuditControl.count({ where: { internalAuditId: draft.id } })).toBe(0);
      expect(await prisma.internalAuditSystem.count({ where: { internalAuditId: draft.id } })).toBe(0);
      expect(await prisma.control.count({ where: { id: controlA.id } })).toBe(1);
      expect(await prisma.system.count({ where: { id: systemA } })).toBe(1);
    });

    it("404s on a missing audit", async () => {
      expect((await deleteAudit(as("INTERNAL_AUDITOR", "DELETE", "/api/internal-audits/nope"), ctx("nope"))).status).toBe(404);
    });
  });

  describe("deleting a Control or a System a draft references", () => {
    it("takes the Control or System off the draft; the draft stays, and shows the rest", async () => {
      const extraControl = await makeControl("GONE", "PER_SYSTEM");
      const extraSystem = await prisma.system.create({ data: { name: `Test 152 System Gone ${SUFFIX}`, ownerId: users.SYSTEM_OWNER } });
      const draft = await createDraft({
        title: "Test 152 Dangling",
        controlIds: [controlA.id, extraControl.id],
        systemIds: [systemA, extraSystem.id],
      });

      await prisma.control.delete({ where: { id: extraControl.id } });
      await prisma.system.delete({ where: { id: extraSystem.id } });

      const response = await getAudit(as("ADMIN", "GET", `/api/internal-audits/${draft.id}`), ctx(draft.id));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.internalAudit.controls.map((c: { id: string }) => c.id)).toEqual([controlA.id]);
      expect(body.internalAudit.systems.map((s: { id: string }) => s.id)).toEqual([systemA]);
    });

    it("leaves a draft invalid until edited when its only Control is deleted; it stays listed and can be repaired", async () => {
      const lonely = await makeControl("LONELY", "PER_SYSTEM");
      const draft = await createDraft({ title: "Test 152 Lonely", controlIds: [lonely.id] });
      await prisma.control.delete({ where: { id: lonely.id } });

      const list = await listAudits(as("ADMIN", "GET", "/api/internal-audits"));
      const listed = (await list.json()).internalAudits as { id: string; controlCount: number }[];
      expect(listed.find((audit) => audit.id === draft.id)?.controlCount).toBe(0);

      const rename = await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { title: "Test 152 Lonely renamed" }), ctx(draft.id));
      expect(rename.status).toBe(400);
      const repair = await patchAudit(as("INTERNAL_AUDITOR", "PATCH", `/api/internal-audits/${draft.id}`, { controlIds: [controlB.id] }), ctx(draft.id));
      expect(repair.status).toBe(200);
    });
  });

  describe("the list", () => {
    it("shows each audit's title, due date, state and counts", async () => {
      const draft = await createDraft({ title: "Test 152 Listed", controlIds: [controlA.id, controlB.id], systemIds: [systemA] });
      const list = await listAudits(as("INTERNAL_AUDITOR", "GET", "/api/internal-audits"));
      const row = ((await list.json()).internalAudits as Record<string, unknown>[]).find((audit) => audit.id === draft.id);
      expect(row).toMatchObject({
        title: "Test 152 Listed",
        dueDate: future(30),
        status: "DRAFT",
        controlCount: 2,
        systemCount: 1,
        createdBy: { id: users.INTERNAL_AUDITOR },
      });
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { InternalAuditStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { PATCH as patchAudit } from "../[id]/route";
import { POST as addSystems } from "../[id]/systems/route";

/**
 * Adding Systems to a Draft Internal Audit (#234): the Systems list's bulk "Add to Internal Audit".
 * Fixtures only (CI's database is migrated but not seeded). The audits carry no Controls: the add
 * touches the System set alone.
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
const NOT_WRITING = ROLES.filter((role) => role !== "INTERNAL_AUDITOR");

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

describe("POST /api/internal-audits/[id]/systems (#234)", () => {
  const users = {} as Record<UserRole, string>;
  let s1: string;
  let s2: string;
  let s3: string;
  let controlId: string;

  const as = (role: UserRole, id: string, body?: unknown) => requestAs(`/api/internal-audits/${id}/systems`, users[role], "POST", body);
  const post = (id: string, body?: unknown, role: UserRole = "INTERNAL_AUDITOR") => addSystems(as(role, id, body), ctx(id));

  /** One Organizational Control, so that a later replace of the Systems passes validation. */
  async function makeAudit(label: string, systemIds: string[], status: InternalAuditStatus = "DRAFT") {
    const audit = await prisma.internalAudit.create({
      data: {
        title: `Test #234 ${label} ${SUFFIX}`,
        dueDate: new Date("2099-01-01T00:00:00.000Z"),
        status,
        createdById: users.INTERNAL_AUDITOR,
        controls: { create: [{ controlId }] },
        systems: { create: systemIds.map((systemId) => ({ systemId })) },
      },
    });
    return audit.id;
  }

  const systemsOf = async (id: string) =>
    (await prisma.internalAuditSystem.findMany({ where: { internalAuditId: id }, select: { systemId: true } })).map((row) => row.systemId).sort();

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (
        await prisma.user.create({ data: { email: `test-234-${role.toLowerCase()}-${SUFFIX}@example.com`, name: `Test #234 ${role}`, role } })
      ).id;
    }
    const make = async (name: string) =>
      (await prisma.system.create({ data: { name: `Test #234 System ${name} ${SUFFIX}`, ownerId: users.SYSTEM_OWNER } })).id;
    controlId = (
      await prisma.control.create({
        data: { code: `TEST-234-${SUFFIX}`, title: "Test #234 Control", description: "d", category: "Security", applicability: "ORGANIZATIONAL" },
      })
    ).id;
    [s1, s2, s3] = [await make("1"), await make("2"), await make("3")];
  });

  afterAll(async () => {
    await prisma.internalAudit.deleteMany({ where: { createdById: users.INTERNAL_AUDITOR } });
    await prisma.system.deleteMany({ where: { name: { endsWith: SUFFIX } } });
    await prisma.control.deleteMany({ where: { code: { endsWith: SUFFIX } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  it("adds the Systems to a draft and keeps the ones it has", async () => {
    const id = await makeAudit("keeps", [s1]);

    const response = await post(id, { systemIds: [s2, s3] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ added: 2, skipped: 0 });
    expect(body.internalAudit.systems.map((s: { id: string }) => s.id).sort()).toEqual([s1, s2, s3].sort());
    expect(await systemsOf(id)).toEqual([s1, s2, s3].sort());
  });

  it("skips a System already in the audit, and a repeated id, and counts both right", async () => {
    const id = await makeAudit("skips", [s1, s2]);

    const response = await post(id, { systemIds: [s2, s3, s3, s1] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ added: 1, skipped: 2 });
    expect(await systemsOf(id)).toEqual([s1, s2, s3].sort());

    const again = await (await post(id, { systemIds: [s1, s2, s3] })).json();
    expect(again).toMatchObject({ added: 0, skipped: 3 });
  });

  it.each(NOT_WRITING)("%s gets 403 and nothing changes", async (role) => {
    const id = await makeAudit(`guarded ${role}`, [s1]);

    const response = await post(id, { systemIds: [s2] }, role);

    expect(response.status).toBe(403);
    expect(await systemsOf(id)).toEqual([s1]);
  });

  it("answers 401 to a request with no acting user", async () => {
    const id = await makeAudit("anonymous", [s1]);
    const response = await addSystems(requestAs(`/api/internal-audits/${id}/systems`, null, "POST", { systemIds: [s2] }), ctx(id));
    expect(response.status).toBe(401);
    expect(await systemsOf(id)).toEqual([s1]);
  });

  it.each<InternalAuditStatus>(["LAUNCHED", "CLOSED"])("answers 409 for a %s audit and changes nothing", async (status) => {
    const id = await makeAudit(`not draft ${status}`, [s1], status);

    const response = await post(id, { systemIds: [s2] });

    expect(response.status).toBe(409);
    expect(await systemsOf(id)).toEqual([s1]);
  });

  it("answers 404 for an audit that doesn't exist", async () => {
    expect((await post("nope", { systemIds: [s1] })).status).toBe(404);
  });

  it.each([
    ["no body", undefined],
    ["an empty list", { systemIds: [] }],
    ["no systemIds", {}],
    ["a non-array", { systemIds: "not-a-list" }],
    ["a non-string id", { systemIds: [1] }],
  ])("answers 400 for %s and changes nothing", async (_label, body) => {
    const id = await makeAudit("invalid", [s1]);

    const response = await post(id, body);

    expect(response.status).toBe(400);
    expect(await systemsOf(id)).toEqual([s1]);
  });

  it("answers 400 for an unknown System and adds none of the others", async () => {
    const id = await makeAudit("unknown", [s1]);

    const response = await post(id, { systemIds: [s2, "no-such-system"] });

    expect(response.status).toBe(400);
    expect(await systemsOf(id)).toEqual([s1]);
  });

  it("ends consistent when an add and a replace of the System set run at the same time", async () => {
    for (let round = 0; round < 3; round++) {
      const id = await makeAudit(`race ${round}`, [s1, s2]);

      const [added, replaced] = await Promise.all([
        post(id, { systemIds: [s3] }),
        patchAudit(requestAs(`/api/internal-audits/${id}`, users.INTERNAL_AUDITOR, "PATCH", { systemIds: [s1] }), ctx(id)),
      ]);

      expect([added.status, replaced.status]).toEqual([200, 200]);
      // One ran wholly after the other: the replace came last (s3 is gone) or the add did (s3 is kept).
      const finalSet = await systemsOf(id);
      expect([[s1], [s1, s3].sort()]).toContainEqual(finalSet);
      expect((await added.json()).added).toBe(1);
    }
  }, 30_000);
});

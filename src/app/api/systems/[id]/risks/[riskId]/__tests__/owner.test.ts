import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { PATCH } from "../route";
import { POST as LOG_RISK } from "../../route";
import { POST as CREATE_SYSTEM } from "@/app/api/systems/route";

/**
 * Who may set a Risk's owner on an opened System Risk (#360), and what the Risk Facilitator may not do (#362), against real
 * Postgres. Self-contained fixtures, removed in `afterAll`. A refused request asserts nothing changed.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["owner", "admin", "riskOwner", "facilitator", "facilitatorOwner", "bso", "assignee"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = {
  owner: "SYSTEM_OWNER",
  admin: "ADMIN",
  riskOwner: "RISK_OWNER",
  facilitator: "RISK_FACILITATOR",
  facilitatorOwner: "RISK_FACILITATOR",
  bso: "BUSINESS_RISK_OWNER",
  assignee: "VIEWER",
};
const users = {} as Record<Key, string>;
const systemIds: string[] = [];
let systemId: string;
let facilitatorOwnedId: string;

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (await prisma.user.create({ data: { email: `test-rpo-${key}-${suffix}@example.com`, name: `Test RPO ${key}`, role: ROLE[key] } })).id;
  }
  const make = async (ownerKey: Key) => {
    const system = await prisma.system.create({
      data: { name: `Test RPO System ${suffix}-${systemIds.length}`, ownerId: users[ownerKey], status: "DRAFT", businessSystemOwnerId: users.bso },
    });
    systemIds.push(system.id);
    return system.id;
  };
  systemId = await make("owner");
  facilitatorOwnedId = await make("facilitatorOwner");
});

afterAll(async () => {
  await prisma.changeEvent.deleteMany({ where: { OR: [{ systemId: { in: systemIds } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const makeRisk = (sid: string, title: string, data: { ownerId?: string | null } = {}) =>
  prisma.risk.create({ data: { systemId: sid, title: `Test RPO ${title} ${suffix}`, description: "d", severity: "HIGH", likelihood: "LOW", ...data } });
const patch = (userId: string | null, sid: string, riskId: string, body: unknown) =>
  PATCH(requestAs(`/api/systems/${sid}/risks/${riskId}`, userId, "PATCH", body), { params: Promise.resolve({ id: sid, riskId }) });
const reload = (riskId: string) => prisma.risk.findUniqueOrThrow({ where: { id: riskId } });
const events = (sid: string) => prisma.changeEvent.count({ where: { systemId: sid } });

describe("PATCH /api/systems/[id]/risks/[riskId] owner (#360, #362)", { timeout: 30_000 }, () => {
  it("lets an Admin, a Risk Owner and a Risk Facilitator set, change and clear the owner, without a Change Event", async () => {
    const risk = await makeRisk(systemId, "set");
    const eventsBefore = await events(systemId);
    for (const [key, assignee] of [["admin", users.assignee], ["riskOwner", users.owner], ["facilitator", users.assignee]] as const) {
      const response = await patch(users[key], systemId, risk.id, { ownerId: assignee });
      expect(response.status).toBe(200);
      expect((await response.json()).risk.ownerId).toBe(assignee);
      expect((await reload(risk.id)).ownerId).toBe(assignee);
    }
    const cleared = await patch(users.facilitator, systemId, risk.id, { ownerId: null });
    expect(cleared.status).toBe(200);
    expect((await reload(risk.id)).ownerId).toBeNull();
    expect(await events(systemId)).toBe(eventsBefore);
  });

  it("is 403 for the System's owner and the Business System Owner, changing nothing", async () => {
    const risk = await makeRisk(systemId, "refused", { ownerId: users.assignee });
    for (const key of ["owner", "bso", "assignee"] as const) {
      const response = await patch(users[key], systemId, risk.id, { ownerId: users.owner });
      expect(response.status).toBe(403);
      expect((await reload(risk.id)).ownerId).toBe(users.assignee);
    }
    expect((await patch(null, systemId, risk.id, { ownerId: null })).status).toBe(401);
    expect((await reload(risk.id)).ownerId).toBe(users.assignee);
  });

  it("is 403 for a Risk Facilitator on a System they own", async () => {
    const risk = await makeRisk(facilitatorOwnedId, "own-system");
    const response = await patch(users.facilitatorOwner, facilitatorOwnedId, risk.id, { ownerId: users.assignee });
    expect(response.status).toBe(403);
    expect((await reload(risk.id)).ownerId).toBeNull();
  });

  it("is 400 for an unknown User and for an empty change, changing nothing", async () => {
    const risk = await makeRisk(systemId, "bad", { ownerId: users.assignee });
    expect((await patch(users.admin, systemId, risk.id, { ownerId: "no-such-user" })).status).toBe(400);
    expect((await patch(users.admin, systemId, risk.id, {})).status).toBe(400);
    expect((await reload(risk.id)).ownerId).toBe(users.assignee);
  });

  it("is 404 for a Risk on another System", async () => {
    const risk = await makeRisk(facilitatorOwnedId, "elsewhere");
    expect((await patch(users.admin, systemId, risk.id, { ownerId: users.assignee })).status).toBe(404);
    expect((await reload(risk.id)).ownerId).toBeNull();
  });

  it("refuses a Risk Facilitator anything beyond the owner, changing nothing", async () => {
    const risk = await makeRisk(systemId, "status");
    const before = await reload(risk.id);
    const eventsBefore = await events(systemId);
    for (const body of [
      { status: "CLOSED" },
      { status: "OPEN" },
      { mitigationPlan: "A plan" },
      { status: "MITIGATED", mitigationPlan: "A plan", ownerId: users.assignee },
      { ownerId: users.assignee, mitigationPlan: "A plan" },
    ]) {
      expect((await patch(users.facilitator, systemId, risk.id, body)).status).toBe(403);
    }
    expect(await reload(risk.id)).toEqual(before);
    expect(await events(systemId)).toBe(eventsBefore);
  });

  it("still changes status with its Change Event for a Risk Owner, and keeps the owner when the body names none", async () => {
    const risk = await makeRisk(systemId, "status-ok", { ownerId: users.assignee });
    const eventsBefore = await events(systemId);
    const response = await patch(users.riskOwner, systemId, risk.id, { status: "ACCEPTED", mitigationPlan: null });
    expect(response.status).toBe(200);
    expect(await reload(risk.id)).toMatchObject({ status: "ACCEPTED", ownerId: users.assignee });
    expect(await events(systemId)).toBe(eventsBefore + 1);
  });
});

describe("what a Risk Facilitator may not do (#362)", { timeout: 30_000 }, () => {
  it("cannot log an ad hoc Risk, even on a System it can see", async () => {
    const before = await prisma.risk.count({ where: { systemId } });
    const response = await LOG_RISK(
      requestAs(`/api/systems/${systemId}/risks`, users.facilitator, "POST", { title: "Nope", description: "d", severity: "LOW", likelihood: "LOW" }),
      { params: Promise.resolve({ id: systemId }) },
    );
    expect(response.status).toBe(403);
    expect(await prisma.risk.count({ where: { systemId } })).toBe(before);
  });

  it("lets only those who may assign an owner name one when logging an ad hoc Risk", async () => {
    const body = { title: `Test RPO adhoc ${suffix}`, description: "d", severity: "LOW", likelihood: "LOW", ownerId: users.assignee };
    const ctx = { params: Promise.resolve({ id: systemId }) };
    const before = await prisma.risk.count({ where: { systemId } });
    // The System's owner may log a Risk, but not name an owner.
    expect((await LOG_RISK(requestAs(`/api/systems/${systemId}/risks`, users.owner, "POST", body), ctx)).status).toBe(403);
    expect(await prisma.risk.count({ where: { systemId } })).toBe(before);
    const ok = await LOG_RISK(requestAs(`/api/systems/${systemId}/risks`, users.riskOwner, "POST", body), ctx);
    expect(ok.status).toBe(201);
    expect((await ok.json()).risk.ownerId).toBe(users.assignee);
    const ghost = await LOG_RISK(requestAs(`/api/systems/${systemId}/risks`, users.admin, "POST", { ...body, title: `${body.title} 2`, ownerId: "no-such-user" }), ctx);
    expect(ghost.status).toBe(400);
    expect(await prisma.risk.count({ where: { systemId } })).toBe(before + 1);
  });

  it("cannot create a System", async () => {
    const before = await prisma.system.count({ where: { name: { contains: suffix } } });
    const response = await CREATE_SYSTEM(requestAs("/api/systems", users.facilitator, "POST", { name: `Test RPO created ${suffix}` }));
    expect(response.status).toBe(403);
    expect(await prisma.system.count({ where: { name: { contains: suffix } } })).toBe(before);
  });
});

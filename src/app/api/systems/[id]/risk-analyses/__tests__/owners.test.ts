import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { POST } from "../route";
import { PATCH } from "../[analysisId]/route";
import { POST as COMPLETE } from "../[analysisId]/complete/route";

/**
 * Risk owners saved with a Risk Analysis (#360) and the Risk Facilitator's part in it (#362), against real Postgres. Self-contained
 * fixtures (CI's DB is migrated, not seeded), removed in `afterAll`. A refused request asserts nothing changed.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["owner", "admin", "riskOwner", "facilitator", "facilitatorOwner", "bso", "viewer", "assignee", "assignee2"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = {
  owner: "SYSTEM_OWNER",
  admin: "ADMIN",
  riskOwner: "RISK_OWNER",
  facilitator: "RISK_FACILITATOR",
  facilitatorOwner: "RISK_FACILITATOR",
  bso: "BUSINESS_RISK_OWNER",
  viewer: "VIEWER",
  assignee: "VIEWER",
  assignee2: "REVIEWER",
};
const users = {} as Record<Key, string>;
const systemIds: string[] = [];
let systemId: string;
let facilitatorOwnedId: string;
let otherSystemId: string;
let closedId: string;

async function makeSystem(ownerKey: Key, extra: Record<string, unknown> = {}) {
  const system = await prisma.system.create({
    data: { name: `Test RAO System ${suffix}-${systemIds.length}`, ownerId: users[ownerKey], status: "DRAFT", businessSystemOwnerId: users.bso, ...extra },
  });
  systemIds.push(system.id);
  return system.id;
}

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (await prisma.user.create({ data: { email: `test-rao-${key}-${suffix}@example.com`, name: `Test RAO ${key}`, role: ROLE[key] } })).id;
  }
  systemId = await makeSystem("owner");
  facilitatorOwnedId = await makeSystem("facilitatorOwner");
  otherSystemId = await makeSystem("owner");
  closedId = await makeSystem("owner", { evaluationClosedAt: new Date() });
});

afterAll(async () => {
  await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const ctx = (id: string, analysisId?: string) => ({ params: Promise.resolve({ id, analysisId: analysisId as string }) });
const record = (userId: string | null, id: string, body: unknown) => POST(requestAs(`/api/systems/${id}/risk-analyses`, userId, "POST", body), ctx(id));
const edit = (userId: string | null, id: string, analysisId: string, body: unknown) =>
  PATCH(requestAs(`/api/systems/${id}/risk-analyses/${analysisId}`, userId, "PATCH", body), ctx(id, analysisId));
const complete = (userId: string | null, id: string, analysisId: string) =>
  COMPLETE(requestAs(`/api/systems/${id}/risk-analyses/${analysisId}/complete`, userId, "POST"), ctx(id, analysisId));
const makeRisk = (sid: string, title: string, data: { status?: "OPEN" | "ACCEPTED" | "CLOSED"; ownerId?: string | null } = {}) =>
  prisma.risk.create({ data: { systemId: sid, title: `Test RAO ${title} ${suffix}`, description: "d", severity: "HIGH", likelihood: "LOW", ...data } });
const ownerOf = async (riskId: string) => (await prisma.risk.findUniqueOrThrow({ where: { id: riskId } })).ownerId;
const risksOf = (sid: string) => prisma.risk.findMany({ where: { systemId: sid }, orderBy: { createdAt: "asc" } });
const eventsOf = (sid: string) => prisma.changeEvent.count({ where: { systemId: sid } });
const BODY = { heldOn: "2026-11-09" };
const NEW_RISK = { title: `Test RAO raised ${suffix}`, description: "d", severity: "LOW", likelihood: "LOW" };

async function snapshot(sid: string) {
  return {
    risks: (await risksOf(sid)).map((risk) => [risk.id, risk.ownerId]),
    analyses: await prisma.riskAnalysis.count({ where: { systemId: sid } }),
    events: await eventsOf(sid),
  };
}

describe("owners through Risk Analysis create and edit (#360)", { timeout: 30_000 }, () => {
  it("saves an owner for a reviewed Risk and for a raised Risk when recording, and writes no owner Change Event", async () => {
    const reviewed = await makeRisk(systemId, "reviewed");
    const eventsBefore = await eventsOf(systemId);
    const response = await record(users.riskOwner, systemId, {
      ...BODY,
      reviewedRiskIds: [reviewed.id],
      riskOwners: [{ riskId: reviewed.id, ownerId: users.assignee }],
      newRisks: [{ ...NEW_RISK, ownerId: users.assignee2 }],
    });
    expect(response.status).toBe(201);
    const { riskAnalysis } = await response.json();
    expect(await ownerOf(reviewed.id)).toBe(users.assignee);
    expect(riskAnalysis.reviewedRisks[0]).toMatchObject({ id: reviewed.id, ownerId: users.assignee });
    expect(riskAnalysis.raisedRisks[0]).toMatchObject({ title: NEW_RISK.title, ownerId: users.assignee2 });
    // Only the raised Risk's RISK_LOGGED event: no event for an owner.
    expect(await eventsOf(systemId)).toBe(eventsBefore + 1);
  });

  it("changes and clears an owner when editing, and gives an owner to a Risk raised earlier in the analysis", async () => {
    const sid = otherSystemId;
    const reviewed = await makeRisk(sid, "edit-reviewed", { ownerId: users.assignee });
    const created = await record(users.admin, sid, { ...BODY, reviewedRiskIds: [reviewed.id], newRisks: [NEW_RISK] });
    expect(created.status).toBe(201);
    const { riskAnalysis } = await created.json();
    const raised = riskAnalysis.raisedRisks[0];
    expect(raised.ownerId).toBeNull();

    const response = await edit(users.admin, sid, riskAnalysis.id, {
      riskOwners: [
        { riskId: reviewed.id, ownerId: users.assignee2 },
        { riskId: raised.id, ownerId: users.assignee },
      ],
    });
    expect(response.status).toBe(200);
    expect(await ownerOf(reviewed.id)).toBe(users.assignee2);
    expect(await ownerOf(raised.id)).toBe(users.assignee);

    const cleared = await edit(users.admin, sid, riskAnalysis.id, { riskOwners: [{ riskId: reviewed.id, ownerId: null }] });
    expect(cleared.status).toBe(200);
    expect(await ownerOf(reviewed.id)).toBeNull();
  });

  it("completes only once every open Risk has an owner", async () => {
    const sid = await makeSystem("owner");
    const open = await makeRisk(sid, "e2e-open");
    const created = await record(users.riskOwner, sid, { ...BODY, reviewedRiskIds: [open.id], newRisks: [NEW_RISK] });
    expect(created.status).toBe(201);
    const { riskAnalysis } = await created.json();
    expect((await complete(users.riskOwner, sid, riskAnalysis.id)).status).toBe(409);

    const saved = await edit(users.riskOwner, sid, riskAnalysis.id, {
      riskOwners: [
        { riskId: open.id, ownerId: users.assignee },
        { riskId: riskAnalysis.raisedRisks[0].id, ownerId: users.assignee2 },
      ],
    });
    expect(saved.status).toBe(200);
    expect((await complete(users.riskOwner, sid, riskAnalysis.id)).status).toBe(200);
  });
});

describe("refused owner assignments change nothing (#360)", { timeout: 30_000 }, () => {
  it("is refused for the System's owner, the Business System Owner and a Viewer", async () => {
    const risk = await makeRisk(systemId, "roles");
    for (const key of ["owner", "bso", "viewer"] as const) {
      const before = await snapshot(systemId);
      const response = await record(users[key], systemId, { ...BODY, reviewedRiskIds: [risk.id], riskOwners: [{ riskId: risk.id, ownerId: users.assignee }] });
      expect([403, 404]).toContain(response.status); // 404 where the System is not visible to the role
      expect(await snapshot(systemId)).toEqual(before);
    }
  });

  it("is 400 for an owner that is not a User, rolling back the whole analysis", async () => {
    const risk = await makeRisk(systemId, "ghost");
    const before = await snapshot(systemId);
    const ghost = await record(users.riskOwner, systemId, { ...BODY, reviewedRiskIds: [risk.id], riskOwners: [{ riskId: risk.id, ownerId: "no-such-user" }] });
    expect(ghost.status).toBe(400);
    const ghostNew = await record(users.riskOwner, systemId, { ...BODY, newRisks: [{ ...NEW_RISK, ownerId: "no-such-user" }] });
    expect(ghostNew.status).toBe(400);
    expect(await snapshot(systemId)).toEqual(before);
  });

  it("is 400 for a Risk on another System, or one the analysis does not review", async () => {
    const elsewhere = await makeRisk(otherSystemId, "elsewhere");
    const notReviewed = await makeRisk(systemId, "not-reviewed");
    const before = await snapshot(systemId);
    const beforeOther = await snapshot(otherSystemId);
    const other = await record(users.riskOwner, systemId, { ...BODY, riskOwners: [{ riskId: elsewhere.id, ownerId: users.assignee }] });
    expect(other.status).toBe(400);
    const unreviewed = await record(users.riskOwner, systemId, { ...BODY, riskOwners: [{ riskId: notReviewed.id, ownerId: users.assignee }] });
    expect(unreviewed.status).toBe(400);
    expect(await snapshot(systemId)).toEqual(before);
    expect(await snapshot(otherSystemId)).toEqual(beforeOther);
  });

  it("is refused on a closed System", async () => {
    const closedRisk = await makeRisk(closedId, "closed");
    const before = await snapshot(closedId);
    const response = await record(users.riskOwner, closedId, { ...BODY, reviewedRiskIds: [closedRisk.id], riskOwners: [{ riskId: closedRisk.id, ownerId: users.assignee }] });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await snapshot(closedId)).toEqual(before);
  });

  it("is refused when editing a completed analysis", async () => {
    const sid = await makeSystem("owner");
    const risk = await makeRisk(sid, "after-complete", { status: "CLOSED" });
    const created = await record(users.riskOwner, sid, { ...BODY, reviewedRiskIds: [risk.id] });
    const { riskAnalysis } = await created.json();
    expect((await complete(users.riskOwner, sid, riskAnalysis.id)).status).toBe(200);
    const before = await snapshot(sid);
    const late = await edit(users.riskOwner, sid, riskAnalysis.id, { riskOwners: [{ riskId: risk.id, ownerId: users.assignee }] });
    expect(late.status).toBe(409);
    expect(await snapshot(sid)).toEqual(before);
  });
});

describe("the Risk Facilitator in a Risk Analysis (#362)", { timeout: 30_000 }, () => {
  it("records, edits and completes one, raising a Risk and assigning owners", async () => {
    const sid = await makeSystem("owner");
    const open = await makeRisk(sid, "fac-open");
    const created = await record(users.facilitator, sid, { ...BODY, reviewedRiskIds: [open.id], newRisks: [{ ...NEW_RISK, ownerId: users.assignee }] });
    expect(created.status).toBe(201);
    const { riskAnalysis } = await created.json();
    const edited = await edit(users.facilitator, sid, riskAnalysis.id, { notes: "Edited", riskOwners: [{ riskId: open.id, ownerId: users.assignee2 }] });
    expect(edited.status).toBe(200);
    expect(await ownerOf(open.id)).toBe(users.assignee2);
    expect((await complete(users.facilitator, sid, riskAnalysis.id)).status).toBe(200);
  });

  it("is refused on a System the Facilitator owns, with nothing changed", async () => {
    const before = await snapshot(facilitatorOwnedId);
    expect((await record(users.facilitatorOwner, facilitatorOwnedId, { ...BODY })).status).toBe(403);
    expect((await record(users.facilitatorOwner, facilitatorOwnedId, { ...BODY, newRisks: [NEW_RISK] })).status).toBe(403);
    expect(await snapshot(facilitatorOwnedId)).toEqual(before);
  });
});

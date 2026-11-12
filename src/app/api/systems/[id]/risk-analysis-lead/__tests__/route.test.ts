import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { GET, PUT } from "../route";

/**
 * A System's Risk Analysis lead (#361). Self-contained fixtures (CI's DB is migrated, not seeded): Test Users and Test Systems.
 */

const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "riskOwner", "riskOwner2", "facilitator", "viewer", "reviewer", "ownerAsRiskOwner", "otherOwner"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = {
  admin: "ADMIN",
  owner: "SYSTEM_OWNER",
  riskOwner: "RISK_OWNER",
  riskOwner2: "RISK_OWNER",
  facilitator: "RISK_FACILITATOR",
  viewer: "VIEWER",
  reviewer: "REVIEWER",
  ownerAsRiskOwner: "RISK_OWNER",
  otherOwner: "SYSTEM_OWNER",
};
const users = {} as Record<Key, string>;
const systemIds: string[] = [];

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (await prisma.user.create({ data: { email: `test-ral-${key}-${suffix}@example.com`, name: `Test Ral ${key}`, role: ROLE[key] } })).id;
  }
});

afterAll(async () => {
  // Change Events cascade with the System.
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

async function makeSystem(over: Record<string, unknown> = {}) {
  const system = await prisma.system.create({
    data: { name: `Test Ral System ${suffix}-${systemIds.length}`, ownerId: users.owner, status: "DRAFT", evaluationStage: "FIRST_ROUND", evaluationStageEnteredAt: new Date(), ...over },
  });
  systemIds.push(system.id);
  return system.id;
}

const put = (userId: string | null, id: string, body: unknown) =>
  PUT(requestAs(`/api/systems/${id}/risk-analysis-lead`, userId, "PUT", body), { params: Promise.resolve({ id }) });
const get = (userId: string | null, id: string) => GET(requestAs(`/api/systems/${id}/risk-analysis-lead`, userId, "GET"), { params: Promise.resolve({ id }) });
const leadOf = async (id: string) => (await prisma.system.findUniqueOrThrow({ where: { id } })).riskAnalysisLeadId;
const events = (id: string) => prisma.changeEvent.findMany({ where: { systemId: id, action: "RISK_ANALYSIS_LEAD_CHANGED" } });

describe("PUT /api/systems/[id]/risk-analysis-lead (#361)", { timeout: 30_000 }, () => {
  it("names, changes and clears the lead, one Change Event each, none for a no-op", async () => {
    const id = await makeSystem();

    const first = await put(users.riskOwner, id, { leadId: users.facilitator });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ changed: true, lead: { id: users.facilitator, name: "Test Ral facilitator" } });
    expect(await leadOf(id)).toBe(users.facilitator);
    expect(await events(id)).toHaveLength(1);

    expect((await put(users.admin, id, { leadId: users.facilitator })).status).toBe(200);
    expect(await events(id)).toHaveLength(1);

    expect((await put(users.facilitator, id, { leadId: users.riskOwner2 })).status).toBe(200);
    expect(await leadOf(id)).toBe(users.riskOwner2);

    expect((await put(users.admin, id, { leadId: null })).status).toBe(200);
    expect(await leadOf(id)).toBeNull();
    const written = await events(id);
    expect(written).toHaveLength(3);
    expect(written.map((event) => event.detail).sort()).toEqual([
      "Risk Analysis lead changed from Test Ral facilitator to Test Ral riskOwner2",
      "Risk Analysis lead changed from Test Ral riskOwner2 to none",
      "Risk Analysis lead changed from none to Test Ral facilitator",
    ]);
  });

  it("refuses the System's owner and every role that may not record a Risk Analysis, changing nothing", async () => {
    const id = await makeSystem({ riskAnalysisLeadId: users.riskOwner });
    // A Risk Owner who owns the System, an Admin who owns it, and roles outside the list.
    const ownedByRiskOwner = await makeSystem({ ownerId: users.ownerAsRiskOwner });
    expect((await put(users.ownerAsRiskOwner, ownedByRiskOwner, { leadId: users.riskOwner })).status).toBe(403);
    expect(await leadOf(ownedByRiskOwner)).toBeNull();
    for (const key of ["owner", "viewer", "reviewer"] as const) {
      const response = await put(users[key], id, { leadId: users.facilitator });
      // A Viewer cannot see a Draft System at all (404); the owner and the Reviewer are refused (403 or 404, never a write).
      expect([403, 404], key).toContain(response.status);
      expect(await leadOf(id), key).toBe(users.riskOwner);
    }
    expect(await events(id)).toHaveLength(0);
    expect((await put(null, id, { leadId: null })).status).toBe(401);
    expect(await leadOf(id)).toBe(users.riskOwner);
  });

  it("refuses a lead who is not a Risk Owner or Risk Facilitator, is the System's owner, or does not exist, changing nothing", async () => {
    const id = await makeSystem();
    for (const leadId of [users.admin, users.viewer, users.reviewer, users.owner, "no-such-user"]) {
      const response = await put(users.riskOwner, id, { leadId });
      expect(response.status, leadId).toBe(400);
      expect(await leadOf(id), leadId).toBeNull();
    }
    const owned = await makeSystem({ ownerId: users.ownerAsRiskOwner });
    expect((await put(users.admin, owned, { leadId: users.ownerAsRiskOwner })).status).toBe(400);
    expect(await leadOf(owned)).toBeNull();
    expect(await events(id)).toHaveLength(0);
    expect(await events(owned)).toHaveLength(0);
  });

  it("refuses a bad body, a System without a stage, a closed one, and one that does not exist, changing nothing", async () => {
    const id = await makeSystem();
    for (const body of [{}, { leadId: 5 }, { leadId: "" }, null]) expect((await put(users.admin, id, body)).status).toBe(400);
    const legacy = await makeSystem({ evaluationStage: null, evaluationStageEnteredAt: null });
    expect((await put(users.admin, legacy, { leadId: users.riskOwner })).status).toBe(400);
    const closed = await makeSystem({ evaluationClosedAt: new Date(), status: "REJECTED" });
    expect((await put(users.admin, closed, { leadId: users.riskOwner })).status).toBe(409);
    expect((await put(users.admin, "no-such-system", { leadId: users.riskOwner })).status).toBe(404);
    expect((await get(users.admin, "no-such-system")).status).toBe(404);
    for (const system of [id, legacy, closed]) {
      expect(await leadOf(system)).toBeNull();
      expect(await events(system)).toHaveLength(0);
    }
  });

  it("is cleared when the lead's User is deleted, leaving the System without one", async () => {
    const doomed = await prisma.user.create({ data: { email: `test-ral-doomed-${suffix}@example.com`, name: "Test Ral doomed", role: "RISK_OWNER" } });
    const id = await makeSystem({ riskAnalysisLeadId: doomed.id });
    await prisma.user.delete({ where: { id: doomed.id } });
    expect(await leadOf(id)).toBeNull();
  });
});

describe("GET /api/systems/[id]/risk-analysis-lead (#361)", { timeout: 30_000 }, () => {
  it("shows the lead, and the eligible candidates only to someone who may change it", async () => {
    const id = await makeSystem({ riskAnalysisLeadId: users.riskOwner });
    const asAdmin = await (await get(users.admin, id)).json();
    expect(asAdmin).toMatchObject({ staged: true, canChange: true, lead: { id: users.riskOwner, eligible: true } });
    const candidateIds = asAdmin.candidates.map((person: { id: string }) => person.id);
    expect(candidateIds).toEqual(expect.arrayContaining([users.riskOwner, users.facilitator]));
    expect(candidateIds).not.toContain(users.owner);
    expect(candidateIds).not.toContain(users.admin);
    expect(candidateIds).not.toContain(users.viewer);

    const asOwner = await (await get(users.owner, id)).json();
    expect(asOwner).toMatchObject({ canChange: false, candidates: [] });
  });

  it("flags a stored lead who no longer qualifies, and says a legacy System is not staged", async () => {
    const id = await makeSystem({ riskAnalysisLeadId: users.viewer });
    expect(await (await get(users.admin, id)).json()).toMatchObject({ lead: { id: users.viewer, eligible: false } });
    const legacy = await makeSystem({ evaluationStage: null, evaluationStageEnteredAt: null });
    expect(await (await get(users.admin, legacy)).json()).toMatchObject({ staged: false, canChange: false, candidates: [] });
    expect((await get(users.viewer, id)).status).toBe(404);
  });
});

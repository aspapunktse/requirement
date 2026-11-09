import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { GET, POST } from "../route";
import { GET as GET_ONE, PATCH } from "../[analysisId]/route";
import { POST as COMPLETE } from "../[analysisId]/complete/route";

// A Risk whose title contains BOOM can't have its RISK_LOGGED detail written: stands in for a failure after the first Risk is created.
vi.mock("@/lib/risk-logged-event", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/risk-logged-event")>();
  return {
    ...actual,
    riskLoggedDetail: (input: Parameters<typeof actual.riskLoggedDetail>[0]) => {
      if (input.title.includes("BOOM")) throw new Error("boom");
      return actual.riskLoggedDetail(input);
    },
  };
});

/**
 * Risk Analysis meetings (#325, PRD 0002 F-RA.2-3), against real Postgres. Self-contained fixtures (CI's DB is migrated, not
 * seeded): Test Users, Test Systems and Test Risks, all removed in `afterAll`. A refused request asserts nothing changed.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["owner", "adminOwner", "admin", "riskOwner", "ownerRiskOwner", "otherOwner", "viewer", "reviewer", "complianceManager", "internalAuditor", "person"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = {
  owner: "SYSTEM_OWNER",
  adminOwner: "ADMIN",
  admin: "ADMIN",
  riskOwner: "RISK_OWNER",
  ownerRiskOwner: "RISK_OWNER",
  otherOwner: "SYSTEM_OWNER",
  viewer: "VIEWER",
  reviewer: "REVIEWER",
  complianceManager: "COMPLIANCE_MANAGER",
  internalAuditor: "INTERNAL_AUDITOR",
  person: "VIEWER",
};
const users = {} as Record<Key, string>;
const systemIds: string[] = [];
let systemId: string; // owned by `owner`
let adminOwnedId: string; // owned by `adminOwner` (an Admin)
let riskOwnerOwnedId: string; // owned by `ownerRiskOwner` (a Risk Owner)
let otherSystemId: string;

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (await prisma.user.create({ data: { email: `test-ra-${key}-${suffix}@example.com`, name: `Test RA ${key}`, role: ROLE[key] } })).id;
  }
  const make = async (ownerKey: Key) => {
    const system = await prisma.system.create({ data: { name: `Test RA System ${suffix}-${systemIds.length}`, ownerId: users[ownerKey], status: "DRAFT" } });
    systemIds.push(system.id);
    return system.id;
  };
  systemId = await make("owner");
  adminOwnedId = await make("adminOwner");
  riskOwnerOwnedId = await make("ownerRiskOwner");
  otherSystemId = await make("owner");
});

afterAll(async () => {
  // The Risk Analyses, Risks and Change Events of the System go with it.
  await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const ctx = (id: string, analysisId?: string) => ({ params: Promise.resolve({ id, analysisId: analysisId as string }) });
const list = (userId: string | null, id: string) => GET(requestAs(`/api/systems/${id}/risk-analyses`, userId, "GET"), ctx(id));
const record = (userId: string | null, id: string, body: unknown) => POST(requestAs(`/api/systems/${id}/risk-analyses`, userId, "POST", body), ctx(id));
const edit = (userId: string | null, id: string, analysisId: string, body: unknown) =>
  PATCH(requestAs(`/api/systems/${id}/risk-analyses/${analysisId}`, userId, "PATCH", body), ctx(id, analysisId));
const complete = (userId: string | null, id: string, analysisId: string) =>
  COMPLETE(requestAs(`/api/systems/${id}/risk-analyses/${analysisId}/complete`, userId, "POST"), ctx(id, analysisId));
const makeRisk = (sid: string, data: { title: string; status?: "OPEN" | "MITIGATED"; ownerId?: string | null }) =>
  prisma.risk.create({ data: { systemId: sid, description: "d", severity: "HIGH", likelihood: "LOW", status: "OPEN", ...data } });
const analysesOf = (sid: string) => prisma.riskAnalysis.findMany({ where: { systemId: sid } });
const risksOf = (sid: string) => prisma.risk.count({ where: { systemId: sid } });
const eventsOf = (sid: string) => prisma.changeEvent.count({ where: { systemId: sid } });
const BODY = { heldOn: "2026-11-09", notes: "Kick-off with the vendor" };

describe("recording a Risk Analysis (#325)", { timeout: 30_000 }, () => {
  it("lets a Risk Owner record one with participants, outsiders, notes and reviewed Risks", async () => {
    const reviewed = await makeRisk(systemId, { title: `Test RA reviewed ${suffix}` });
    const response = await record(users.riskOwner, systemId, {
      ...BODY,
      participantIds: [users.person, users.owner],
      outsiders: ["  Vendor architect ", "Vendor CISO"],
      reviewedRiskIds: [reviewed.id],
    });
    expect(response.status).toBe(201);
    const { riskAnalysis } = await response.json();
    expect(riskAnalysis).toMatchObject({
      heldOn: "2026-11-09",
      notes: BODY.notes,
      outsiders: ["Vendor architect", "Vendor CISO"],
      completedAt: null,
      recordedBy: { id: users.riskOwner },
    });
    expect(riskAnalysis.participants.map((person: { id: string }) => person.id).sort()).toEqual([users.person, users.owner].sort());
    expect(riskAnalysis.reviewedRisks.map((risk: { id: string }) => risk.id)).toEqual([reviewed.id]);
    expect(await analysesOf(systemId)).toHaveLength(1);
    expect(await eventsOf(systemId)).toBe(0);
  });

  it("lets an Admin who isn't the System's owner record one", async () => {
    const response = await record(users.admin, otherSystemId, BODY);
    expect(response.status).toBe(201);
    expect(await analysesOf(otherSystemId)).toHaveLength(1);
  });

  it("refuses the System's owner, even an Admin or a Risk Owner who owns it, with nothing changed", async () => {
    for (const [userId, id] of [[users.adminOwner, adminOwnedId], [users.ownerRiskOwner, riskOwnerOwnedId], [users.owner, systemId]] as const) {
      const before = { analyses: (await analysesOf(id)).length, risks: await risksOf(id), events: await eventsOf(id) };
      const response = await record(userId, id, { ...BODY, newRisks: [{ title: "Test RA nope", description: "d", severity: "LOW", likelihood: "LOW" }] });
      expect(response.status).toBe(403);
      expect({ analyses: (await analysesOf(id)).length, risks: await risksOf(id), events: await eventsOf(id) }).toEqual(before);
    }
  });

  it("refuses every other role, and nobody signed in, with nothing changed", async () => {
    const before = { analyses: (await analysesOf(systemId)).length, risks: await risksOf(systemId), events: await eventsOf(systemId) };
    for (const key of ["otherOwner", "viewer", "reviewer", "complianceManager", "internalAuditor"] as const) {
      const response = await record(users[key], systemId, { ...BODY, newRisks: [{ title: "Test RA nope", description: "d", severity: "LOW", likelihood: "LOW" }] });
      // A role that can't see the System gets 404; one that can see it gets 403. Either way nothing is written.
      expect([403, 404]).toContain(response.status);
    }
    expect((await record(null, systemId, BODY)).status).toBe(401);
    expect({ analyses: (await analysesOf(systemId)).length, risks: await risksOf(systemId), events: await eventsOf(systemId) }).toEqual(before);
  });

  it("refuses a Reviewer, a Compliance Manager and an Internal Auditor with 403 (they see every System)", async () => {
    for (const key of ["reviewer", "complianceManager", "internalAuditor"] as const) {
      expect((await record(users[key], systemId, BODY)).status).toBe(403);
    }
  });

  it("creates the Risks raised in the meeting ad hoc, each with a RISK_LOGGED event, together with the analysis", async () => {
    const before = await eventsOf(systemId);
    const response = await record(users.riskOwner, systemId, {
      ...BODY,
      // `source` in the body is not part of the schema: the server decides.
      newRisks: [
        { title: `Test RA raised A ${suffix}`, description: "A", severity: "CRITICAL", likelihood: "HIGH", source: "AUDIT_FINDING" },
        { title: `Test RA raised B ${suffix}`, description: "B", severity: "LOW", likelihood: "LOW" },
      ],
    });
    expect(response.status).toBe(201);
    const { riskAnalysis } = await response.json();
    expect(riskAnalysis.raisedRisks).toHaveLength(2);
    const raised = await prisma.risk.findMany({ where: { raisedInAnalysisId: riskAnalysis.id }, orderBy: { title: "asc" } });
    expect(raised.map((risk) => [risk.systemId, risk.source, risk.status, risk.ownerId])).toEqual([
      [systemId, "AD_HOC", "OPEN", null],
      [systemId, "AD_HOC", "OPEN", null],
    ]);
    const events = await prisma.changeEvent.findMany({ where: { systemId, action: "RISK_LOGGED", detail: { contains: `raised` } } });
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.actorId === users.riskOwner)).toBe(true);
    expect(await eventsOf(systemId)).toBe(before + 2);
  });

  it("refuses a reviewed Risk from another System, or a participant who isn't a User, and leaves nothing, new Risks included", async () => {
    const foreign = await makeRisk(otherSystemId, { title: `Test RA foreign ${suffix}` });
    const before = { analyses: (await analysesOf(systemId)).length, risks: await risksOf(systemId), events: await eventsOf(systemId) };
    const newRisks = [{ title: `Test RA rolled back ${suffix}`, description: "x", severity: "LOW", likelihood: "LOW" }];
    expect((await record(users.riskOwner, systemId, { ...BODY, reviewedRiskIds: [foreign.id], newRisks })).status).toBe(400);
    expect((await record(users.riskOwner, systemId, { ...BODY, participantIds: ["nobody"], newRisks })).status).toBe(400);
    expect({ analyses: (await analysesOf(systemId)).length, risks: await risksOf(systemId), events: await eventsOf(systemId) }).toEqual(before);
  });

  it("writes the analysis, its Risks and their events in one transaction: a failure after the first Risk rolls all of it back", async () => {
    const before = { analyses: (await analysesOf(systemId)).length, risks: await risksOf(systemId), events: await eventsOf(systemId) };
    await expect(
      record(users.riskOwner, systemId, {
        ...BODY,
        newRisks: [
          { title: `Test RA first ${suffix}`, description: "ok", severity: "LOW", likelihood: "LOW" },
          { title: `Test RA BOOM ${suffix}`, description: "its event can't be written", severity: "LOW", likelihood: "LOW" },
        ],
      }),
    ).rejects.toThrow("boom");
    expect({ analyses: (await analysesOf(systemId)).length, risks: await risksOf(systemId), events: await eventsOf(systemId) }).toEqual(before);
  });

  it("rejects a bad body with 400 and writes nothing", async () => {
    const before = (await analysesOf(systemId)).length;
    for (const body of [{}, { heldOn: "yesterday" }, { ...BODY, outsiders: [""] }, { ...BODY, newRisks: [{ title: "", description: "d", severity: "LOW", likelihood: "LOW" }] }, { ...BODY, newRisks: [{ title: "t", description: "d", severity: "HUGE", likelihood: "LOW" }] }]) {
      expect((await record(users.riskOwner, systemId, body)).status).toBe(400);
    }
    expect((await analysesOf(systemId)).length).toBe(before);
  });

  it("answers 404 for a System that doesn't exist", async () => {
    expect((await record(users.riskOwner, "no-such-system", BODY)).status).toBe(404);
  });
});

describe("editing and completing a Risk Analysis (#325)", { timeout: 30_000 }, () => {
  let sid: string;
  beforeAll(async () => {
    sid = (await prisma.system.create({ data: { name: `Test RA System ${suffix}-edit`, ownerId: users.owner, status: "DRAFT" } })).id;
    systemIds.push(sid);
  });

  async function newAnalysis() {
    const response = await record(users.riskOwner, sid, BODY);
    return (await response.json()).riskAnalysis.id as string;
  }

  it("edits an analysis that isn't completed: fields replaced, new Risks added, raised Risks kept", async () => {
    const analysisId = await newAnalysis();
    const reviewed = await makeRisk(sid, { title: `Test RA edit reviewed ${suffix}` });
    const first = await edit(users.admin, sid, analysisId, {
      notes: "Second thoughts",
      heldOn: "2026-11-10",
      participantIds: [users.person],
      outsiders: ["Vendor"],
      reviewedRiskIds: [reviewed.id],
      newRisks: [{ title: `Test RA edit raised ${suffix}`, description: "d", severity: "MEDIUM", likelihood: "MEDIUM" }],
    });
    expect(first.status).toBe(200);
    expect((await first.json()).riskAnalysis).toMatchObject({ notes: "Second thoughts", heldOn: "2026-11-10", outsiders: ["Vendor"] });
    // A second edit leaves the raised Risk alone and replaces the rest.
    const second = await edit(users.riskOwner, sid, analysisId, { participantIds: [], reviewedRiskIds: [] });
    expect(second.status).toBe(200);
    const { riskAnalysis } = await second.json();
    expect(riskAnalysis.participants).toEqual([]);
    expect(riskAnalysis.reviewedRisks).toEqual([]);
    expect(riskAnalysis.raisedRisks).toHaveLength(1);
    expect(riskAnalysis.notes).toBe("Second thoughts");
    expect((await (await GET_ONE(requestAs(`/api/systems/${sid}/risk-analyses/${analysisId}`, users.reviewer, "GET"), ctx(sid, analysisId))).json()).riskAnalysis.id).toBe(analysisId);
  });

  it("refuses an edit by the System's owner or another role with nothing changed", async () => {
    const analysisId = await newAnalysis();
    const before = await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    const risks = await risksOf(sid);
    for (const key of ["owner", "reviewer", "internalAuditor"] as const) {
      expect((await edit(users[key], sid, analysisId, { notes: "hijack", newRisks: [{ title: "x", description: "d", severity: "LOW", likelihood: "LOW" }] })).status).toBe(403);
    }
    expect(await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).toEqual(before);
    expect(await risksOf(sid)).toBe(risks);
  });

  it("refuses an edit naming a reviewed Risk from another System, a stranger as participant, or nothing at all, and changes nothing", async () => {
    const analysisId = await newAnalysis();
    const before = await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    const foreign = await makeRisk(otherSystemId, { title: `Test RA foreign edit ${suffix}` });
    expect((await edit(users.riskOwner, sid, analysisId, { notes: "x", reviewedRiskIds: [foreign.id] })).status).toBe(400);
    expect((await edit(users.riskOwner, sid, analysisId, { notes: "x", participantIds: ["nobody"] })).status).toBe(400);
    expect((await edit(users.riskOwner, sid, analysisId, {})).status).toBe(400);
    expect(await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).toEqual(before);
  });

  it("answers 404 for an analysis of another System", async () => {
    const analysisId = await newAnalysis();
    expect((await edit(users.riskOwner, otherSystemId, analysisId, { notes: "x" })).status).toBe(404);
    expect((await complete(users.riskOwner, otherSystemId, analysisId)).status).toBe(404);
  });

  it("refuses completion with 409 naming each open Risk without an owner, and changes nothing", async () => {
    const analysisId = await newAnalysis();
    const ownerless = await makeRisk(sid, { title: `Test RA ownerless ${suffix}` });
    const owned = await makeRisk(sid, { title: `Test RA owned ${suffix}`, ownerId: users.person });
    const mitigated = await makeRisk(sid, { title: `Test RA mitigated ${suffix}`, status: "MITIGATED" });
    const events = await eventsOf(sid);
    const response = await complete(users.riskOwner, sid, analysisId);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain(ownerless.title);
    expect(body.error).not.toContain(owned.title);
    expect(body.error).not.toContain(mitigated.title);
    expect(body.risks.map((risk: { id: string }) => risk.id)).toContain(ownerless.id);
    expect((await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).completedAt).toBeNull();
    expect(await eventsOf(sid)).toBe(events);
  });

  it("completes once every open Risk has an owner, writes its event, and is read-only afterwards", async () => {
    const own = await prisma.system.create({ data: { name: `Test RA System ${suffix}-complete`, ownerId: users.owner, status: "DRAFT" } });
    systemIds.push(own.id);
    const risk = await makeRisk(own.id, { title: `Test RA to own ${suffix}` });
    const created = await (await record(users.riskOwner, own.id, { ...BODY, reviewedRiskIds: [risk.id], newRisks: [{ title: `Test RA raised ${suffix} c`, description: "d", severity: "LOW", likelihood: "LOW" }] })).json();
    const analysisId = created.riskAnalysis.id as string;
    // The Risk raised in the meeting has no owner either, so completion waits for both.
    expect((await complete(users.riskOwner, own.id, analysisId)).status).toBe(409);
    await prisma.risk.updateMany({ where: { systemId: own.id }, data: { ownerId: users.person } });

    // The System's owner can't complete it.
    expect((await complete(users.owner, own.id, analysisId)).status).toBe(403);
    expect((await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).completedAt).toBeNull();

    const response = await complete(users.admin, own.id, analysisId);
    expect(response.status).toBe(200);
    expect((await response.json()).riskAnalysis).toMatchObject({ completedBy: { id: users.admin } });
    const row = await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    expect(row.completedAt).not.toBeNull();
    expect(row.completedById).toBe(users.admin);
    const event = await prisma.changeEvent.findMany({ where: { systemId: own.id, action: "RISK_ANALYSIS_COMPLETED" } });
    expect(event).toHaveLength(1);
    expect(event[0]).toMatchObject({ actorId: users.admin, detail: "Risk Analysis held 2026-11-09 completed (1 Risk reviewed, 1 raised)" });

    // Read-only now: no edit, no second completion, nothing new written.
    const events = await eventsOf(own.id);
    const risks = await risksOf(own.id);
    const edited = await edit(users.riskOwner, own.id, analysisId, { notes: "too late", newRisks: [{ title: "late", description: "d", severity: "LOW", likelihood: "LOW" }] });
    expect(edited.status).toBe(409);
    expect((await complete(users.riskOwner, own.id, analysisId)).status).toBe(409);
    expect((await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } })).notes).toBe(BODY.notes);
    expect(await eventsOf(own.id)).toBe(events);
    expect(await risksOf(own.id)).toBe(risks);
  });

  it("completes an analysis on a System with no open Risks at all", async () => {
    const empty = await prisma.system.create({ data: { name: `Test RA System ${suffix}-empty`, ownerId: users.owner, status: "DRAFT" } });
    systemIds.push(empty.id);
    const analysisId = (await (await record(users.riskOwner, empty.id, BODY)).json()).riskAnalysis.id as string;
    expect((await complete(users.riskOwner, empty.id, analysisId)).status).toBe(200);
  });

  it("lets only one of a concurrent edit and completion win", async () => {
    const racing = await prisma.system.create({ data: { name: `Test RA System ${suffix}-race`, ownerId: users.owner, status: "DRAFT" } });
    systemIds.push(racing.id);
    const analysisId = (await (await record(users.riskOwner, racing.id, BODY)).json()).riskAnalysis.id as string;
    const [edited, completed] = await Promise.all([
      edit(users.riskOwner, racing.id, analysisId, { notes: "racing", newRisks: [{ title: `Test RA race ${suffix}`, description: "d", severity: "LOW", likelihood: "LOW" }] }),
      complete(users.admin, racing.id, analysisId),
    ]);
    const row = await prisma.riskAnalysis.findUniqueOrThrow({ where: { id: analysisId } });
    // The row lock serialises them. Either the edit ran first (it raised an ownerless Risk, so completion is then refused) or the
    // completion ran first (the edit then sees it completed and writes nothing, not even its Risk). Never both.
    if (edited.status === 200) {
      expect(completed.status).toBe(409);
      expect(row.completedAt).toBeNull();
      expect(await risksOf(racing.id)).toBe(1);
    } else {
      expect(edited.status).toBe(409);
      expect(completed.status).toBe(200);
      expect(row.completedAt).not.toBeNull();
      expect(row.notes).toBe(BODY.notes);
      expect(await risksOf(racing.id)).toBe(0);
    }
  });

  it("lists a System's analyses for anyone who sees it, newest meeting first", async () => {
    const listing = await prisma.system.create({ data: { name: `Test RA System ${suffix}-list`, ownerId: users.owner, status: "DRAFT" } });
    systemIds.push(listing.id);
    await record(users.riskOwner, listing.id, { heldOn: "2026-01-05" });
    await record(users.riskOwner, listing.id, { heldOn: "2026-03-05" });
    const response = await list(users.viewer, listing.id);
    // A Viewer can't see another owner's Draft System.
    expect(response.status).toBe(404);
    for (const userId of [users.owner, users.reviewer, users.internalAuditor]) {
      const ok = await list(userId, listing.id);
      expect(ok.status).toBe(200);
      expect((await ok.json()).riskAnalyses.map((analysis: { heldOn: string }) => analysis.heldOn)).toEqual(["2026-03-05", "2026-01-05"]);
    }
    expect((await list(null, listing.id)).status).toBe(401);
  });
});

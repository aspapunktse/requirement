import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { GET as listComparisons, POST as createComparison } from "../route";
import { DELETE as deleteComparison, GET as getComparison, PATCH as patchComparison } from "../[id]/route";
import { POST as addCandidate } from "../[id]/candidates/route";
import { DELETE as removeCandidate } from "../[id]/candidates/[systemId]/route";
import { GET as listPeople } from "../[id]/people/route";
import { POST as addParticipant } from "../[id]/participants/route";
import { DELETE as removeParticipant } from "../[id]/participants/[userId]/route";
import { GET as getSystem } from "../../systems/[id]/route";

/**
 * Comparisons: data model and API (#372). Self-contained fixtures (CI's database is migrated, not seeded): Test Users, Test
 * Systems and Test Comparisons, all removed in afterAll.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "owner2", "riskOwner", "reviewer", "viewer", "ownerA", "ownerB", "bsoB", "participant", "stranger", "compliance", "staticDoomed"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = {
  admin: "ADMIN",
  owner: "SYSTEM_OWNER",
  owner2: "SYSTEM_OWNER",
  riskOwner: "RISK_OWNER",
  reviewer: "REVIEWER",
  viewer: "VIEWER",
  ownerA: "SYSTEM_OWNER",
  ownerB: "SYSTEM_OWNER",
  bsoB: "VIEWER",
  participant: "SYSTEM_OWNER",
  stranger: "SYSTEM_OWNER",
  compliance: "COMPLIANCE_MANAGER",
  staticDoomed: "SYSTEM_OWNER",
};
const users = {} as Record<Key, string>;
const systemIds: string[] = [];
const comparisonIds: string[] = [];

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (await prisma.user.create({ data: { email: `test-372-${key}-${suffix}@example.com`, name: `Test 372 ${key}`, role: ROLE[key] } })).id;
  }
});

afterAll(async () => {
  await prisma.comparison.deleteMany({ where: { id: { in: comparisonIds } } });
  // Change Events and Risks cascade with the System.
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

async function makeSystem(owner: Key, over: Record<string, unknown> = {}) {
  const system = await prisma.system.create({
    data: {
      name: `Test 372 System ${suffix}-${systemIds.length}`,
      ownerId: users[owner],
      status: "DRAFT",
      evaluationStage: "FIRST_ROUND",
      evaluationStageEnteredAt: new Date(),
      ...over,
    },
  });
  systemIds.push(system.id);
  return system.id;
}

async function makeComparison(owner: Key, extra: { participants?: Key[]; candidates?: { systemId: string; by?: Key }[] } = {}) {
  const comparison = await prisma.comparison.create({
    data: {
      name: `Test 372 Comparison ${suffix}-${comparisonIds.length}`,
      need: "A need",
      ownerId: users[owner],
      participants: { create: (extra.participants ?? []).map((key) => ({ userId: users[key] })) },
      candidates: { create: (extra.candidates ?? []).map((candidate) => ({ systemId: candidate.systemId, addedById: users[candidate.by ?? owner] })) },
    },
  });
  comparisonIds.push(comparison.id);
  return comparison.id;
}

const list = (as: Key | null) => listComparisons(requestAs("/api/comparisons", as && users[as], "GET"));
const create = (as: Key | null, body: unknown) => createComparison(requestAs("/api/comparisons", as && users[as], "POST", body));
const read = (as: Key | null, id: string) => getComparison(requestAs(`/api/comparisons/${id}`, as && users[as], "GET"), ctx({ id }));
const patch = (as: Key | null, id: string, body: unknown) => patchComparison(requestAs(`/api/comparisons/${id}`, as && users[as], "PATCH", body), ctx({ id }));
const del = (as: Key | null, id: string) => deleteComparison(requestAs(`/api/comparisons/${id}`, as && users[as], "DELETE"), ctx({ id }));
const addC = (as: Key | null, id: string, systemId: unknown) =>
  addCandidate(requestAs(`/api/comparisons/${id}/candidates`, as && users[as], "POST", { systemId }), ctx({ id }));
const removeC = (as: Key | null, id: string, systemId: string) =>
  removeCandidate(requestAs(`/api/comparisons/${id}/candidates/${systemId}`, as && users[as], "DELETE"), ctx({ id, systemId }));
const addP = (as: Key | null, id: string, userId: unknown) =>
  addParticipant(requestAs(`/api/comparisons/${id}/participants`, as && users[as], "POST", { userId }), ctx({ id }));
const removeP = (as: Key | null, id: string, userId: string) =>
  removeParticipant(requestAs(`/api/comparisons/${id}/participants/${userId}`, as && users[as], "DELETE"), ctx({ id, userId }));

/** Everything a write could change, as one comparable value: the Comparison, its rows, and the Change Events of the given Systems. */
async function fingerprint(id: string, ...forSystems: string[]) {
  const comparison = await prisma.comparison.findUnique({
    where: { id },
    include: { candidates: { orderBy: { systemId: "asc" } }, participants: { orderBy: { userId: "asc" } } },
  });
  const events = await prisma.changeEvent.count({ where: { systemId: { in: forSystems }, action: { in: ["COMPARISON_CANDIDATE_ADDED", "COMPARISON_CANDIDATE_REMOVED"] } } });
  return JSON.stringify({ comparison, events, all: await prisma.comparison.count({ where: { id: { in: comparisonIds } } }) });
}

const candidateEvents = (systemId: string) =>
  prisma.changeEvent.findMany({ where: { systemId, action: { in: ["COMPARISON_CANDIDATE_ADDED", "COMPARISON_CANDIDATE_REMOVED"] } }, orderBy: { createdAt: "asc" } });

describe("Comparisons (#372)", { timeout: 60_000 }, () => {
  describe("authentication", () => {
    it("answers 401 to every route without an acting user, changing nothing", async () => {
      const id = await makeComparison("owner");
      const systemId = await makeSystem("owner");
      const before = await fingerprint(id, systemId);
      expect((await list(null)).status).toBe(401);
      expect((await create(null, { name: "Test 372 anon" })).status).toBe(401);
      expect((await read(null, id)).status).toBe(401);
      expect((await patch(null, id, { name: "x" })).status).toBe(401);
      expect((await addC(null, id, systemId)).status).toBe(401);
      expect((await removeC(null, id, systemId)).status).toBe(401);
      expect((await addP(null, id, users.viewer)).status).toBe(401);
      expect((await removeP(null, id, users.viewer)).status).toBe(401);
      expect((await del(null, id)).status).toBe(401);
      expect(await fingerprint(id, systemId)).toBe(before);
      expect(await prisma.comparison.count({ where: { name: "Test 372 anon" } })).toBe(0);
    });
  });

  describe("create", () => {
    it.each(["owner", "riskOwner", "admin"] as const)("lets %s create one, becoming its owner", async (key) => {
      const response = await create(key, { name: `  Test 372 Created ${key} ${suffix}  `, need: "  New HR system  " });
      expect(response.status).toBe(201);
      const { comparison } = await response.json();
      comparisonIds.push(comparison.id);
      expect(comparison).toMatchObject({ name: `Test 372 Created ${key} ${suffix}`, need: "New HR system", ownerId: users[key] });
    });

    it.each(["reviewer", "viewer", "compliance"] as const)("refuses %s with 403 and creates nothing", async (key) => {
      const name = `Test 372 Refused ${key} ${suffix}`;
      expect((await create(key, { name })).status).toBe(403);
      expect(await prisma.comparison.count({ where: { name } })).toBe(0);
    });

    it("refuses a bad body with 400 and creates nothing", async () => {
      const before = await prisma.comparison.count({ where: { ownerId: users.owner } });
      for (const body of [{}, { name: "   " }, { name: "x".repeat(201) }, { name: "ok", need: 5 }, null]) {
        expect((await create("owner", body)).status).toBe(400);
      }
      expect(await prisma.comparison.count({ where: { ownerId: users.owner } })).toBe(before);
    });

    it("stores an empty need as none", async () => {
      const { comparison } = await (await create("owner", { name: `Test 372 No need ${suffix}`, need: "  " })).json();
      comparisonIds.push(comparison.id);
      expect(comparison.need).toBeNull();
    });
  });

  describe("who sees a Comparison", () => {
    it("shows it to the owner, a participant, each Candidate's owner and Business System Owner, and the roles that see every System; nobody else", async () => {
      const a = await makeSystem("ownerA");
      const b = await makeSystem("ownerB", { businessSystemOwnerId: users.bsoB });
      const id = await makeComparison("owner", { participants: ["participant"], candidates: [{ systemId: a }, { systemId: b }] });
      for (const key of ["owner", "participant", "ownerA", "ownerB", "bsoB", "admin", "riskOwner", "reviewer", "compliance"] as const) {
        expect((await read(key, id)).status, key).toBe(200);
        const listed = (await (await list(key)).json()).comparisons as Json[];
        expect(listed.map((c) => c.id), key).toContain(id);
      }
      for (const key of ["stranger", "viewer", "owner2"] as const) {
        expect((await read(key, id)).status, key).toBe(404);
        expect(((await (await list(key)).json()).comparisons as Json[]).map((c) => c.id), key).not.toContain(id);
      }
    });

    it("answers 404 to every write on a hidden Comparison, changing nothing", async () => {
      const a = await makeSystem("stranger");
      const id = await makeComparison("owner");
      const before = await fingerprint(id, a);
      expect((await patch("stranger", id, { name: "Hijacked" })).status).toBe(404);
      expect((await del("stranger", id)).status).toBe(404);
      expect((await addC("stranger", id, a)).status).toBe(404);
      expect((await removeC("stranger", id, a)).status).toBe(404);
      expect((await addP("stranger", id, users.stranger)).status).toBe(404);
      expect((await removeP("stranger", id, users.stranger)).status).toBe(404);
      expect((await read("stranger", "no-such-comparison")).status).toBe(404);
      expect(await fingerprint(id, a)).toBe(before);
    });

    it("is not widened by being a Candidate's owner: the Comparison's owner and participant sees nothing more of a System", async () => {
      const b = await makeSystem("ownerB");
      const id = await makeComparison("owner", { participants: ["participant"], candidates: [{ systemId: b }] });
      for (const key of ["owner", "participant"] as const) {
        const { comparison } = await (await read(key, id)).json();
        expect(comparison.candidates[0].canOpen).toBe(false);
        expect((await getSystem(requestAs(`/api/systems/${b}`, users[key], "GET"), ctx({ id: b }))).status).toBe(404);
      }
    });
  });

  describe("reading one Comparison", () => {
    it("gives a System Owner of one Candidate the limited summary of another owner's Draft Candidate, and still 404 on that System", async () => {
      const a = await makeSystem("ownerA");
      const b = await makeSystem("ownerB", { vendor: "Test 372 Vendor" });
      const id = await makeComparison("owner", { candidates: [{ systemId: a }, { systemId: b, by: "ownerB" }] });

      const response = await read("ownerA", id);
      expect(response.status).toBe(200);
      const { comparison } = await response.json();
      expect(comparison).toMatchObject({ id, canManage: false, canAddCandidate: false, owner: { id: users.owner } });
      const own = comparison.candidates.find((c: Json) => c.systemId === a);
      const other = comparison.candidates.find((c: Json) => c.systemId === b);
      expect(own.canOpen).toBe(true);
      expect(other).toMatchObject({ canOpen: false, vendor: "Test 372 Vendor", owner: { id: users.ownerB }, addedBy: { id: users.ownerB } });
      expect(other.score).toMatchObject({ score: null, firstRoundCount: 0, complete: false, controls: [] });
      expect(other.openRisks).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 });
      // The System's own routes still answer 404: being in the Comparison gives no right on it.
      expect((await getSystem(requestAs(`/api/systems/${b}`, users.ownerA, "GET"), ctx({ id: b }))).status).toBe(404);
      expect((await getSystem(requestAs(`/api/systems/${a}`, users.ownerA, "GET"), ctx({ id: a }))).status).toBe(200);
    });

    it("does all its reads in one RepeatableRead transaction, none on the shared client", () => {
      // A structural check: the read's only use of the shared client is the transaction that holds every other query.
      const source = readFileSync(join(process.cwd(), "src/lib/comparison.ts"), "utf8");
      const start = source.indexOf("export async function readComparison");
      const body = source.slice(start, source.indexOf("// Writes.", start));
      expect(body.match(/\bprisma\./g)).toEqual(["prisma."]);
      expect(body).toContain("prisma.$transaction(");
      expect(body).toContain('isolationLevel: "RepeatableRead"');
      expect(body).toContain("readLiveFigures(tx, systemIds)");
      expect(body).toContain("visibleSystemsWhere(actor, tx)");
      // The figures themselves (the Comparison Score loader and the rest of what the page shows) are read on the same `tx`, and so is the freeze (#375).
      const figures = source.slice(source.indexOf("async function readLiveFigures"), start);
      expect(figures).toContain("loadComparisonScores(systemIds, tx)");
      expect(figures.match(/\bprisma\./g)).toBeNull();
      const record = source.slice(source.indexOf("export function recordOutcome"), source.indexOf("export function reopenComparison"));
      expect(record).toContain("readLiveFigures(tx, ");
      expect(record).toContain('isolationLevel: "RepeatableRead"');
      expect(record.match(/\bprisma\./g)).toBeNull();
      expect(record).not.toMatch(/logChangeEvent\([^)]*actor\.id\)/);
    });

    it("gives a Business System Owner the summary and lets them open the System", async () => {
      const b = await makeSystem("ownerB", { businessSystemOwnerId: users.bsoB });
      const id = await makeComparison("owner", { candidates: [{ systemId: b }] });
      const { comparison } = await (await read("bsoB", id)).json();
      expect(comparison.candidates[0].canOpen).toBe(true);
    });

    it("shows Open Risk counts by severity and nothing of the System beyond the summary (no evidence, notes or Risk details)", async () => {
      const secret = `SECRET-${suffix}`;
      const b = await makeSystem("ownerB", {
        vendor: "Test 372 Vendor",
        description: `${secret} description`,
        contractReference: `${secret} contract`,
        vendorWebsiteUrl: `https://${secret}.example.com`,
      });
      await prisma.risk.create({
        data: { systemId: b, title: `${secret} risk title`, description: `${secret} risk description`, severity: "HIGH", likelihood: "LOW", mitigationPlan: `${secret} plan` },
      });
      await prisma.risk.create({ data: { systemId: b, title: `${secret} closed`, description: secret, severity: "HIGH", likelihood: "LOW", status: "ACCEPTED" } });
      await prisma.risk.create({ data: { systemId: b, title: `${secret} risk 2`, description: secret, severity: "CRITICAL", likelihood: "LOW" } });
      const id = await makeComparison("owner", { candidates: [{ systemId: b }] });

      for (const key of ["owner", "ownerB", "admin"] as const) {
        const text = await (await read(key, id)).text();
        expect(text, key).not.toContain(secret);
        const { comparison } = JSON.parse(text);
        expect(comparison.candidates[0].openRisks).toEqual({ LOW: 0, MEDIUM: 0, HIGH: 1, CRITICAL: 1 });
        expect(Object.keys(comparison.candidates[0]).sort()).toEqual(
          ["addedAt", "addedBy", "canOpen", "chosen", "classification", "name", "openRisks", "owner", "rejected", "score", "stage", "systemId", "vendor"].sort(),
        );
        expect(Object.keys(comparison.candidates[0].score).sort()).toEqual(
          ["answeredCount", "complete", "controls", "countedCount", "firstRoundCount", "fulfilledCount", "mandatoryNotFulfilledCount", "score"].sort(),
        );
      }
    });

    it("lists the Candidates in the order of the Comparison Score loader and names where they differ", async () => {
      const a = await makeSystem("ownerA", { sensitivityLevel: null });
      const b = await makeSystem("ownerB", { integrityImpactLevel: "HIGH" });
      const id = await makeComparison("owner", { candidates: [{ systemId: a }, { systemId: b }] });
      const { comparison } = await (await read("owner", id)).json();
      expect(comparison.candidates).toHaveLength(2);
      expect(comparison.classificationDifferences).toContain("integrityImpactLevel");
      expect(comparison.canManage).toBe(true);
      expect(comparison.canAddCandidate).toBe(true);
    });

    it("lists the Comparisons with counts and whether the reader may manage each", async () => {
      const a = await makeSystem("ownerA");
      const id = await makeComparison("owner", { participants: ["participant"], candidates: [{ systemId: a }] });
      const asOwner = ((await (await list("owner")).json()).comparisons as Json[]).find((c) => c.id === id)!;
      expect(asOwner).toMatchObject({ name: expect.stringContaining("Test 372 Comparison"), candidateCount: 1, participantCount: 1, canManage: true, owner: { id: users.owner } });
      const asParticipant = ((await (await list("participant")).json()).comparisons as Json[]).find((c) => c.id === id)!;
      expect(asParticipant.canManage).toBe(false);
      expect(asOwner.closed).toBe(false);
    });
  });

  describe("what the pages need (#373)", () => {
    const facetIds: string[] = [];
    const controlIds: string[] = [];
    const ctl = {} as Record<"a1" | "a2" | "b1" | "both", string>;
    let fwA = "";
    let fwB = "";
    let facet = "";

    beforeAll(async () => {
      facet = (await prisma.deploymentFacet.create({ data: { name: `Test 373 Facet ${suffix}` } })).id;
      facetIds.push(facet);
      fwA = (await createFixtureFramework(`373 Alpha`)).id;
      fwB = (await createFixtureFramework(`373 Beta`)).id;
      for (const key of ["a1", "a2", "b1", "both"] as const) {
        const control = await prisma.control.create({
          data: { code: `TEST-373-${suffix}-${key}`, title: `Test 373 ${key}`, description: "d", category: "Test", applicability: "PER_SYSTEM", mandatory: key === "a1", question: "Does it?", deploymentFacets: { connect: [{ id: facet }] } },
        });
        ctl[key] = control.id;
        controlIds.push(control.id);
      }
      await mapControlsToFramework(fwA, [ctl.a1, ctl.a2, ctl.both]);
      await mapControlsToFramework(fwB, [ctl.b1, ctl.both]);
      for (const [frameworkId, controlId] of [[fwA, ctl.a1], [fwA, ctl.a2], [fwA, ctl.both], [fwB, ctl.b1], [fwB, ctl.both]] as const) {
        await prisma.frameworkFirstRoundControl.create({ data: { frameworkId, controlId } });
      }
    });

    afterAll(async () => {
      await prisma.controlAssessment.deleteMany({ where: { controlId: { in: controlIds } } });
      await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
      await prisma.deploymentFacet.deleteMany({ where: { id: { in: facetIds } } });
    });

    it("groups the first-round Controls of any Candidate by Framework, a Control under the first Framework that marks it, and gives each Candidate's stage", async () => {
      const a = await makeSystem("owner", { deploymentFacets: { connect: [{ id: facet }] }, frameworkScopes: { connect: [{ id: fwA }] } });
      const b = await makeSystem("owner", { deploymentFacets: { connect: [{ id: facet }] }, frameworkScopes: { connect: [{ id: fwA }, { id: fwB }] }, evaluationStage: "OG1" });
      await prisma.controlAssessment.create({ data: { systemId: a, controlId: ctl.a1, status: "FULFILLED", assessedById: users.owner } });
      const id = await makeComparison("owner", { candidates: [{ systemId: a }, { systemId: b }] });
      const { comparison } = await (await read("owner", id)).json();
      const groups = comparison.controlGroups as { framework: { name: string } | null; controls: { code: string; mandatory: boolean }[] }[];
      // Alphabetical by Framework name after the base Framework, which holds none of these Controls.
      expect(groups).toHaveLength(2);
      expect(groups[0].framework?.name).toContain("373 Alpha");
      expect(groups[1].framework?.name).toContain("373 Beta");
      expect(groups[0].controls.map((control) => control.code)).toEqual([`TEST-373-${suffix}-a1`, `TEST-373-${suffix}-a2`, `TEST-373-${suffix}-both`]);
      expect(groups[1].controls.map((control) => control.code)).toEqual([`TEST-373-${suffix}-b1`]);
      expect(groups[0].controls[0].mandatory).toBe(true);
      const candidateA = comparison.candidates.find((candidate: Json) => candidate.systemId === a);
      const candidateB = comparison.candidates.find((candidate: Json) => candidate.systemId === b);
      // System A has Framework A only, so it has no row for b1: the table reads "Does not apply" there.
      expect(candidateA.score.controls.map((control: Json) => control.status)).toEqual(["FULFILLED", "NOT_STARTED", "NOT_STARTED"]);
      expect(candidateB.score.controls).toHaveLength(4);
      expect(candidateA.stage).toBe("FIRST_ROUND");
      expect(candidateB.stage).toBe("OG1");
      expect(candidateA.rejected).toBe(false);
      // A System rejected at a gate keeps its stage but is reported as rejected.
      await prisma.system.update({ where: { id: b }, data: { status: "REJECTED", evaluationClosedAt: new Date() } });
      const after = (await (await read("owner", id)).json()).comparison.candidates.find((candidate: Json) => candidate.systemId === b);
      expect(after.rejected).toBe(true);
      expect(after.stage).toBe("OG1");
      expect(comparison.closed).toBe(false);
    });

    it("gives no Control groups for a Comparison without Candidates or first-round Controls", async () => {
      const id = await makeComparison("owner");
      expect((await (await read("owner", id)).json()).comparison.controlGroups).toEqual([]);
    });

    it("lists the people the owner or an Admin can pick, and refuses everyone else without leaking", async () => {
      const id = await makeComparison("owner", { participants: ["participant"] });
      for (const key of ["owner", "admin"] as const) {
        const response = await listPeople(requestAs(`/api/comparisons/${id}/people`, users[key], "GET"), ctx({ id }));
        expect(response.status, key).toBe(200);
        const { users: people } = await response.json();
        expect(people.map((person: Json) => person.id)).toEqual(expect.arrayContaining([users.owner, users.admin, users.participant]));
        expect(people.map((person: Json) => person.id)).not.toContain(users.viewer);
      }
      expect((await listPeople(requestAs(`/api/comparisons/${id}/people`, users.participant, "GET"), ctx({ id }))).status).toBe(403);
      expect((await listPeople(requestAs(`/api/comparisons/${id}/people`, users.stranger, "GET"), ctx({ id }))).status).toBe(404);
      expect((await listPeople(requestAs(`/api/comparisons/${id}/people`, null, "GET"), ctx({ id }))).status).toBe(401);
    });
  });

  describe("rename, need, owner", () => {
    it("lets the owner and an Admin rename it and edit the need; nobody else", async () => {
      const id = await makeComparison("owner", { participants: ["participant"] });
      expect((await patch("owner", id, { name: "Test 372 Renamed", need: "Changed" })).status).toBe(200);
      expect(await prisma.comparison.findUnique({ where: { id } })).toMatchObject({ name: "Test 372 Renamed", need: "Changed" });
      expect((await patch("admin", id, { need: null })).status).toBe(200);
      expect((await prisma.comparison.findUniqueOrThrow({ where: { id } })).need).toBeNull();

      const before = await fingerprint(id);
      expect((await patch("participant", id, { name: "No" })).status).toBe(403);
      expect(await fingerprint(id)).toBe(before);
      expect((await patch("owner", id, {})).status).toBe(400);
      expect((await patch("owner", id, { name: " " })).status).toBe(400);
      expect(await fingerprint(id)).toBe(before);
    });

    it("lets only an Admin change the owner, and only to a System-creating role", async () => {
      const id = await makeComparison("owner", { participants: ["participant", "owner2"] });
      const before = await fingerprint(id);
      expect((await patch("owner", id, { ownerId: users.owner2 })).status).toBe(403);
      expect(await fingerprint(id)).toBe(before);
      for (const key of ["viewer", "reviewer", "compliance"] as const) {
        expect((await patch("admin", id, { ownerId: users[key] })).status, key).toBe(400);
      }
      expect((await patch("admin", id, { ownerId: "no-such-user" })).status).toBe(400);
      expect(await fingerprint(id)).toBe(before);

      expect((await patch("admin", id, { ownerId: users.owner2 })).status).toBe(200);
      const after = await prisma.comparison.findUniqueOrThrow({ where: { id }, include: { participants: true } });
      expect(after.ownerId).toBe(users.owner2);
      // The new owner is no longer a participant; the other participant stays.
      expect(after.participants.map((p) => p.userId)).toEqual([users.participant]);
      // The old owner is now a stranger to it; the new owner manages it.
      expect((await read("owner", id)).status).toBe(404);
      expect((await patch("owner2", id, { name: "Test 372 By new owner" })).status).toBe(200);
      // Saving the current owner again is not a change of owner, so the owner may send it.
      expect((await patch("owner2", id, { ownerId: users.owner2, name: "Test 372 Same owner" })).status).toBe(200);
    });
  });

  describe("delete", () => {
    it("lets the owner and an Admin delete it, removing its rows and leaving the Systems and their events", async () => {
      const a = await makeSystem("ownerA");
      for (const key of ["owner", "admin"] as const) {
        const id = await makeComparison("owner", { participants: ["participant"], candidates: [{ systemId: a }] });
        expect((await del(key, id)).status).toBe(200);
        expect(await prisma.comparison.count({ where: { id } })).toBe(0);
        expect(await prisma.comparisonCandidate.count({ where: { comparisonId: id } })).toBe(0);
        expect(await prisma.comparisonParticipant.count({ where: { comparisonId: id } })).toBe(0);
        expect(await prisma.system.count({ where: { id: a } })).toBe(1);
      }
    });

    it("refuses a participant and a Candidate's owner (403), changing nothing", async () => {
      const a = await makeSystem("ownerA");
      const id = await makeComparison("owner", { participants: ["participant"], candidates: [{ systemId: a }] });
      const before = await fingerprint(id, a);
      expect((await del("participant", id)).status).toBe(403);
      expect((await del("ownerA", id)).status).toBe(403);
      expect((await del("reviewer", id)).status).toBe(403);
      expect(await fingerprint(id, a)).toBe(before);
    });
  });

  describe("add a Candidate", () => {
    it("lets the owner add a System they can see: staged, any stage, writing one Change Event in the same step", async () => {
      const own = await makeSystem("owner");
      const bsoOf = await makeSystem("ownerB", { businessSystemOwnerId: users.owner, evaluationStage: "OG1" });
      const onboarded = await makeSystem("ownerB", { status: "ONBOARDED" });
      const id = await makeComparison("owner");
      for (const systemId of [own, bsoOf, onboarded]) {
        const response = await addC("owner", id, systemId);
        expect(response.status, systemId).toBe(201);
        expect(await prisma.comparisonCandidate.findUnique({ where: { comparisonId_systemId: { comparisonId: id, systemId } } })).toMatchObject({ addedById: users.owner });
        const events = await candidateEvents(systemId);
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ action: "COMPARISON_CANDIDATE_ADDED", actorId: users.owner });
        expect(events[0].detail).toContain("Test 372 Comparison");
      }
    });

    it("refuses the owner a System they can't see with 404, changing nothing", async () => {
      const hidden = await makeSystem("ownerB");
      const id = await makeComparison("owner");
      const before = await fingerprint(id, hidden);
      expect((await addC("owner", id, hidden)).status).toBe(404);
      expect((await addC("owner", id, "no-such-system")).status).toBe(404);
      expect(await fingerprint(id, hidden)).toBe(before);
    });

    it("lets a participant add a System they own, and refuses any other (403)", async () => {
      const mine = await makeSystem("participant");
      const onboardedOfOther = await makeSystem("ownerB", { status: "ONBOARDED" });
      const id = await makeComparison("owner", { participants: ["participant"] });
      const before = await fingerprint(id, onboardedOfOther);
      expect((await addC("participant", id, onboardedOfOther)).status).toBe(403);
      expect((await addC("participant", id, "no-such-system")).status).toBe(403);
      expect(await fingerprint(id, onboardedOfOther)).toBe(before);
      expect((await addC("participant", id, mine)).status).toBe(201);
      expect(await prisma.comparisonCandidate.findUnique({ where: { comparisonId_systemId: { comparisonId: id, systemId: mine } } })).toMatchObject({ addedById: users.participant });
    });

    it("lets an Admin add any System, and refuses a reader who is neither owner, participant nor Admin (403)", async () => {
      const other = await makeSystem("ownerB");
      const mine = await makeSystem("ownerA");
      const id = await makeComparison("owner", { candidates: [{ systemId: mine }] });
      const before = await fingerprint(id, mine, other);
      expect((await addC("reviewer", id, other)).status).toBe(403);
      expect((await addC("ownerA", id, other)).status).toBe(403);
      expect(await fingerprint(id, mine, other)).toBe(before);
      expect((await addC("admin", id, other)).status).toBe(201);
    });

    it("refuses a System that is not staged, is closed, or is already a Candidate (409), changing nothing", async () => {
      const unstaged = await makeSystem("owner", { evaluationStage: null, evaluationStageEnteredAt: null });
      const closed = await makeSystem("owner", { evaluationClosedAt: new Date() });
      const there = await makeSystem("owner");
      const id = await makeComparison("owner", { candidates: [{ systemId: there }] });
      const before = await fingerprint(id, unstaged, closed, there);
      expect((await addC("owner", id, unstaged)).status).toBe(409);
      expect((await addC("owner", id, closed)).status).toBe(409);
      expect((await addC("admin", id, closed)).status).toBe(409);
      expect((await addC("owner", id, there)).status).toBe(409);
      expect(await fingerprint(id, unstaged, closed, there)).toBe(before);
    });

    it("allows the same System in several Comparisons", async () => {
      const shared = await makeSystem("owner");
      const first = await makeComparison("owner");
      const second = await makeComparison("owner");
      expect((await addC("owner", first, shared)).status).toBe(201);
      expect((await addC("owner", second, shared)).status).toBe(201);
      expect(await candidateEvents(shared)).toHaveLength(2);
    });

    it("holds five Candidates and refuses a sixth (409), changing nothing", async () => {
      const six: string[] = [];
      for (let i = 0; i < 6; i++) six.push(await makeSystem("owner"));
      const id = await makeComparison("owner");
      for (const systemId of six.slice(0, 5)) expect((await addC("owner", id, systemId)).status).toBe(201);
      const before = await fingerprint(id, six[5]);
      expect((await addC("owner", id, six[5])).status).toBe(409);
      expect((await addC("admin", id, six[5])).status).toBe(409);
      expect(await fingerprint(id, six[5])).toBe(before);
      const { comparison } = await (await read("owner", id)).json();
      expect(comparison.canAddCandidate).toBe(false);
    });

    it("never lets concurrent adds pass five", async () => {
      const seven: string[] = [];
      for (let i = 0; i < 7; i++) seven.push(await makeSystem("owner"));
      const id = await makeComparison("owner");
      const statuses = (await Promise.all(seven.map((systemId) => addC("owner", id, systemId)))).map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(5);
      expect(statuses.filter((s) => s === 409)).toHaveLength(2);
      expect(await prisma.comparisonCandidate.count({ where: { comparisonId: id } })).toBe(5);
    });

    it("refuses a bad body with 400", async () => {
      const id = await makeComparison("owner");
      const before = await fingerprint(id);
      for (const systemId of [undefined, "", 5, null]) expect((await addC("owner", id, systemId)).status).toBe(400);
      expect(await fingerprint(id)).toBe(before);
    });
  });

  describe("remove a Candidate", () => {
    it("lets the owner, an Admin and the System's owner remove, one Change Event each", async () => {
      const a = await makeSystem("ownerA");
      const b = await makeSystem("ownerB");
      const c = await makeSystem("ownerA");
      const id = await makeComparison("owner", { candidates: [{ systemId: a }, { systemId: b }, { systemId: c }] });
      expect((await removeC("owner", id, a)).status).toBe(200);
      expect((await removeC("admin", id, b)).status).toBe(200);
      expect((await removeC("ownerA", id, c)).status).toBe(200);
      expect(await prisma.comparisonCandidate.count({ where: { comparisonId: id } })).toBe(0);
      for (const systemId of [a, b, c]) {
        const events = await candidateEvents(systemId);
        expect(events).toHaveLength(1);
        expect(events[0].action).toBe("COMPARISON_CANDIDATE_REMOVED");
      }
      expect((await candidateEvents(c))[0].actorId).toBe(users.ownerA);
      expect(await prisma.system.count({ where: { id: { in: [a, b, c] } } })).toBe(3);
    });

    it("lets a Candidate's owner who then loses sight of the Comparison remove it, and refuses others (403) or a non-Candidate (404)", async () => {
      const a = await makeSystem("ownerA");
      const b = await makeSystem("ownerB");
      const notThere = await makeSystem("owner");
      const id = await makeComparison("owner", { participants: ["participant"], candidates: [{ systemId: a }, { systemId: b }] });
      const before = await fingerprint(id, a, b, notThere);
      expect((await removeC("ownerA", id, b)).status).toBe(403); // another owner's System
      expect((await removeC("participant", id, a)).status).toBe(403);
      expect((await removeC("owner", id, notThere)).status).toBe(404);
      expect(await fingerprint(id, a, b, notThere)).toBe(before);
      expect((await removeC("ownerA", id, a)).status).toBe(200);
      expect((await read("ownerA", id)).status).toBe(404);
    });
  });

  describe("participants", () => {
    it("lets the owner and an Admin name and remove participants; a participant then sees the Comparison", async () => {
      const id = await makeComparison("owner");
      expect((await read("participant", id)).status).toBe(404);
      expect((await addP("owner", id, users.participant)).status).toBe(201);
      expect((await read("participant", id)).status).toBe(200);
      expect((await addP("admin", id, users.viewer)).status).toBe(201);
      expect((await removeP("owner", id, users.participant)).status).toBe(200);
      expect((await removeP("admin", id, users.viewer)).status).toBe(200);
      expect(await prisma.comparisonParticipant.count({ where: { comparisonId: id } })).toBe(0);
      expect((await read("participant", id)).status).toBe(404);
    });

    it("refuses a participant, an unknown user, the owner, a repeat and a non-participant, changing nothing", async () => {
      const id = await makeComparison("owner", { participants: ["participant"] });
      const before = await fingerprint(id);
      expect((await addP("participant", id, users.viewer)).status).toBe(403);
      expect((await removeP("participant", id, users.participant)).status).toBe(403);
      expect((await addP("owner", id, "no-such-user")).status).toBe(400);
      expect((await addP("owner", id, users.owner)).status).toBe(400);
      expect((await addP("owner", id, users.participant)).status).toBe(409);
      expect((await addP("owner", id, 5)).status).toBe(400);
      expect((await removeP("owner", id, users.viewer)).status).toBe(404);
      expect(await fingerprint(id)).toBe(before);
    });

    it("gives a participant no rights beyond adding their own Systems, and a participant's Candidate stays when they are removed", async () => {
      const mine = await makeSystem("participant");
      const id = await makeComparison("owner", { participants: ["participant"] });
      expect((await addC("participant", id, mine)).status).toBe(201);
      expect((await patch("participant", id, { name: "No" })).status).toBe(403);
      expect((await removeP("owner", id, users.participant)).status).toBe(200);
      expect(await prisma.comparisonCandidate.count({ where: { comparisonId: id, systemId: mine } })).toBe(1);
      // They still own a Candidate, so they still see it.
      expect((await read("participant", id)).status).toBe(200);
    });
  });

  describe("a read-only System role is never a System's owner here", () => {
    it.each(["COMPLIANCE_MANAGER", "INTERNAL_AUDITOR"] as const)("refuses a %s who still holds ownerId (403), adding or removing, changing nothing", async (role) => {
      const mine = await makeSystem("participant");
      const other = await makeSystem("participant");
      const id = await makeComparison("owner", { participants: ["participant"], candidates: [{ systemId: other }] });
      await prisma.user.update({ where: { id: users.participant }, data: { role } });
      try {
        const before = await fingerprint(id, mine, other);
        expect((await addC("participant", id, mine)).status).toBe(403);
        expect((await removeC("participant", id, other)).status).toBe(403);
        expect(await fingerprint(id, mine, other)).toBe(before);
        // Reading stays allowed.
        expect((await read("participant", id)).status).toBe(200);
      } finally {
        await prisma.user.update({ where: { id: users.participant }, data: { role: "SYSTEM_OWNER" } });
      }
    });
  });

  describe("deleting a System or a User", () => {
    it("removes the Candidate row of a deleted System and leaves the Comparison and its other Candidates", async () => {
      const doomed = await makeSystem("owner");
      const kept = await makeSystem("owner");
      const id = await makeComparison("owner", { candidates: [{ systemId: doomed }, { systemId: kept }] });
      await prisma.system.delete({ where: { id: doomed } });
      const rows = await prisma.comparisonCandidate.findMany({ where: { comparisonId: id } });
      expect(rows.map((row) => row.systemId)).toEqual([kept]);
      expect(await prisma.comparison.count({ where: { id } })).toBe(1);
      expect((await read("owner", id)).status).toBe(200);
    });

    it("refuses to delete a User who owns a Comparison, and removes a participant row with its User, keeping a Candidate they added", async () => {
      const mine = await makeSystem("owner");
      const id = await makeComparison("owner", { participants: ["staticDoomed"], candidates: [{ systemId: mine, by: "staticDoomed" }] });
      const owned = await makeComparison("staticDoomed");
      await expect(prisma.user.delete({ where: { id: users.staticDoomed } })).rejects.toThrow();
      expect(await prisma.comparison.count({ where: { id: owned } })).toBe(1);
      await prisma.comparison.delete({ where: { id: owned } });
      await prisma.user.delete({ where: { id: users.staticDoomed } });
      expect(await prisma.comparisonParticipant.count({ where: { comparisonId: id } })).toBe(0);
      expect(await prisma.comparisonCandidate.findUnique({ where: { comparisonId_systemId: { comparisonId: id, systemId: mine } } })).toMatchObject({ addedById: null });
      // The afterAll's user cleanup must not trip over a User that is already gone.
      users.staticDoomed = (await prisma.user.create({ data: { email: `test-372-staticDoomed-again-${suffix}@example.com`, name: "Test 372 again", role: "VIEWER" } })).id;
    });
  });
});

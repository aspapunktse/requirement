import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { createFixtureFramework } from "@/test/framework-fixtures";
import { GET as listComparisons, POST as createComparison } from "../route";
import { GET as listAddable, POST as addCandidates } from "../[id]/candidates/route";
import { GET as readClassification } from "../[id]/candidates/[systemId]/classification/route";
import { GET as readOne } from "../[id]/route";
import { CLOSED_REFUSAL, DUPLICATE_REFUSAL, FULL_REFUSAL, NOT_STAGED_REFUSAL, readInterviewContext, STAGING_OFF_REFUSAL } from "@/lib/comparison";

// The App Setting is global state shared by every test file, so it is stood in for here.
const staged = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/app-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-settings")>()),
  readStagedEvaluationEnabled: async () => staged.value,
}));

/**
 * Adding Candidates (#374): the bulk add (all or nothing), a Comparison created with Candidates, the Add Candidate picker's
 * list, and "Start from <Candidate>'s classification" (only for a Candidate the reader can open as a System). Self-contained
 * fixtures (CI's database is migrated, not seeded), all removed in afterAll.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "ownerB", "participant", "stranger", "viewer"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = { admin: "ADMIN", owner: "SYSTEM_OWNER", ownerB: "SYSTEM_OWNER", participant: "SYSTEM_OWNER", stranger: "SYSTEM_OWNER", viewer: "VIEWER" };
const users = {} as Record<Key, string>;
const systemIds: string[] = [];
const comparisonIds: string[] = [];
let facetId: string;
let typeId: string;
let frameworkId: string;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (await prisma.user.create({ data: { email: `test-374-${key}-${suffix}@example.com`, name: `Test 374 ${key}`, role: ROLE[key] } })).id;
  }
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 374 Facet ${suffix}` } })).id;
  typeId = (await prisma.informationType.create({ data: { name: `Test 374 Payroll ${suffix}`, sensitivityLevel: 4 } })).id;
  frameworkId = (await createFixtureFramework("374")).id;
});

afterAll(async () => {
  await prisma.comparison.deleteMany({ where: { OR: [{ id: { in: comparisonIds } }, { name: { startsWith: `Test 374 New ${suffix}` } }] } });
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.informationType.deleteMany({ where: { id: typeId } });
  await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

async function makeSystem(owner: Key, over: Record<string, unknown> = {}) {
  const system = await prisma.system.create({
    data: { name: `Test 374 System ${suffix}-${systemIds.length}`, ownerId: users[owner], status: "DRAFT", evaluationStage: "FIRST_ROUND", evaluationStageEnteredAt: new Date(), ...over },
  });
  systemIds.push(system.id);
  return system.id;
}

async function makeComparison(owner: Key, extra: { participants?: Key[]; candidates?: string[] } = {}) {
  const comparison = await prisma.comparison.create({
    data: {
      name: `Test 374 Comparison ${suffix}-${comparisonIds.length}`,
      ownerId: users[owner],
      participants: { create: (extra.participants ?? []).map((key) => ({ userId: users[key] })) },
      candidates: { create: (extra.candidates ?? []).map((systemId) => ({ systemId, addedById: users[owner] })) },
    },
  });
  comparisonIds.push(comparison.id);
  return comparison.id;
}

const bulk = (as: Key | null, id: string, ids: unknown) => addCandidates(requestAs(`/api/comparisons/${id}/candidates`, as && users[as], "POST", { systemIds: ids }), ctx({ id }));
const picker = (as: Key | null, id: string) => listAddable(requestAs(`/api/comparisons/${id}/candidates`, as && users[as], "GET"), ctx({ id }));
const createWith = (as: Key | null, body: unknown) => createComparison(requestAs("/api/comparisons", as && users[as], "POST", body));
const classification = (as: Key | null, id: string, systemId: string) =>
  readClassification(requestAs(`/api/comparisons/${id}/candidates/${systemId}/classification`, as && users[as], "GET"), ctx({ id, systemId }));

/** The Candidates of a Comparison, and every Candidate-added Change Event of the given Systems: what a refused add must leave alone. */
async function state(id: string, ...forSystems: string[]) {
  return JSON.stringify({
    candidates: (await prisma.comparisonCandidate.findMany({ where: { comparisonId: id }, orderBy: { systemId: "asc" } })).map((row) => row.systemId),
    events: await prisma.changeEvent.count({ where: { systemId: { in: forSystems }, action: "COMPARISON_CANDIDATE_ADDED" } }),
  });
}

describe("Adding Candidates (#374)", { timeout: 60_000 }, () => {
  describe("bulk add: POST /api/comparisons/[id]/candidates { systemIds }", () => {
    it("adds every System, each with one Change Event and the acting user as who added it", async () => {
      const id = await makeComparison("owner");
      const a = await makeSystem("owner");
      const b = await makeSystem("owner");
      const response = await bulk("owner", id, [a, b, a]);
      expect(response.status).toBe(201);
      expect(((await response.json()) as Json).candidates).toHaveLength(2);
      const rows = await prisma.comparisonCandidate.findMany({ where: { comparisonId: id } });
      expect(rows.map((row) => row.systemId).sort()).toEqual([a, b].sort());
      expect(rows.every((row) => row.addedById === users.owner)).toBe(true);
      expect(await prisma.changeEvent.count({ where: { systemId: { in: [a, b] }, action: "COMPARISON_CANDIDATE_ADDED" } })).toBe(2);
    });

    it("is all or nothing: one System that can't be added means none is, and the answer says which and why", async () => {
      const dup = await makeSystem("owner");
      const id = await makeComparison("owner", { candidates: [dup] });
      const ok = await makeSystem("owner");
      const unstaged = await makeSystem("owner", { evaluationStage: null, evaluationStageEnteredAt: null });
      const closed = await makeSystem("owner", { evaluationClosedAt: new Date() });
      const before = await state(id, dup, ok, unstaged, closed);
      const response = await bulk("owner", id, [ok, unstaged, closed, dup]);
      expect(response.status).toBe(409);
      const body = (await response.json()) as Json;
      expect(body.failures).toEqual([
        { systemId: unstaged, error: NOT_STAGED_REFUSAL },
        { systemId: closed, error: CLOSED_REFUSAL },
        { systemId: dup, error: DUPLICATE_REFUSAL },
      ]);
      expect(await state(id, dup, ok, unstaged, closed)).toBe(before);
    });

    it("refuses what would make six Candidates, adding none", async () => {
      const existing = [await makeSystem("owner"), await makeSystem("owner"), await makeSystem("owner")];
      const id = await makeComparison("owner", { candidates: existing });
      const more = [await makeSystem("owner"), await makeSystem("owner"), await makeSystem("owner")];
      const before = await state(id, ...more);
      const response = await bulk("owner", id, more);
      expect(response.status).toBe(409);
      expect(((await response.json()) as Json).failures).toEqual([{ systemId: more[2], error: FULL_REFUSAL }]);
      expect(await state(id, ...more)).toBe(before);
    });

    it("lets the owner add only Systems they can see: another owner's System is not found, and nothing is added", async () => {
      const id = await makeComparison("owner");
      const mine = await makeSystem("owner");
      const theirs = await makeSystem("ownerB");
      const before = await state(id, mine, theirs);
      const response = await bulk("owner", id, [mine, theirs]);
      expect(response.status).toBe(409);
      expect(((await response.json()) as Json).failures).toEqual([{ systemId: theirs, error: "System not found" }]);
      expect(await state(id, mine, theirs)).toBe(before);
    });

    it("lets a participant add only Systems they own, and an Admin any", async () => {
      const id = await makeComparison("owner", { participants: ["participant"] });
      const own = await makeSystem("participant");
      const others = await makeSystem("ownerB");
      const before = await state(id, own, others);
      const refused = await bulk("participant", id, [own, others]);
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as Json).failures).toEqual([{ systemId: others, error: "A participant can add only a System they own" }]);
      expect(await state(id, own, others)).toBe(before);
      expect((await bulk("participant", id, [own])).status).toBe(201);
      expect((await bulk("admin", id, [others])).status).toBe(201);
    });

    it("answers 401, 404 and 400, refuses a non-owner, and changes nothing", async () => {
      const id = await makeComparison("owner");
      const system = await makeSystem("owner");
      const before = await state(id, system);
      expect((await bulk(null, id, [system])).status).toBe(401);
      expect((await bulk("stranger", id, [system])).status).toBe(404); // can't see the Comparison
      const seen = await makeComparison("owner", { participants: ["viewer"] });
      // A VIEWER named a participant sees the Comparison but owns no System: the System is refused with its reason.
      const viewer = await bulk("viewer", seen, [system]);
      expect(viewer.status).toBe(409);
      expect(((await viewer.json()) as Json).failures).toEqual([{ systemId: system, error: "A participant can add only a System they own" }]);
      expect(await prisma.comparisonCandidate.count({ where: { comparisonId: seen } })).toBe(0);
      expect((await bulk("owner", "no-such-comparison", [system])).status).toBe(404);
      expect((await bulk("owner", id, [])).status).toBe(400);
      expect((await bulk("owner", id, "x")).status).toBe(400);
      expect(await state(id, system)).toBe(before);
    });
  });

  describe("a Comparison created with Candidates: POST /api/comparisons { name, systemIds }", () => {
    it("creates the Comparison and its Candidates together", async () => {
      const a = await makeSystem("owner");
      const b = await makeSystem("owner");
      const response = await createWith("owner", { name: `Test 374 New ${suffix} ok`, systemIds: [a, b] });
      expect(response.status).toBe(201);
      const created = ((await response.json()) as Json).comparison;
      comparisonIds.push(created.id);
      expect(created.ownerId).toBe(users.owner);
      expect((await prisma.comparisonCandidate.findMany({ where: { comparisonId: created.id } })).map((row) => row.systemId).sort()).toEqual([a, b].sort());
    });

    it("creates no Comparison when a System can't be added", async () => {
      const ok = await makeSystem("owner");
      const theirs = await makeSystem("ownerB");
      const name = `Test 374 New ${suffix} refused`;
      const response = await createWith("owner", { name, systemIds: [ok, theirs] });
      expect(response.status).toBe(409);
      expect(((await response.json()) as Json).failures).toEqual([{ systemId: theirs, error: "System not found" }]);
      expect(await prisma.comparison.count({ where: { name } })).toBe(0);
      expect(await prisma.changeEvent.count({ where: { systemId: ok, action: "COMPARISON_CANDIDATE_ADDED" } })).toBe(0);
    });

    it("still refuses a role that may not create a Comparison", async () => {
      const name = `Test 374 New ${suffix} viewer`;
      expect((await createWith("viewer", { name, systemIds: [] })).status).toBe(403);
      expect(await prisma.comparison.count({ where: { name } })).toBe(0);
    });
  });

  describe("the list of Comparisons says where the reader may add", () => {
    it("marks an open Comparison with room that the owner or a participant may add to", async () => {
      const id = await makeComparison("owner", { participants: ["participant"] });
      const full = await makeComparison("owner", { candidates: [await makeSystem("owner"), await makeSystem("owner"), await makeSystem("owner"), await makeSystem("owner"), await makeSystem("owner")] });
      const canAdd = async (as: Key, which: string) => {
        const rows = ((await (await listComparisons(requestAs("/api/comparisons", users[as], "GET"))).json()) as Json).comparisons as Json[];
        return rows.find((row) => row.id === which)?.canAddCandidate;
      };
      expect(await canAdd("owner", id)).toBe(true);
      expect(await canAdd("participant", id)).toBe(true);
      expect(await canAdd("owner", full)).toBe(false);
      // The Comparison read says the same.
      const read = (await (await readOne(requestAs(`/api/comparisons/${id}`, users.participant, "GET"), ctx({ id }))).json()) as Json;
      expect(read.comparison.canAddCandidate).toBe(true);
    });
  });

  describe("the Add Candidate picker: GET /api/comparisons/[id]/candidates", () => {
    it("lists the owner's Systems with the reason each one can't be added", async () => {
      const taken = await makeSystem("owner");
      const id = await makeComparison("owner", { candidates: [taken] });
      const free = await makeSystem("owner");
      const unstaged = await makeSystem("owner", { evaluationStage: null, evaluationStageEnteredAt: null });
      const closed = await makeSystem("owner", { evaluationClosedAt: new Date() });
      const theirs = await makeSystem("ownerB");
      const response = await picker("owner", id);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      const reason = (systemId: string) => (body.systems as Json[]).find((system) => system.id === systemId)?.reason;
      expect(reason(free)).toBeNull();
      expect(reason(taken)).toBe(DUPLICATE_REFUSAL);
      expect(reason(unstaged)).toBe(NOT_STAGED_REFUSAL);
      expect(reason(closed)).toBe(CLOSED_REFUSAL);
      // Addable Systems come before the ones that can't be added.
      const reasons = (body.systems as Json[]).map((system) => system.reason !== null);
      expect(reasons).toEqual([...reasons].sort((a, b) => Number(a) - Number(b)));
      expect((body.systems as Json[]).some((system) => system.id === theirs)).toBe(false); // not visible to the owner, so not listed
      expect(body).toMatchObject({ full: false, canCreateSystem: true });
      expect(typeof body.stagedEvaluation).toBe("boolean");
    });

    it("lists only a participant's own Systems, and everything for an Admin", async () => {
      const id = await makeComparison("owner", { participants: ["participant"] });
      const own = await makeSystem("participant");
      const others = await makeSystem("ownerB");
      const asParticipant = ((await (await picker("participant", id)).json()) as Json).systems as Json[];
      expect(asParticipant.some((system) => system.id === own)).toBe(true);
      expect(asParticipant.every((system) => system.owner.id === users.participant)).toBe(true);
      const asAdmin = ((await (await picker("admin", id)).json()) as Json).systems as Json[];
      expect([own, others].every((systemId) => asAdmin.some((system) => system.id === systemId))).toBe(true);
    });

    it("answers 401, 404 and 403", async () => {
      const id = await makeComparison("owner", { candidates: [await makeSystem("participant")] });
      expect((await picker(null, id)).status).toBe(401);
      expect((await picker("stranger", id)).status).toBe(404);
      expect((await picker("owner", "no-such-comparison")).status).toBe(404);
      // The owner of a Candidate sees the Comparison, but is neither its owner nor a participant: they may not add.
      expect((await picker("participant", id)).status).toBe(403);
    });
  });

  describe("Start from a Candidate's classification: GET .../candidates/[systemId]/classification", () => {
    it("reads exactly the Deployment Facets, Information Types, levels and Framework Scope of a Candidate the reader can open", async () => {
      const candidate = await makeSystem("owner", {
        sensitivityLevel: 4,
        integrityImpactLevel: "HIGH",
        availabilityImpactLevel: "LOW",
        vendor: "Secret Vendor",
        description: "Secret description",
        deploymentFacets: { connect: [{ id: facetId }] },
        informationTypes: { connect: [{ id: typeId }] },
        frameworkScopes: { connect: [{ id: frameworkId }] },
      });
      const id = await makeComparison("owner", { candidates: [candidate] });
      const response = await classification("owner", id, candidate);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        classification: {
          deploymentFacetIds: [facetId],
          informationTypeIds: [typeId],
          sensitivityLevel: 4,
          integrityImpactLevel: "HIGH",
          availabilityImpactLevel: "LOW",
          frameworkScopeIds: [frameworkId],
        },
      });
    });

    it("can't be used to read another owner's Information Types: a Candidate the reader can't open as a System is 404", async () => {
      // `participant` owns the Candidate; `owner` owns the Comparison but is not allowed to see another System Owner's System.
      const theirs = await makeSystem("participant", { sensitivityLevel: 4, informationTypes: { connect: [{ id: typeId }] }, deploymentFacets: { connect: [{ id: facetId }] } });
      const id = await makeComparison("owner", { participants: ["participant"], candidates: [theirs] });
      const response = await classification("owner", id, theirs);
      expect(response.status).toBe(404);
      expect(JSON.stringify(await response.json())).not.toContain(typeId);
      // The Candidate's own owner can read it; so can an Admin (sees every System).
      expect((await classification("participant", id, theirs)).status).toBe(200);
      expect((await classification("admin", id, theirs)).status).toBe(200);
    });

    it("is 404 for a System that is not a Candidate of that Comparison, a hidden Comparison, and 401 without a user", async () => {
      const notCandidate = await makeSystem("owner");
      const id = await makeComparison("owner", { candidates: [await makeSystem("owner")] });
      expect((await classification("owner", id, notCandidate)).status).toBe(404);
      expect((await classification("stranger", id, notCandidate)).status).toBe(404);
      expect((await classification(null, id, notCandidate)).status).toBe(401);
    });
  });

  describe("the onboarding interview's context: readInterviewContext", () => {
    const actor = (key: Key) => ({ id: users[key], role: ROLE[key] });

    it("offers only the Candidates the reader can open as Systems", async () => {
      staged.value = true;
      const mine = await makeSystem("owner");
      const theirs = await makeSystem("participant");
      const id = await makeComparison("owner", { participants: ["participant"], candidates: [mine, theirs] });
      const asOwner = await readInterviewContext(actor("owner"), id);
      expect(asOwner).toMatchObject({ ok: true, comparison: { id }, candidates: [{ systemId: mine }] });
      expect(asOwner.ok && asOwner.candidates).toHaveLength(1);
      const asAdmin = await readInterviewContext(actor("admin"), id);
      expect(asAdmin.ok && asAdmin.candidates.map((candidate) => candidate.systemId).sort()).toEqual([mine, theirs].sort());
    });

    it("refuses, with the reason, when staged evaluation is off, the Comparison is full, hidden or not theirs to add to", async () => {
      const id = await makeComparison("owner", { participants: ["participant"] });
      staged.value = false;
      expect(await readInterviewContext(actor("owner"), id)).toEqual({ ok: false, status: 409, error: STAGING_OFF_REFUSAL });
      staged.value = true;
      const full = await makeComparison("owner", { candidates: [await makeSystem("owner"), await makeSystem("owner"), await makeSystem("owner"), await makeSystem("owner"), await makeSystem("owner")] });
      expect(await readInterviewContext(actor("owner"), full)).toEqual({ ok: false, status: 409, error: FULL_REFUSAL });
      expect(await readInterviewContext(actor("stranger"), id)).toMatchObject({ ok: false, status: 404 });
      const owned = await makeComparison("owner", { candidates: [await makeSystem("participant")] });
      expect(await readInterviewContext(actor("participant"), owned)).toMatchObject({ ok: false, status: 403 });
    });
  });
});

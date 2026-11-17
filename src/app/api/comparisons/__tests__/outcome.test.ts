import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { GET as listComparisons } from "../route";
import { DELETE as deleteOne, GET as readOne, PATCH as patchOne } from "../[id]/route";
import { DELETE as reopen, POST as record } from "../[id]/outcome/route";
import { GET as picker, POST as addCandidates } from "../[id]/candidates/route";
import { DELETE as removeCandidate } from "../[id]/candidates/[systemId]/route";
import { POST as addParticipant } from "../[id]/participants/route";
import { DELETE as removeParticipant } from "../[id]/participants/[userId]/route";
import { CLOSED_COMPARISON_REFUSAL, readInterviewContext } from "@/lib/comparison";

/**
 * Recording a Comparison's outcome, freezing its figures, and reopening it (#375). Self-contained fixtures (CI's database is
 * migrated, not seeded): two fixture Controls scoped to a fixture Deployment Facet, mapped to a fixture Framework and marked
 * first round there, three staged Systems that declare it, all removed in afterAll.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "participant", "stranger", "viewer"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = { admin: "ADMIN", owner: "SYSTEM_OWNER", participant: "SYSTEM_OWNER", stranger: "SYSTEM_OWNER", viewer: "VIEWER" };
const users = {} as Record<Key, string>;
const systemIds: string[] = [];
const comparisonIds: string[] = [];
const controlIds: string[] = [];
let facetId: string;
let frameworkId: string;

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const as = (key: Key | null) => (key ? users[key] : null);

beforeAll(async () => {
  for (const key of KEYS) users[key] = (await prisma.user.create({ data: { email: `test-375-${key}-${suffix}@example.com`, name: `Test 375 ${key}`, role: ROLE[key] } })).id;
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 375 Facet ${suffix}` } })).id;
  frameworkId = (await createFixtureFramework("375")).id;
  for (const [key, mandatory] of [["one", true], ["two", false]] as const) {
    const control = await prisma.control.create({
      data: { code: `TEST-375-${suffix}-${key}`, title: `Test 375 ${key}`, description: "d", category: "Test", applicability: "PER_SYSTEM", mandatory, question: "Does it?", deploymentFacets: { connect: [{ id: facetId }] } },
    });
    controlIds.push(control.id);
  }
  await mapControlsToFramework(frameworkId, controlIds);
  for (const controlId of controlIds) await prisma.frameworkFirstRoundControl.create({ data: { frameworkId, controlId } });
});

afterAll(async () => {
  await prisma.comparison.deleteMany({ where: { id: { in: comparisonIds } } });
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await cleanupFixtureRequirements();
  await prisma.frameworkFirstRoundControl.deleteMany({ where: { controlId: { in: controlIds } } });
  await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
  await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

async function makeSystem(owner: Key, over: Record<string, unknown> = {}) {
  const system = await prisma.system.create({
    data: {
      name: `Test 375 System ${suffix}-${systemIds.length}`,
      ownerId: users[owner],
      status: "DRAFT",
      evaluationStage: "FIRST_ROUND",
      evaluationStageEnteredAt: new Date(),
      sensitivityLevel: 2,
      deploymentFacets: { connect: [{ id: facetId }] },
      frameworkScopes: { connect: [{ id: frameworkId }] },
      ...over,
    },
  });
  systemIds.push(system.id);
  return system.id;
}

const assess = (systemId: string, controlIndex: number, status: "FULFILLED" | "IN_PROGRESS") =>
  prisma.controlAssessment.upsert({
    where: { systemId_controlId: { systemId, controlId: controlIds[controlIndex] } },
    create: { systemId, controlId: controlIds[controlIndex], status, assessedById: users.owner },
    update: { status },
  });

/** A Comparison owned by `owner` with `n` Candidates (plus participants); returns the Comparison id and its Systems. */
async function makeComparison(n = 3, extra: { participants?: Key[]; owner?: Key } = {}) {
  const owner = extra.owner ?? "owner";
  const systems: string[] = [];
  for (let i = 0; i < n; i++) systems.push(await makeSystem("owner"));
  const comparison = await prisma.comparison.create({
    data: {
      name: `Test 375 Comparison ${suffix}-${comparisonIds.length}`,
      ownerId: users[owner],
      participants: { create: (extra.participants ?? []).map((key) => ({ userId: users[key] })) },
      candidates: { create: systems.map((systemId) => ({ systemId, addedById: users[owner] })) },
    },
  });
  comparisonIds.push(comparison.id);
  return { id: comparison.id, name: comparison.name, systems };
}

const recordAs = (key: Key | null, id: string, body: unknown) => record(requestAs(`/api/comparisons/${id}/outcome`, as(key), "POST", body), ctx({ id }));
const reopenAs = (key: Key | null, id: string) => reopen(requestAs(`/api/comparisons/${id}/outcome`, as(key), "DELETE"), ctx({ id }));
const view = async (key: Key, id: string) => {
  const response = await readOne(requestAs(`/api/comparisons/${id}`, as(key), "GET"), ctx({ id }));
  return { status: response.status, comparison: ((await response.json()) as Json).comparison as Json };
};
const stored = (id: string) => prisma.comparison.findUniqueOrThrow({ where: { id } });
const eventsOf = (systemId: string, action: string) => prisma.changeEvent.findMany({ where: { systemId, action: action as never } });

describe("recording the outcome (#375)", { timeout: 60_000 }, () => {
  it("lets the owner or an Admin record it, and no one else", async () => {
    const { id, systems } = await makeComparison(2, { participants: ["participant"] });
    const body = { chosenSystemId: systems[0], comment: "Best fit" };
    expect((await recordAs(null, id, body)).status).toBe(401);
    expect((await recordAs("stranger", id, body)).status).toBe(404);
    expect((await recordAs("viewer", id, body)).status).toBe(404);
    expect((await recordAs("participant", id, body)).status).toBe(403);
    const unchanged = await stored(id);
    expect(unchanged.outcomeRecordedAt).toBeNull();
    expect(unchanged.outcomeSnapshot).toBeNull();
    expect(await prisma.changeEvent.count({ where: { systemId: { in: systems }, action: "COMPARISON_OUTCOME_RECORDED" } })).toBe(0);

    expect((await recordAs("owner", id, body)).status).toBe(200);
    expect((await stored(id)).outcomeRecordedAt).not.toBeNull();

    const other = await makeComparison(2);
    expect((await recordAs("admin", other.id, { chosenSystemId: null, comment: "None fits" })).status).toBe(200);
    expect((await stored(other.id)).outcomeRecordedById).toBe(users.admin);
  });

  it("refuses without changing anything: no comment, fewer than two Candidates, already closed, a rejected Candidate, a System that is not a Candidate", async () => {
    const { id, systems } = await makeComparison(2);
    const outsider = await makeSystem("owner");
    const nothingChanged = async (target = id, targetSystems = systems) => {
      const row = await stored(target);
      expect(row.outcomeRecordedAt).toBeNull();
      expect(row.outcomeComment).toBeNull();
      expect(row.outcomeSnapshot).toBeNull();
      expect(await prisma.changeEvent.count({ where: { systemId: { in: targetSystems }, action: "COMPARISON_OUTCOME_RECORDED" } })).toBe(0);
    };

    for (const comment of [undefined, "", "   "]) expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment })).status).toBe(400);
    expect((await recordAs("owner", id, { comment: "x" })).status).toBe(400);
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x", extra: 1 })).status).toBe(400);
    expect((await recordAs("owner", id, { chosenSystemId: outsider, comment: "x" })).status).toBe(400);
    await nothingChanged();

    await prisma.system.update({ where: { id: systems[1] }, data: { status: "REJECTED", evaluationClosedAt: new Date() } });
    const rejected = await recordAs("owner", id, { chosenSystemId: systems[1], comment: "x" });
    expect(rejected.status).toBe(409);
    await nothingChanged();
    // None chosen, or the other Candidate, is still allowed with a Candidate rejected at a gate.
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "Only one left" })).status).toBe(200);

    const again = await recordAs("owner", id, { chosenSystemId: null, comment: "Changed my mind" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as Json).error).toBe(CLOSED_COMPARISON_REFUSAL);
    expect((await stored(id)).outcomeComment).toBe("Only one left");

    const lone = await makeComparison(1);
    expect((await recordAs("owner", lone.id, { chosenSystemId: lone.systems[0], comment: "x" })).status).toBe(409);
    expect((await recordAs("owner", lone.id, { chosenSystemId: null, comment: "x" })).status).toBe(409);
    await nothingChanged(lone.id, lone.systems);
    const empty = await makeComparison(0);
    expect((await recordAs("owner", empty.id, { chosenSystemId: null, comment: "x" })).status).toBe(409);
    await nothingChanged(empty.id, []);
  });

  it("freezes the figures: a later change to a Candidate's Assessment does not move the closed Comparison; reopening shows live figures", async () => {
    const { id, systems } = await makeComparison(2);
    const [a, b] = systems;
    await assess(a, 0, "FULFILLED");
    await assess(a, 1, "FULFILLED");
    await assess(b, 0, "FULFILLED");
    await prisma.risk.create({ data: { systemId: a, title: "Test 375 risk", description: "d", severity: "HIGH", likelihood: "LOW", status: "OPEN" } });
    const before = (await view("owner", id)).comparison;
    const scoreOf = (comparison: Json, systemId: string) => comparison.candidates.find((candidate: Json) => candidate.systemId === systemId);
    expect(scoreOf(before, a).score.score).toBe(1);
    expect(scoreOf(before, b).score.score).toBe(0.5);
    expect(before.closed).toBe(false);
    expect(before.outcome).toBeNull();

    // The chosen Candidate is the lower scorer: allowed, and the view says so.
    expect((await recordAs("owner", id, { chosenSystemId: b, comment: "Cheaper and fits our stack" })).status).toBe(200);

    // Change the Assessments, a Risk and the classification after closing.
    await assess(a, 0, "IN_PROGRESS");
    await assess(b, 1, "FULFILLED");
    await prisma.risk.updateMany({ where: { systemId: a }, data: { status: "CLOSED" } });
    await prisma.system.update({ where: { id: b }, data: { sensitivityLevel: 4 } });

    const closed = (await view("owner", id)).comparison;
    expect(closed.closed).toBe(true);
    expect(scoreOf(closed, a).score).toMatchObject({ score: 1, fulfilledCount: 2, countedCount: 2 });
    expect(scoreOf(closed, a).score.controls.map((control: Json) => control.status)).toEqual(["FULFILLED", "FULFILLED"]);
    expect(scoreOf(closed, b).score).toMatchObject({ score: 0.5, fulfilledCount: 1, mandatoryNotFulfilledCount: 0 });
    expect(scoreOf(closed, a).openRisks.HIGH).toBe(1);
    expect(scoreOf(closed, b).classification.sensitivityLevel).toBe(2);
    expect(closed.controlGroups[0].controls).toHaveLength(2);
    expect(closed.outcome).toMatchObject({ chosen: { id: b }, comment: "Cheaper and fits our stack", chosenNotTopScorer: true, recordedBy: { id: users.owner } });
    expect(scoreOf(closed, b).chosen).toBe(true);
    expect(scoreOf(closed, a).chosen).toBe(false);
    // A reader who can't manage it sees the same frozen figures.
    const stranger = await prisma.comparison.update({ where: { id }, data: { participants: { create: { userId: users.participant } } } });
    expect(stranger.id).toBe(id);
    const asParticipant = (await view("participant", id)).comparison;
    expect(scoreOf(asParticipant, a).score.score).toBe(1);
    expect(asParticipant.canManage).toBe(false);
    expect(asParticipant.canAddCandidate).toBe(false);
    await prisma.comparisonParticipant.deleteMany({ where: { comparisonId: id, userId: users.participant } });

    expect((await reopenAs("owner", id)).status).toBe(200);
    const live = (await view("owner", id)).comparison;
    expect(live.closed).toBe(false);
    expect(live.outcome).toBeNull();
    expect(scoreOf(live, a).score).toMatchObject({ score: 0.5, fulfilledCount: 1 });
    expect(scoreOf(live, b).score).toMatchObject({ score: 1, fulfilledCount: 2 });
    expect(scoreOf(live, a).openRisks.HIGH).toBe(0);
    expect(scoreOf(live, b).classification.sensitivityLevel).toBe(4);
    expect(live.candidates.every((candidate: Json) => candidate.chosen === false)).toBe(true);
    const row = await stored(id);
    expect([row.outcomeRecordedAt, row.outcomeRecordedById, row.outcomeComment, row.outcomeSnapshot]).toEqual([null, null, null, null]);
  });

  it("does not flag the chosen Candidate when it tops the scores, ties for the top, or none is chosen", async () => {
    const top = await makeComparison(2);
    await assess(top.systems[0], 0, "FULFILLED");
    await recordAs("owner", top.id, { chosenSystemId: top.systems[0], comment: "Highest" });
    expect((await view("owner", top.id)).comparison.outcome.chosenNotTopScorer).toBe(false);

    const tie = await makeComparison(2);
    await recordAs("owner", tie.id, { chosenSystemId: tie.systems[1], comment: "Tied" });
    expect((await view("owner", tie.id)).comparison.outcome.chosenNotTopScorer).toBe(false);

    const none = await makeComparison(2);
    await assess(none.systems[0], 0, "FULFILLED");
    await recordAs("owner", none.id, { chosenSystemId: null, comment: "Nothing fits" });
    const outcome = (await view("owner", none.id)).comparison.outcome;
    expect(outcome).toMatchObject({ chosen: null, comment: "Nothing fits", chosenNotTopScorer: false });
  });

  it("writes one Change Event on every Candidate, saying which was chosen, or that none was", async () => {
    const { id, name, systems } = await makeComparison(3);
    await recordAs("owner", id, { chosenSystemId: systems[1], comment: "Chosen" });
    const chosenName = (await prisma.system.findUniqueOrThrow({ where: { id: systems[1] } })).name;
    for (const systemId of systems) {
      const events = await eventsOf(systemId, "COMPARISON_OUTCOME_RECORDED");
      expect(events).toHaveLength(1);
      expect(events[0].actorId).toBe(users.owner);
      expect(events[0].detail).toContain(name);
      expect(events[0].detail).toContain(systemId === systems[1] ? "this System was chosen" : `"${chosenName}" was chosen`);
    }

    const none = await makeComparison(2);
    await recordAs("admin", none.id, { chosenSystemId: null, comment: "None" });
    for (const systemId of none.systems) {
      const events = await eventsOf(systemId, "COMPARISON_OUTCOME_RECORDED");
      expect(events).toHaveLength(1);
      expect(events[0].detail).toContain("no Candidate was chosen");
    }
  });
});

describe("reopening a Comparison (#375)", { timeout: 60_000 }, () => {
  it("lets the owner or an Admin reopen a closed Comparison, with a Change Event on each Candidate, and no one else", async () => {
    const { id, systems } = await makeComparison(2, { participants: ["participant"] });
    expect((await reopenAs("owner", id)).status).toBe(409); // not closed
    await recordAs("owner", id, { chosenSystemId: systems[0], comment: "Done" });
    const snapshot = (await stored(id)).outcomeSnapshot;

    expect((await reopenAs(null, id)).status).toBe(401);
    expect((await reopenAs("stranger", id)).status).toBe(404);
    expect((await reopenAs("participant", id)).status).toBe(403);
    const stillClosed = await stored(id);
    expect(stillClosed.outcomeRecordedAt).not.toBeNull();
    expect(stillClosed.outcomeSnapshot).toEqual(snapshot);
    expect(await prisma.changeEvent.count({ where: { systemId: { in: systems }, action: "COMPARISON_REOPENED" } })).toBe(0);

    expect((await reopenAs("admin", id)).status).toBe(200);
    for (const systemId of systems) expect(await eventsOf(systemId, "COMPARISON_REOPENED")).toHaveLength(1);
    expect((await reopenAs("owner", id)).status).toBe(409);
    expect(await prisma.changeEvent.count({ where: { systemId: { in: systems }, action: "COMPARISON_REOPENED" } })).toBe(2);

    // It can be closed again after reopening.
    expect((await recordAs("owner", id, { chosenSystemId: null, comment: "Again" })).status).toBe(200);
    expect((await stored(id)).outcomeComment).toBe("Again");
  });

  it("lists a closed Comparison as closed, and no longer lets it take Candidates", async () => {
    const { id, systems } = await makeComparison(2);
    await recordAs("owner", id, { chosenSystemId: systems[0], comment: "Done" });
    const rows = ((await (await listComparisons(requestAs("/api/comparisons", users.owner, "GET"))).json()) as Json).comparisons as Json[];
    expect(rows.find((row) => row.id === id)).toMatchObject({ closed: true, canAddCandidate: false, canManage: true });
    await reopenAs("owner", id);
    const reopened = ((await (await listComparisons(requestAs("/api/comparisons", users.owner, "GET"))).json()) as Json).comparisons as Json[];
    expect(reopened.find((row) => row.id === id)).toMatchObject({ closed: false, canAddCandidate: true });
  });

  it("fails loudly rather than show wrong figures when a stored snapshot is malformed", async () => {
    const { id, systems } = await makeComparison(2);
    await recordAs("owner", id, { chosenSystemId: systems[0], comment: "Done" });
    await prisma.comparison.update({ where: { id }, data: { outcomeSnapshot: { version: 1 } } });
    await expect(readOne(requestAs(`/api/comparisons/${id}`, users.owner, "GET"), ctx({ id }))).rejects.toThrow();
  });
});

describe("a closed Comparison is read-only (#375)", { timeout: 60_000 }, () => {
  it("refuses every write, for the owner and an Admin, and changes nothing", async () => {
    const { id, name, systems } = await makeComparison(2, { participants: ["participant"] });
    const extra = await makeSystem("owner");
    const spare = await makeSystem("participant");
    await recordAs("owner", id, { chosenSystemId: systems[0], comment: "Done" });
    const before = await stored(id);

    const url = `/api/comparisons/${id}`;
    for (const key of ["owner", "admin"] as const) {
      const results: [string, Response][] = [
        ["rename", await patchOne(requestAs(url, as(key), "PATCH", { name: "New name" }), ctx({ id }))],
        ["need", await patchOne(requestAs(url, as(key), "PATCH", { need: "New need" }), ctx({ id }))],
        ["owner", await patchOne(requestAs(url, as(key), "PATCH", { ownerId: users.admin }), ctx({ id }))],
        ["delete", await deleteOne(requestAs(url, as(key), "DELETE"), ctx({ id }))],
        ["add", await addCandidates(requestAs(`${url}/candidates`, as(key), "POST", { systemId: extra }), ctx({ id }))],
        ["add several", await addCandidates(requestAs(`${url}/candidates`, as(key), "POST", { systemIds: [extra] }), ctx({ id }))],
        ["remove", await removeCandidate(requestAs(`${url}/candidates/${systems[1]}`, as(key), "DELETE"), ctx({ id, systemId: systems[1] }))],
        ["add participant", await addParticipant(requestAs(`${url}/participants`, as(key), "POST", { userId: users.stranger }), ctx({ id }))],
        ["remove participant", await removeParticipant(requestAs(`${url}/participants/${users.participant}`, as(key), "DELETE"), ctx({ id, userId: users.participant }))],
        ["picker", await picker(requestAs(`${url}/candidates`, as(key), "GET"), ctx({ id }))],
      ];
      for (const [label, response] of results) {
        expect(response.status, `${key}: ${label}`).toBe(409);
        expect(((await response.json()) as Json).error, `${key}: ${label}`).toBe(CLOSED_COMPARISON_REFUSAL);
      }
    }
    // A participant adding a System they own, and a System's owner removing their own Candidate, are refused too.
    const byParticipant = await addCandidates(requestAs(`${url}/candidates`, users.participant, "POST", { systemId: spare }), ctx({ id }));
    expect(byParticipant.status).toBe(409);
    const byOwnerOfSystem = await removeCandidate(requestAs(`${url}/candidates/${systems[0]}`, users.owner, "DELETE"), ctx({ id, systemId: systems[0] }));
    expect(byOwnerOfSystem.status).toBe(409);

    // The interview can't start for it, and a System can't be created into it.
    const interview = await readInterviewContext({ id: users.owner, role: "SYSTEM_OWNER" }, id);
    expect(interview).toMatchObject({ ok: false, status: 409 });

    const after = await stored(id);
    expect(after.name).toBe(name);
    expect(after.need).toBeNull();
    expect(after.ownerId).toBe(users.owner);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.outcomeSnapshot).toEqual(before.outcomeSnapshot);
    expect((await prisma.comparisonCandidate.findMany({ where: { comparisonId: id } })).map((row) => row.systemId).sort()).toEqual([...systems].sort());
    expect((await prisma.comparisonParticipant.findMany({ where: { comparisonId: id } })).map((row) => row.userId)).toEqual([users.participant]);
    expect(await prisma.changeEvent.count({ where: { systemId: { in: [extra, spare] } } })).toBe(0);
  });

  it("still gives a reader who may not change it the usual refusal first (403), not the closed one", async () => {
    const { id } = await makeComparison(2, { participants: ["participant"] });
    const row = await prisma.comparison.findUniqueOrThrow({ where: { id }, include: { candidates: true } });
    await recordAs("owner", id, { chosenSystemId: row.candidates[0].systemId, comment: "Done" });
    const response = await patchOne(requestAs(`/api/comparisons/${id}`, users.participant, "PATCH", { name: "x" }), ctx({ id }));
    expect(response.status).toBe(403);
  });
});

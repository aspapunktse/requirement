import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { GET as readOne } from "../[id]/route";
import { POST as record } from "../[id]/outcome/route";
import { POST as closeLater } from "../[id]/not-selected/route";
import { POST as addCandidates } from "../[id]/candidates/route";
import { POST as reopenSystem } from "../../systems/[id]/reopen/route";
import { NOT_SELECTED_REFUSAL } from "@/lib/comparison";

/**
 * Closing Candidates as Not selected, and the Admin's reopen (#376, ADR 0015). Self-contained fixtures (CI's database is migrated, not
 * seeded): two fixture Controls scoped to a fixture Deployment Facet and mapped to a fixture Framework, Systems that declare them,
 * all removed in afterAll.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "other", "participant", "viewer"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = { admin: "ADMIN", owner: "SYSTEM_OWNER", other: "SYSTEM_OWNER", participant: "SYSTEM_OWNER", viewer: "VIEWER" };
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
  for (const key of KEYS) users[key] = (await prisma.user.create({ data: { email: `test-376-${key}-${suffix}@example.com`, name: `Test 376 ${key}`, role: ROLE[key] } })).id;
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 376 Facet ${suffix}` } })).id;
  frameworkId = (await createFixtureFramework("376")).id;
  for (const key of ["one", "two"]) {
    const control = await prisma.control.create({
      data: { code: `TEST-376-${suffix}-${key}`, title: `Test 376 ${key}`, description: "d", category: "Test", applicability: "PER_SYSTEM", mandatory: false, question: "Does it?", deploymentFacets: { connect: [{ id: facetId }] } },
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
      name: `Test 376 System ${suffix}-${systemIds.length}`,
      ownerId: users[owner],
      status: "DRAFT",
      evaluationStage: "FIRST_ROUND",
      evaluationTrack: "SELF",
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

/** A Comparison owned by `owner`, its Candidates owned as listed (the first owner key is the Comparison owner's own System). */
async function makeComparison(candidateOwners: Key[], extra: { participants?: Key[]; owner?: Key } = {}) {
  const owner = extra.owner ?? "owner";
  const systems: string[] = [];
  for (const candidateOwner of candidateOwners) systems.push(await makeSystem(candidateOwner));
  const comparison = await prisma.comparison.create({
    data: {
      name: `Test 376 Comparison ${suffix}-${comparisonIds.length}`,
      ownerId: users[owner],
      participants: { create: (extra.participants ?? []).map((key) => ({ userId: users[key] })) },
      candidates: { create: systems.map((systemId) => ({ systemId, addedById: users[owner] })) },
    },
  });
  comparisonIds.push(comparison.id);
  return { id: comparison.id, name: comparison.name, systems };
}

const recordAs = (key: Key | null, id: string, body: unknown) => record(requestAs(`/api/comparisons/${id}/outcome`, as(key), "POST", body), ctx({ id }));
const closeAs = (key: Key | null, id: string, systemIdList: string[]) => closeLater(requestAs(`/api/comparisons/${id}/not-selected`, as(key), "POST", { systemIds: systemIdList }), ctx({ id }));
const reopenAs = (key: Key | null, systemId: string, body: unknown) => reopenSystem(requestAs(`/api/systems/${systemId}/reopen`, as(key), "POST", body), ctx({ id: systemId }));
const view = async (key: Key, id: string) => {
  const response = await readOne(requestAs(`/api/comparisons/${id}`, as(key), "GET"), ctx({ id }));
  return { status: response.status, comparison: ((await response.json()) as Json).comparison as Json };
};
const stateOf = (systemId: string) => prisma.system.findUniqueOrThrow({ where: { id: systemId }, select: { status: true, evaluationClosedAt: true, evaluationStage: true, evaluationTrack: true } });
const events = (systemId: string, action: string) => prisma.changeEvent.findMany({ where: { systemId, action: action as never } });

describe("which Candidates the offer lists (#376)", { timeout: 60_000 }, () => {
  it("offers the owner the Candidates they own, and an Admin any, only while they are still in evaluation", async () => {
    const { id, systems } = await makeComparison(["owner", "other", "owner", "owner", "owner", "owner"], { participants: ["participant"] });
    const [own, others, approved, onboarded, closed, inReview] = systems;
    // Approved (has an ATO), Onboarded, closed at a gate and in review are no longer in evaluation.
    await prisma.system.update({ where: { id: approved }, data: { status: "APPROVED" } });
    await prisma.system.update({ where: { id: onboarded }, data: { status: "ONBOARDED" } });
    await prisma.system.update({ where: { id: closed }, data: { status: "REJECTED", evaluationClosedAt: new Date() } });
    await prisma.system.update({ where: { id: inReview }, data: { status: "IN_REVIEW" } });
    const offered = (comparison: Json) => comparison.candidates.filter((candidate: Json) => candidate.canCloseAsNotSelected).map((candidate: Json) => candidate.systemId).sort();
    expect(offered((await view("owner", id)).comparison)).toEqual([own]);
    expect(offered((await view("admin", id)).comparison)).toEqual([own, others].sort());
    // A participant sees the Comparison but may close nothing.
    const participantView = await view("participant", id);
    if (participantView.status === 200) expect(offered(participantView.comparison)).toEqual([]);
  });

  it("offers a Candidate not staged (a classic System) to no one", async () => {
    const { id, systems } = await makeComparison(["owner", "owner"]);
    await prisma.system.update({ where: { id: systems[1] }, data: { evaluationStage: null, evaluationTrack: null } });
    const row = (await view("admin", id)).comparison.candidates.find((candidate: Json) => candidate.systemId === systems[1]);
    expect(row.canCloseAsNotSelected).toBe(false);
  });
});

describe("closing through the outcome (#376)", { timeout: 60_000 }, () => {
  it("closes the ticked Candidates in the same request as the outcome: status, closed marker, stage and Track kept, one Change Event naming the Comparison", async () => {
    const { id, name, systems } = await makeComparison(["owner", "owner", "owner"]);
    const res = await recordAs("owner", id, { chosenSystemId: systems[0], comment: "Best fit", closeAsNotSelected: [systems[1]] });
    expect(res.status).toBe(200);
    expect(await stateOf(systems[1])).toMatchObject({ status: "NOT_SELECTED", evaluationStage: "FIRST_ROUND", evaluationTrack: "SELF" });
    expect((await stateOf(systems[1])).evaluationClosedAt).not.toBeNull();
    const logged = await events(systems[1], "SYSTEM_NOT_SELECTED");
    expect(logged).toHaveLength(1);
    expect(logged[0].detail).toContain(name);
    expect(logged[0].actorId).toBe(users.owner);
    // Not ticked: untouched. Chosen: untouched.
    expect((await stateOf(systems[2])).status).toBe("DRAFT");
    expect((await stateOf(systems[0])).status).toBe("DRAFT");
    expect(await events(systems[2], "SYSTEM_NOT_SELECTED")).toHaveLength(0);
  });

  it("closes nothing and records nothing when the offer is not ticked", async () => {
    const { id, systems } = await makeComparison(["owner", "owner"]);
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x" })).status).toBe(200);
    expect((await stateOf(systems[1])).status).toBe("DRAFT");
  });

  it("refuses the whole request, outcome included, when one ticked Candidate may not be closed", async () => {
    const { id, systems } = await makeComparison(["owner", "owner", "other", "owner"]);
    const untouched = async () => {
      const row = await prisma.comparison.findUniqueOrThrow({ where: { id } });
      expect(row.outcomeRecordedAt).toBeNull();
      expect(row.outcomeSnapshot).toBeNull();
      for (const systemId of systems) {
        expect((await stateOf(systemId)).status).toBe("DRAFT");
        expect(await events(systemId, "SYSTEM_NOT_SELECTED")).toHaveLength(0);
        expect(await events(systemId, "COMPARISON_OUTCOME_RECORDED")).toHaveLength(0);
      }
    };
    // Not theirs: 403, and the System they own that was also ticked is not closed either.
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: [systems[1], systems[2]] })).status).toBe(403);
    await untouched();
    // The chosen Candidate: 409.
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: [systems[0]] })).status).toBe(409);
    await untouched();
    // Not a Candidate: 400.
    const outsider = await makeSystem("owner");
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: [outsider] })).status).toBe(400);
    await untouched();
    // Onboarded: no longer in evaluation, 409.
    await prisma.system.update({ where: { id: systems[3] }, data: { status: "ONBOARDED" } });
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: [systems[1], systems[3]] })).status).toBe(409);
    await prisma.system.update({ where: { id: systems[3] }, data: { status: "DRAFT" } });
    await untouched();
    // A bad list is refused at the boundary.
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: "nope" })).status).toBe(400);
    await untouched();
  });

  it("lets an Admin close a Candidate owned by someone else, and refuses a Candidate already closed", async () => {
    const { id, systems } = await makeComparison(["owner", "other", "other"]);
    await prisma.system.update({ where: { id: systems[2] }, data: { status: "NOT_SELECTED", evaluationClosedAt: new Date() } });
    expect((await recordAs("admin", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: [systems[1], systems[2]] })).status).toBe(409);
    expect((await stateOf(systems[1])).status).toBe("DRAFT");
    expect((await recordAs("admin", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: [systems[1]] })).status).toBe(200);
    expect((await stateOf(systems[1])).status).toBe("NOT_SELECTED");
    expect((await events(systems[1], "SYSTEM_NOT_SELECTED"))[0].actorId).toBe(users.admin);
  });

  it("refuses choosing a Not selected Candidate", async () => {
    const { id, systems } = await makeComparison(["owner", "owner"]);
    await prisma.system.update({ where: { id: systems[1] }, data: { status: "NOT_SELECTED", evaluationClosedAt: new Date() } });
    expect((await recordAs("owner", id, { chosenSystemId: systems[1], comment: "x" })).status).toBe(409);
    expect((await prisma.comparison.findUniqueOrThrow({ where: { id } })).outcomeRecordedAt).toBeNull();
  });
});

describe("closing afterwards from the closed Comparison (#376)", { timeout: 60_000 }, () => {
  it("closes the Candidates the user may close, for the owner and an Admin, and refuses everyone else without changing anything", async () => {
    const { id, systems } = await makeComparison(["owner", "owner", "other", "owner"], { participants: ["participant"] });
    // Still open: refused.
    expect((await closeAs("owner", id, [systems[1]])).status).toBe(409);
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "Best fit" })).status).toBe(200);

    expect((await closeAs(null, id, [systems[1]])).status).toBe(401);
    expect((await closeAs("participant", id, [systems[1]])).status).toBe(403);
    expect((await closeAs("viewer", id, [systems[1]])).status).toBe(404);
    expect((await closeAs("owner", id, [systems[2]])).status).toBe(403); // not theirs
    expect((await closeAs("owner", id, [systems[0]])).status).toBe(409); // the chosen one
    expect((await closeAs("owner", id, [systems[1], systems[2]])).status).toBe(403); // all or nothing
    expect((await closeLater(requestAs(`/api/comparisons/${id}/not-selected`, users.owner, "POST", { systemIds: [] }), ctx({ id }))).status).toBe(400);
    for (const systemId of systems) {
      expect((await stateOf(systemId)).status).toBe("DRAFT");
      expect(await events(systemId, "SYSTEM_NOT_SELECTED")).toHaveLength(0);
    }

    const ok = await closeAs("owner", id, [systems[1]]);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as Json).closed).toBe(1);
    expect((await stateOf(systems[1])).status).toBe("NOT_SELECTED");
    expect((await closeAs("owner", id, [systems[1]])).status).toBe(409); // already closed
    expect((await closeAs("admin", id, [systems[2]])).status).toBe(200);
    expect((await stateOf(systems[2])).status).toBe("NOT_SELECTED");
  });

  it("shows a Not selected Candidate as Not selected and stays in the Comparison, and not addable to another while closed", async () => {
    const { id, systems } = await makeComparison(["owner", "owner"]);
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: [systems[1]] })).status).toBe(200);
    const row = (await view("owner", id)).comparison.candidates.find((candidate: Json) => candidate.systemId === systems[1]);
    expect(row).toMatchObject({ notSelected: true, rejected: false, canCloseAsNotSelected: false });

    const other = await makeComparison(["owner"]);
    const add = await addCandidates(requestAs(`/api/comparisons/${other.id}/candidates`, users.owner, "POST", { systemId: systems[1] }), ctx({ id: other.id }));
    expect(add.status).toBe(409);
    expect(((await add.json()) as Json).error).toBe(NOT_SELECTED_REFUSAL);
    expect(await prisma.comparisonCandidate.count({ where: { comparisonId: other.id, systemId: systems[1] } })).toBe(0);
  });
});

describe("reopening a Not selected System (#376)", { timeout: 60_000 }, () => {
  async function notSelected() {
    const { id, systems } = await makeComparison(["owner", "owner"]);
    expect((await recordAs("owner", id, { chosenSystemId: systems[0], comment: "x", closeAsNotSelected: [systems[1]] })).status).toBe(200);
    return systems[1];
  }

  it("is for an Admin only, with a required comment, and every refusal changes nothing", async () => {
    const systemId = await notSelected();
    await prisma.controlAssessment.create({ data: { systemId, controlId: controlIds[0], status: "FULFILLED", assessedById: users.owner } });
    const before = JSON.stringify([await stateOf(systemId), await prisma.changeEvent.count({ where: { systemId } })]);
    expect((await reopenAs(null, systemId, { comment: "Back" })).status).toBe(401);
    for (const key of ["owner", "participant", "viewer"] as const) expect((await reopenAs(key, systemId, { comment: "Back" })).status).toBe(403);
    for (const body of [{}, { comment: "" }, { comment: "   " }, { comment: "x", extra: 1 }]) expect((await reopenAs("admin", systemId, body)).status).toBe(400);
    expect((await reopenAs("admin", "no-such-system", { comment: "Back" })).status).toBe(404);
    expect(JSON.stringify([await stateOf(systemId), await prisma.changeEvent.count({ where: { systemId } })])).toBe(before);
  });

  it("returns the System to Draft at the same stage, with Assessments intact, one Change Event with the comment", async () => {
    const systemId = await notSelected();
    await prisma.controlAssessment.create({ data: { systemId, controlId: controlIds[1], status: "FULFILLED", assessedById: users.owner } });
    await prisma.risk.create({ data: { systemId, title: "Test 376 risk", description: "d", severity: "LOW", likelihood: "LOW" } });
    const stateBefore = await stateOf(systemId);
    const response = await reopenAs("admin", systemId, { comment: "The vendor came back" });
    expect(response.status).toBe(200);
    const after = await stateOf(systemId);
    expect(after).toMatchObject({ status: "DRAFT", evaluationClosedAt: null, evaluationStage: stateBefore.evaluationStage, evaluationTrack: stateBefore.evaluationTrack });
    expect(await prisma.controlAssessment.count({ where: { systemId, controlId: controlIds[1], status: "FULFILLED" } })).toBe(1);
    expect(await prisma.risk.count({ where: { systemId } })).toBe(1);
    const logged = await events(systemId, "SYSTEM_REOPENED");
    expect(logged).toHaveLength(1);
    expect(logged[0].detail).toContain("The vendor came back");
    expect(logged[0].actorId).toBe(users.admin);
    // Continuous Compliance recomputed: a fixture Control that applies to the System has an Assessment row.
    expect(await prisma.controlAssessment.count({ where: { systemId, controlId: { in: controlIds } } })).toBe(2);
    // It can be closed or added again: a second reopen is refused, since it is no longer Not selected.
    expect((await reopenAs("admin", systemId, { comment: "Again" })).status).toBe(409);
  });

  it("refuses a Rejected System and a Draft one (409) without changing anything", async () => {
    const rejected = await makeSystem("owner", { status: "REJECTED", evaluationClosedAt: new Date() });
    const draft = await makeSystem("owner");
    for (const systemId of [rejected, draft]) {
      const before = JSON.stringify(await stateOf(systemId));
      expect((await reopenAs("admin", systemId, { comment: "Try" })).status).toBe(409);
      expect(JSON.stringify(await stateOf(systemId))).toBe(before);
      expect(await events(systemId, "SYSTEM_REOPENED")).toHaveLength(0);
    }
  });
});

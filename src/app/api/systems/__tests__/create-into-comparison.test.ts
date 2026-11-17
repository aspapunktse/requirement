import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { POST } from "../route";
import { FULL_REFUSAL, STAGING_OFF_REFUSAL } from "@/lib/comparison";

/**
 * Creating a System into a Comparison (#374): the onboarding interview's request carries `comparisonId`, and the new System
 * becomes a Candidate in the transaction that creates it. A refused Candidate means no System. The App Setting is the one
 * thing mocked (it is global state shared by every test file): `staged.value` stands for "Staged evaluation for new Systems".
 */
const staged = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/app-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/app-settings")>()),
  readStagedEvaluationEnabled: async () => staged.value,
}));

const suffix = `${process.pid}-${Date.now()}`;
const NAME = `Test 374 Created ${suffix}`;
const KEYS = ["owner", "participant", "stranger", "viewer"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = { owner: "SYSTEM_OWNER", participant: "SYSTEM_OWNER", stranger: "SYSTEM_OWNER", viewer: "VIEWER" };
const users = {} as Record<Key, string>;
const comparisonIds: string[] = [];
const extraSystemIds: string[] = [];
let facetId: string;

beforeAll(async () => {
  for (const key of KEYS) users[key] = (await prisma.user.create({ data: { email: `test-374c-${key}-${suffix}@example.com`, name: `Test 374c ${key}`, role: ROLE[key] } })).id;
  facetId = (await prisma.deploymentFacet.create({ data: { name: `Test 374 Created Facet ${suffix}` } })).id;
});

afterAll(async () => {
  await prisma.comparison.deleteMany({ where: { id: { in: comparisonIds } } });
  await prisma.system.deleteMany({ where: { OR: [{ name: NAME }, { id: { in: extraSystemIds } }] } });
  await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

async function makeComparison(owner: Key, extra: { participants?: Key[]; candidates?: number } = {}) {
  const candidates = [];
  for (let n = 0; n < (extra.candidates ?? 0); n++) {
    const system = await prisma.system.create({ data: { name: `Test 374 Filler ${suffix}-${extraSystemIds.length}`, ownerId: users[owner], evaluationStage: "FIRST_ROUND", evaluationStageEnteredAt: new Date() } });
    extraSystemIds.push(system.id);
    candidates.push({ systemId: system.id, addedById: users[owner] });
  }
  const comparison = await prisma.comparison.create({
    data: {
      name: `Test 374 Into ${suffix}-${comparisonIds.length}`,
      ownerId: users[owner],
      participants: { create: (extra.participants ?? []).map((key) => ({ userId: users[key] })) },
      candidates: { create: candidates },
    },
  });
  comparisonIds.push(comparison.id);
  return comparison.id;
}

const create = (as: Key, comparisonId: unknown) =>
  POST(requestAs("/api/systems", users[as], "POST", { name: NAME, deploymentFacetIds: [facetId], ...(comparisonId === undefined ? {} : { comparisonId }) }));
const systemsNamed = () => prisma.system.count({ where: { name: NAME } });
const candidatesOf = (id: string) => prisma.comparisonCandidate.findMany({ where: { comparisonId: id } });

describe("POST /api/systems with comparisonId (#374)", { timeout: 30_000 }, () => {
  it("creates a staged System that is a Candidate of the Comparison, with a Change Event, in one go", async () => {
    staged.value = true;
    const id = await makeComparison("owner");
    const response = await create("owner", id);
    expect(response.status).toBe(201);
    const systemId = ((await response.json()) as { system: { id: string } }).system.id;
    const system = await prisma.system.findUniqueOrThrow({ where: { id: systemId } });
    expect(system.evaluationStage).toBe("FIRST_ROUND");
    const rows = await candidatesOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ systemId, addedById: users.owner });
    const events = await prisma.changeEvent.findMany({ where: { systemId } });
    expect(events.map((event) => event.action).sort()).toEqual(["COMPARISON_CANDIDATE_ADDED", "EVALUATION_STAGE_CHANGED", "SYSTEM_CREATED"]);
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("lets a participant create into the Comparison", async () => {
    staged.value = true;
    const id = await makeComparison("owner", { participants: ["participant"] });
    const response = await create("participant", id);
    expect(response.status).toBe(201);
    expect(await candidatesOf(id)).toHaveLength(1);
    await prisma.system.deleteMany({ where: { name: NAME } });
  });

  it("creates nothing when the Comparison already has five Candidates", async () => {
    staged.value = true;
    const id = await makeComparison("owner", { candidates: 5 });
    const response = await create("owner", id);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(FULL_REFUSAL);
    expect(await systemsNamed()).toBe(0);
    expect(await candidatesOf(id)).toHaveLength(5);
  });

  it("creates nothing when staged evaluation is off, saying why", async () => {
    staged.value = false;
    const id = await makeComparison("owner");
    const response = await create("owner", id);
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(STAGING_OFF_REFUSAL);
    expect(await systemsNamed()).toBe(0);
    expect(await candidatesOf(id)).toHaveLength(0);
    // Without a Comparison the System is created as before: not staged.
    const plain = await create("owner", undefined);
    expect(plain.status).toBe(201);
    expect((await prisma.system.findFirstOrThrow({ where: { name: NAME } })).evaluationStage).toBeNull();
    await prisma.system.deleteMany({ where: { name: NAME } });
    staged.value = true;
  });

  it("creates nothing for a Comparison the user can't see (404) or may not add to (403), or one that doesn't exist", async () => {
    staged.value = true;
    const id = await makeComparison("owner", { participants: ["viewer"] });
    const hidden = await create("stranger", id);
    expect(hidden.status).toBe(404);
    // A VIEWER can't create Systems at all.
    expect((await create("viewer", id)).status).toBe(403);
    expect((await create("owner", "no-such-comparison")).status).toBe(404);
    // The owner of a Candidate sees the Comparison but may not add to it.
    const other = await makeComparison("owner", { candidates: 1 });
    const filler = (await candidatesOf(other))[0].systemId;
    await prisma.system.update({ where: { id: filler }, data: { ownerId: users.participant } });
    const refused = await create("participant", other);
    expect(refused.status).toBe(403);
    expect(await systemsNamed()).toBe(0);
    expect(await candidatesOf(id)).toHaveLength(0);
  });

  it("rejects a malformed comparisonId and creates nothing", async () => {
    expect((await create("owner", "")).status).toBe(400);
    expect(await systemsNamed()).toBe(0);
  });
});

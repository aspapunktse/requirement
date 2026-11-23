import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getApplicableControls, getStaleAssessments } from "@/lib/control-assessments";
import { EFFECTIVE_SCOPE_SELECT, frameworksInScopeOfSystem, systemsWithFrameworkInScope, withEffectiveScope } from "@/lib/effective-framework-scope";
import { getSystemFrameworkScopeSources } from "@/lib/framework-scope";
import { effectiveScopeFrameworkIdsForSystems } from "@/lib/first-round";
import { listBoundaries, listBoundariesOfSystem } from "@/lib/compliance-boundary-data";
import { ALREADY_RETIRED_REFUSAL, RETIRED_REFUSAL } from "@/lib/compliance-boundary";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { GET as LIST, POST as CREATE } from "../route";
import { PATCH } from "../[id]/route";
import { POST as RETIRE } from "../[id]/retire/route";
import { POST as JOIN } from "../[id]/systems/route";
import { DELETE as LEAVE } from "../[id]/systems/[systemId]/route";
import { GET as PREVIEW } from "../[id]/systems/[systemId]/preview/route";

/**
 * Retiring a Compliance Boundary (#424), against real Postgres. Fixtures only (CI's database is migrated, not seeded): a
 * non-base Framework with two Controls, Systems and Boundaries named `Test #424 ...`. Nothing here touches the base Framework.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test #424 ${label} ${suffix}`;

function requestAs(userId: string, path: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` });
  return new NextRequest(`http://localhost${path}`, { method: init?.method, headers, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
}

describe("Retiring a Compliance Boundary (#424)", { timeout: 90_000 }, () => {
  const users: Record<string, string> = {};
  let facetId: string;
  let fw1: string;
  let fw2: string;
  const controlIds: string[] = [];
  let c1: string;
  let c2: string;
  const systemIds: string[] = [];
  const boundaryIds: string[] = [];

  async function makeSystem(label: string) {
    const system = await prisma.system.create({
      data: { name: NAME(label), ownerId: users.sysOwner, status: "DRAFT", sensitivityLevel: 3, deploymentFacets: { connect: [{ id: facetId }] } },
    });
    systemIds.push(system.id);
    return system.id;
  }
  /** Created through the API so it is a real Boundary; `ownerKey` names its Boundary Owner. */
  async function makeBoundary(label: string, frameworkIds: string[], ownerKey: string | null = "boundaryOwner") {
    const response = await CREATE(
      requestAs(users.cm, "/api/compliance-boundaries", { method: "POST", body: { name: NAME(label), frameworkIds, boundaryOwnerId: ownerKey ? users[ownerKey] : null } }),
    );
    expect(response.status).toBe(201);
    const id = (await response.json()).boundary.id as string;
    boundaryIds.push(id);
    return id;
  }
  const join = (boundaryId: string, systemId: string, as = "cm") =>
    JOIN(requestAs(users[as], `/api/compliance-boundaries/${boundaryId}/systems`, { method: "POST", body: { systemId } }), { params: Promise.resolve({ id: boundaryId }) });
  const leave = (boundaryId: string, systemId: string, as = "cm") =>
    LEAVE(requestAs(users[as], `/api/compliance-boundaries/${boundaryId}/systems/${systemId}`, { method: "DELETE" }), { params: Promise.resolve({ id: boundaryId, systemId }) });
  const patch = (boundaryId: string, body: unknown, as = "cm") =>
    PATCH(requestAs(users[as], `/api/compliance-boundaries/${boundaryId}`, { method: "PATCH", body }), { params: Promise.resolve({ id: boundaryId }) });
  const preview = (boundaryId: string, systemId: string, as = "cm") =>
    PREVIEW(requestAs(users[as], `/api/compliance-boundaries/${boundaryId}/systems/${systemId}/preview`), { params: Promise.resolve({ id: boundaryId, systemId }) });
  const retire = (boundaryId: string, as: string, body: unknown = { comment: "The contract ended" }) =>
    RETIRE(requestAs(users[as], `/api/compliance-boundaries/${boundaryId}/retire`, { method: "POST", body }), { params: Promise.resolve({ id: boundaryId }) });

  async function loadSystem(id: string) {
    return withEffectiveScope(await prisma.system.findUniqueOrThrow({ where: { id }, include: { deploymentFacets: true, ...EFFECTIVE_SCOPE_SELECT } }));
  }
  async function applicable(id: string) {
    return (await getApplicableControls(await loadSystem(id))).map((control) => control.id).filter((controlId) => controlIds.includes(controlId)).sort();
  }
  const assessments = async (id: string) => (await prisma.controlAssessment.findMany({ where: { systemId: id, controlId: { in: controlIds } }, orderBy: { controlId: "asc" } })).map((row) => `${row.controlId}:${row.status}`);
  const events = (id: string, action: string) => prisma.changeEvent.findMany({ where: { systemId: id, action: action as never }, orderBy: { createdAt: "asc" } });
  /** The Boundary row, Frameworks and members, for "nothing changed" assertions. */
  async function boundarySnapshot(id: string) {
    const row = await prisma.complianceBoundary.findUniqueOrThrow({
      where: { id },
      include: { frameworks: { orderBy: { frameworkId: "asc" } }, systems: { orderBy: { systemId: "asc" } } },
    });
    return JSON.stringify(row);
  }
  async function systemSnapshot(id: string) {
    return JSON.stringify({
      assessments: await assessments(id),
      events: (await prisma.changeEvent.findMany({ where: { systemId: id }, select: { id: true }, orderBy: { id: "asc" } })).map((event) => event.id),
    });
  }

  beforeAll(async () => {
    const roles = { cm: "COMPLIANCE_MANAGER", admin: "ADMIN", viewer: "VIEWER", sysOwner: "SYSTEM_OWNER", boundaryOwner: "SYSTEM_OWNER", otherOwner: "SYSTEM_OWNER" } as const;
    for (const [key, role] of Object.entries(roles)) {
      users[key] = (await prisma.user.create({ data: { email: `test-424-${key}-${suffix}@example.com`, name: `Test #424 ${key}`, role } })).id;
    }
    facetId = (await prisma.deploymentFacet.create({ data: { name: NAME("Facet") } })).id;
    fw1 = (await createFixtureFramework("424 one")).id;
    fw2 = (await createFixtureFramework("424 two")).id;
    for (const code of ["C1", "C2"]) {
      const control = await prisma.control.create({
        data: { code: `T424-${code}-${suffix}`, title: NAME(code), description: "d", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } },
      });
      controlIds.push(control.id);
    }
    [c1, c2] = controlIds;
    await mapControlsToFramework(fw1, [c1, c2]);
    await mapControlsToFramework(fw2, [c2]);
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.complianceBoundary.deleteMany({ where: { id: { in: boundaryIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  }, 60_000);

  describe("who may retire", () => {
    it.each([["boundaryOwner"], ["cm"], ["admin"]])("lets %s retire, recording who, when and why", async (as) => {
      const boundary = await makeBoundary(`allowed ${as}`, [fw1]);
      const response = await retire(boundary, as, { comment: "  The contract ended  " });
      expect(response.status).toBe(200);
      expect((await response.json()).boundary.retirement).toMatchObject({ retiredByName: `Test #424 ${as}`, comment: "The contract ended" });
      const row = await prisma.complianceBoundary.findUniqueOrThrow({ where: { id: boundary } });
      expect(row.retiredAt).not.toBeNull();
      expect(row.retiredById).toBe(users[as]);
      expect(row.retirementComment).toBe("The contract ended");
    });

    it.each([["viewer"], ["sysOwner"], ["otherOwner"]])("refuses %s with 403 and changes nothing", async (as) => {
      const boundary = await makeBoundary(`refused ${as}`, [fw1]);
      const member = await makeSystem(`refused ${as}`);
      expect((await join(boundary, member)).status).toBe(201);
      const [boundaryBefore, systemBefore] = [await boundarySnapshot(boundary), await systemSnapshot(member)];

      expect((await retire(boundary, as)).status).toBe(403);

      expect(await boundarySnapshot(boundary)).toBe(boundaryBefore);
      expect(await systemSnapshot(member)).toBe(systemBefore);
      expect(await applicable(member)).toEqual([c1, c2].sort());
    });

    it("refuses a Boundary Owner of another Boundary, 404s a missing one and requires a comment", async () => {
      const boundary = await makeBoundary("other owner", [fw1], null);
      const mine = await makeBoundary("mine", [fw1]);
      expect((await retire(boundary, "boundaryOwner")).status).toBe(403);
      expect((await retire("missing", "cm")).status).toBe(404);
      for (const body of [{}, { comment: "" }, { comment: "   " }, { comment: "x".repeat(1001) }, null]) {
        const before = await boundarySnapshot(mine);
        expect((await retire(mine, "boundaryOwner", body)).status, JSON.stringify(body)).toBe(400);
        expect(await boundarySnapshot(mine)).toBe(before);
      }
      expect((await prisma.complianceBoundary.findUniqueOrThrow({ where: { id: boundary } })).retiredAt).toBeNull();
    });

    it("is refused for anyone not signed in", async () => {
      const boundary = await makeBoundary("anonymous", [fw1]);
      const response = await RETIRE(new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify({ comment: "x" }) }), { params: Promise.resolve({ id: boundary }) });
      expect(response.status).toBe(401);
      expect((await prisma.complianceBoundary.findUniqueOrThrow({ where: { id: boundary } })).retiredAt).toBeNull();
    });
  });

  describe("the fan-out", () => {
    it("recomputes each member: one keeps the Framework through another active Boundary, the other loses it; one Change Event on each", async () => {
      const retiring = await makeBoundary("fan retiring", [fw1]);
      const keeping = await makeBoundary("fan keeping", [fw1]);
      const keeper = await makeSystem("keeper"); // also in the other, still active Boundary
      const loser = await makeSystem("loser");
      const closed = await makeSystem("closed member");
      for (const id of [keeper, loser, closed]) expect((await join(retiring, id)).status).toBe(201);
      expect((await join(keeping, keeper)).status).toBe(201);
      // The loser worked on C2 (touched), C1 is untouched.
      await prisma.controlAssessment.update({ where: { systemId_controlId: { systemId: loser, controlId: c2 }, }, data: { status: "IN_PROGRESS", assessedById: users.sysOwner } });
      const keeperBefore = await assessments(keeper);
      const joinEvents = async (id: string) => (await events(id, "BOUNDARY_MEMBERSHIP_CHANGED")).length;
      const before = { keeper: await joinEvents(keeper), loser: await joinEvents(loser), closed: await joinEvents(closed) };

      expect((await retire(retiring, "cm")).status).toBe(200);

      // The keeper's scope and Assessments are unchanged.
      expect(await applicable(keeper)).toEqual([c1, c2].sort());
      expect(await assessments(keeper)).toEqual(keeperBefore);
      expect(await events(keeper, "CLASSIFICATION_CHANGED")).toHaveLength(1); // only the join into the first Boundary
      // The loser: the untouched Assessment is deleted, the touched one stays and is stale.
      expect(await applicable(loser)).toEqual([]);
      expect(await assessments(loser)).toEqual([`${c2}:IN_PROGRESS`]);
      expect((await getStaleAssessments(await loadSystem(loser))).map((row) => row.controlId)).toEqual([c2]);
      expect(await assessments(closed)).toEqual([]); // closed or not, every member is recomputed
      // One Change Event per member System naming the retirement, plus the scope change where Controls moved.
      for (const [id, name] of [[keeper, "keeper"], [loser, "loser"], [closed, "closed"]] as const) {
        const retiredEvents = (await events(id, "BOUNDARY_MEMBERSHIP_CHANGED")).filter((event) => event.detail.includes("retired"));
        expect(retiredEvents, name).toHaveLength(1);
        expect(retiredEvents[0].detail).toContain(NAME("fan retiring"));
        expect(await joinEvents(id), name).toBe(before[name === "keeper" ? "keeper" : name === "loser" ? "loser" : "closed"] + 1);
      }
      expect((await events(loser, "CLASSIFICATION_CHANGED")).at(-1)!.detail).toContain("retired");
      expect((await events(loser, "CLASSIFICATION_CHANGED")).at(-1)!.detail).toContain("-1 Control Assessment");
      // The record stays: Frameworks and members are not deleted.
      expect(await prisma.complianceBoundarySystem.count({ where: { boundaryId: retiring } })).toBe(3);
      expect(await prisma.complianceBoundaryFramework.count({ where: { boundaryId: retiring } })).toBe(1);
    });

    it("keeps a Framework the System declares itself", async () => {
      const boundary = await makeBoundary("declared", [fw1]);
      const system = await makeSystem("declared");
      await prisma.system.update({ where: { id: system }, data: { frameworkScopes: { connect: [{ id: fw1 }] } } });
      expect((await join(boundary, system)).status).toBe(201);
      expect((await retire(boundary, "cm")).status).toBe(200);
      expect(await applicable(system)).toEqual([c1, c2].sort());
    });

    it("leaves no reader of a System's scope seeing the retired Boundary's Framework", async () => {
      const boundary = await makeBoundary("readers", [fw2]);
      const system = await makeSystem("readers");
      expect((await join(boundary, system)).status).toBe(201);
      const inScope = async () => ({
        filter: (await prisma.system.count({ where: { id: system, ...systemsWithFrameworkInScope({ id: fw2 }) } })) === 1,
        frameworks: (await prisma.framework.count({ where: { id: fw2, ...frameworksInScopeOfSystem(system) } })) === 1,
        sources: (await getSystemFrameworkScopeSources(system)).some((source) => source.framework.id === fw2),
        bulk: (await effectiveScopeFrameworkIdsForSystems([system])).get(system)!.includes(fw2),
        effective: (await loadSystem(system)).frameworkScopes.some((framework) => framework.id === fw2),
      });
      expect(Object.values(await inScope()).every(Boolean)).toBe(true);

      expect((await retire(boundary, "cm")).status).toBe(200);

      expect(Object.values(await inScope()).some(Boolean)).toBe(false);
    });
  });

  describe("a retired Boundary is read-only", () => {
    it("answers 409 to a second retire and to every write, and changes nothing", async () => {
      const boundary = await makeBoundary("read-only", [fw1]);
      const member = await makeSystem("read-only member");
      const candidate = await makeSystem("read-only candidate");
      expect((await join(boundary, member)).status).toBe(201);
      expect((await retire(boundary, "cm")).status).toBe(200);
      const [boundaryBefore, memberBefore, candidateBefore] = [await boundarySnapshot(boundary), await systemSnapshot(member), await systemSnapshot(candidate)];

      const second = await retire(boundary, "boundaryOwner", { comment: "again" });
      expect(second.status).toBe(409);
      expect((await second.json()).error).toBe(ALREADY_RETIRED_REFUSAL);
      const refusals = [
        await patch(boundary, { name: NAME("renamed") }),
        await patch(boundary, { description: "new" }),
        await patch(boundary, { boundaryOwnerId: users.otherOwner }),
        await patch(boundary, { businessUnitId: null }),
        await patch(boundary, { frameworkIds: [fw1, fw2] }),
        await patch(boundary, { frameworkIds: [fw2] }),
        await join(boundary, candidate),
        await join(boundary, candidate, "boundaryOwner"),
        await leave(boundary, member),
        await preview(boundary, candidate),
      ];
      for (const response of refusals) {
        expect(response.status).toBe(409);
        expect((await response.json()).error).toBe(RETIRED_REFUSAL);
      }

      expect(await boundarySnapshot(boundary)).toBe(boundaryBefore);
      expect(await systemSnapshot(member)).toBe(memberBefore);
      expect(await systemSnapshot(candidate)).toBe(candidateBefore);
    });

    it("still refuses a role that may not write with 403, retired or not", async () => {
      const boundary = await makeBoundary("read-only roles", [fw1]);
      expect((await retire(boundary, "cm")).status).toBe(200);
      expect((await patch(boundary, { name: "x" }, "viewer")).status).toBe(403);
      expect((await join(boundary, "whatever", "viewer")).status).toBe(403);
    });

    it("keeps its name, so a new Boundary can't reuse it", async () => {
      const boundary = await makeBoundary("name kept", [fw1]);
      expect((await retire(boundary, "cm")).status).toBe(200);
      const response = await CREATE(requestAs(users.cm, "/api/compliance-boundaries", { method: "POST", body: { name: NAME("name kept"), frameworkIds: [fw1] } }));
      expect(response.status).toBe(409);
    });
  });

  describe("where retired Boundaries show", () => {
    it("hides them from the list unless asked, and marks them on a System's page", async () => {
      const active = await makeBoundary("list active", [fw1]);
      const retired = await makeBoundary("list retired", [fw1]);
      const system = await makeSystem("list member");
      expect((await join(active, system)).status).toBe(201);
      expect((await join(retired, system)).status).toBe(201);
      expect((await retire(retired, "cm")).status).toBe(200);

      const names = (rows: { name: string }[]) => rows.map((row) => row.name).filter((name) => name.includes(suffix));
      expect(names(await listBoundaries())).toContain(NAME("list active"));
      expect(names(await listBoundaries())).not.toContain(NAME("list retired"));
      const all = await listBoundaries(prisma, { includeRetired: true });
      expect(names(all)).toContain(NAME("list retired"));
      expect(all.find((row) => row.id === retired)!.retiredAt).not.toBeNull();
      expect(all.find((row) => row.id === active)!.retiredAt).toBeNull();
      const api = (await (await LIST(requestAs(users.viewer, "/api/compliance-boundaries"))).json()).boundaries as { name: string }[];
      expect(names(api)).not.toContain(NAME("list retired"));

      expect((await listBoundariesOfSystem(system)).map((row) => `${row.name}:${row.retired}`)).toEqual([`${NAME("list active")}:false`, `${NAME("list retired")}:true`].sort());
    });
  });
});

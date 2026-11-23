import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OnboardingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getApplicableControls, getStaleAssessments } from "@/lib/control-assessments";
import { withEffectiveScope, EFFECTIVE_SCOPE_SELECT } from "@/lib/effective-framework-scope";
import { getSystemFrameworkScopeSources } from "@/lib/framework-scope";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { POST as CREATE } from "../route";
import { PATCH } from "../[id]/route";
import { POST as JOIN } from "../[id]/systems/route";
import { DELETE as LEAVE } from "../[id]/systems/[systemId]/route";
import { POST as DECLARE } from "../../systems/[id]/framework-scopes/route";
import { DELETE as UNDECLARE } from "../../systems/[id]/framework-scopes/[frameworkId]/route";

/**
 * A Compliance Boundary's Frameworks are part of each member System's effective Framework Scope (#419, ADR 0016), against real
 * Postgres. Fixtures only (CI's database is migrated, not seeded): two non-base Frameworks (one with a Review Group, so an
 * Onboarded System that gains its Controls gets a Change Review), Controls scoped to a fixture Deployment Facet, Systems and
 * Boundaries named `Test #419 ...`. Nothing here touches the base Framework.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test #419 ${label} ${suffix}`;

function requestAs(userId: string, path: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` });
  return new NextRequest(`http://localhost${path}`, { method: init?.method, headers, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
}

describe("Compliance Boundaries bring their Frameworks into each member's Framework Scope (#419)", { timeout: 90_000 }, () => {
  let cmId: string;
  let ownerId: string;
  let memberId: string; // in the Review Group of Framework 1
  let facetId: string;
  let groupId: string;
  let fw1: string; // Controls C1, C2; Review Group
  let fw2: string; // Control C3
  let c1: string;
  let c2: string;
  let c3: string;
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  const boundaryIds: string[] = [];

  async function makeSystem(label: string, status: OnboardingStatus = "DRAFT", declared: string[] = []) {
    const system = await prisma.system.create({
      data: {
        name: NAME(label),
        ownerId,
        status,
        sensitivityLevel: 3,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: declared.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    return system.id;
  }
  async function makeBoundary(label: string, frameworkIds: string[]) {
    const response = await CREATE(requestAs(cmId, "/api/compliance-boundaries", { method: "POST", body: { name: NAME(label), frameworkIds } }));
    expect(response.status).toBe(201);
    const id = (await response.json()).boundary.id as string;
    boundaryIds.push(id);
    return id;
  }
  const join = (boundaryId: string, systemId: string) =>
    JOIN(requestAs(cmId, `/api/compliance-boundaries/${boundaryId}/systems`, { method: "POST", body: { systemId } }), { params: Promise.resolve({ id: boundaryId }) });
  const leave = (boundaryId: string, systemId: string) =>
    LEAVE(requestAs(cmId, `/api/compliance-boundaries/${boundaryId}/systems/${systemId}`, { method: "DELETE" }), { params: Promise.resolve({ id: boundaryId, systemId }) });
  const setFrameworks = (boundaryId: string, frameworkIds: string[]) =>
    PATCH(requestAs(cmId, `/api/compliance-boundaries/${boundaryId}`, { method: "PATCH", body: { frameworkIds } }), { params: Promise.resolve({ id: boundaryId }) });
  const declare = (userId: string, systemId: string, frameworkId: string) =>
    DECLARE(requestAs(userId, `/api/systems/${systemId}/framework-scopes`, { method: "POST", body: { frameworkId } }), { params: Promise.resolve({ id: systemId }) });
  const undeclare = (userId: string, systemId: string, frameworkId: string) =>
    UNDECLARE(requestAs(userId, `/api/systems/${systemId}/framework-scopes/${frameworkId}`, { method: "DELETE" }), { params: Promise.resolve({ id: systemId, frameworkId }) });

  async function loadSystem(id: string) {
    return withEffectiveScope(await prisma.system.findUniqueOrThrow({ where: { id }, include: { deploymentFacets: true, ...EFFECTIVE_SCOPE_SELECT } }));
  }
  /** The fixture Controls that apply (on a seeded database the seeded catalog applies too; that isn't this test's business). */
  async function applicable(id: string) {
    return (await getApplicableControls(await loadSystem(id))).map((control) => control.id).filter((controlId) => controlIds.includes(controlId)).sort();
  }
  const assessments = async (id: string) => (await prisma.controlAssessment.findMany({ where: { systemId: id, controlId: { in: controlIds } }, orderBy: { controlId: "asc" } })).map((row) => `${row.controlId}:${row.status}`);
  const events = (id: string, action: string) => prisma.changeEvent.findMany({ where: { systemId: id, action: action as never }, orderBy: { createdAt: "asc" } });
  const reviews = (id: string) => prisma.changeReview.findMany({ where: { systemId: id }, include: { controls: true } });
  /** Everything a scope change could touch on a System, for "nothing changed" assertions. */
  async function snapshot(id: string) {
    return JSON.stringify({
      assessments: await assessments(id),
      events: (await prisma.changeEvent.findMany({ where: { systemId: id }, select: { id: true }, orderBy: { id: "asc" } })).map((event) => event.id),
      reviews: (await reviews(id)).length,
      declared: (await prisma.system.findUniqueOrThrow({ where: { id }, select: { frameworkScopes: { select: { id: true } } } })).frameworkScopes.map((framework) => framework.id).sort(),
    });
  }

  beforeAll(async () => {
    cmId = (await prisma.user.create({ data: { email: `test-419-cm-${suffix}@example.com`, name: "Test #419 CM", role: "COMPLIANCE_MANAGER" } })).id;
    ownerId = (await prisma.user.create({ data: { email: `test-419-owner-${suffix}@example.com`, name: "Test #419 Owner", role: "SYSTEM_OWNER" } })).id;
    memberId = (await prisma.user.create({ data: { email: `test-419-member-${suffix}@example.com`, name: "Test #419 Member", role: "SYSTEM_OWNER" } })).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: NAME("Facet") } })).id;
    groupId = (await prisma.reviewGroup.create({ data: { name: NAME("Group"), members: { connect: [{ id: memberId }] } } })).id;
    fw1 = (await createFixtureFramework("419 one")).id;
    fw2 = (await createFixtureFramework("419 two")).id;
    await prisma.framework.update({ where: { id: fw1 }, data: { reviewGroupId: groupId } });
    for (const code of ["C1", "C2", "C3"]) {
      const control = await prisma.control.create({
        data: { code: `T419-${code}-${suffix}`, title: NAME(code), description: "d", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facetId }] } },
      });
      controlIds.push(control.id);
    }
    [c1, c2, c3] = controlIds;
    await mapControlsToFramework(fw1, [c1, c2]);
    await mapControlsToFramework(fw2, [c3]);
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.complianceBoundary.deleteMany({ where: { id: { in: boundaryIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // Assessments and Change Reviews cascade
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.updateMany({ where: { id: { in: [fw1, fw2] } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: groupId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: [cmId, ownerId, memberId] } } });
  }, 60_000);

  describe("a System joining and leaving", () => {
    it("brings the Boundary's Controls in as Not Started Assessments, with a Change Event, and starts no Change Review before Onboarded", async () => {
      const boundary = await makeBoundary("join", [fw1]);
      const system = await makeSystem("join draft");
      expect(await applicable(system)).toEqual([]);

      expect((await join(boundary, system)).status).toBe(201);

      expect(await applicable(system)).toEqual([c1, c2].sort());
      expect(await assessments(system)).toEqual([`${c1}:NOT_STARTED`, `${c2}:NOT_STARTED`].sort());
      expect(await reviews(system)).toHaveLength(0);
      const [membership] = await events(system, "BOUNDARY_MEMBERSHIP_CHANGED");
      expect(membership.detail).toContain(NAME("join"));
      expect(await events(system, "CLASSIFICATION_CHANGED")).toHaveLength(1);
    });

    it("removes the untouched Assessments on leaving and keeps the touched one as stale", async () => {
      const boundary = await makeBoundary("leave", [fw1]);
      const system = await makeSystem("leave");
      expect((await join(boundary, system)).status).toBe(201);
      await prisma.controlAssessment.update({
        where: { systemId_controlId: { systemId: system, controlId: c2 } },
        data: { status: "IN_PROGRESS", assessedById: ownerId },
      });

      expect((await leave(boundary, system)).status).toBe(200);

      expect(await applicable(system)).toEqual([]);
      expect(await assessments(system)).toEqual([`${c2}:IN_PROGRESS`]);
      expect((await getStaleAssessments(await loadSystem(system))).map((row) => row.controlId)).toContain(c2);
      expect(await prisma.complianceBoundarySystem.count({ where: { boundaryId: boundary, systemId: system } })).toBe(0);
    });

    it("starts a Change Review on an Onboarded System only when the join adds Controls to a group's remit", async () => {
      const boundary = await makeBoundary("onboarded join", [fw1]);
      const adds = await makeSystem("onboarded adds", "ONBOARDED");
      const already = await makeSystem("onboarded already", "ONBOARDED", [fw1]); // declared Framework 1 itself: the join adds nothing
      const quiet = await makeSystem("onboarded quiet", "ONBOARDED", [fw1]);
      await prisma.controlAssessment.createMany({ data: [c1, c2].map((controlId) => ({ systemId: already, controlId })) });

      expect((await join(boundary, adds)).status).toBe(201);
      const [review] = await reviews(adds);
      expect(review.status).toBe("OPEN");
      expect(review.controls.map((row) => `${row.controlId}:${row.reviewGroupId}`).sort()).toEqual([`${c1}:${groupId}`, `${c2}:${groupId}`].sort());
      expect(await events(adds, "CHANGE_REVIEW_STARTED")).toHaveLength(1);
      expect((await prisma.system.findUniqueOrThrow({ where: { id: adds } })).status).toBe("ONBOARDED");

      const before = await snapshot(already);
      expect((await join(boundary, already)).status).toBe(201);
      expect(await reviews(already)).toHaveLength(0);
      const after = JSON.parse(await snapshot(already));
      expect(after.assessments).toEqual(JSON.parse(before).assessments);
      expect(await events(already, "CLASSIFICATION_CHANGED")).toHaveLength(0);
      expect(await events(already, "BOUNDARY_MEMBERSHIP_CHANGED")).toHaveLength(1);
      void quiet;
    });
  });

  describe("a Boundary gaining and dropping a Framework", () => {
    it("fans out to every member in one request, with one Change Event on each System whose Controls changed", async () => {
      const boundary = await makeBoundary("fan-out", [fw2]);
      const first = await makeSystem("fan first");
      const second = await makeSystem("fan second");
      const onboarded = await makeSystem("fan onboarded", "ONBOARDED");
      const alreadyHas = await makeSystem("fan already", "DRAFT", [fw1]);
      for (const id of [first, second, onboarded, alreadyHas]) expect((await join(boundary, id)).status).toBe(201);
      const alreadyBefore = await snapshot(alreadyHas);

      // Gaining Framework 1.
      expect((await setFrameworks(boundary, [fw2, fw1])).status).toBe(200);
      for (const id of [first, second, onboarded]) {
        expect(await applicable(id), id).toEqual([c1, c2, c3].sort());
        expect(await assessments(id), id).toEqual([c1, c2, c3].sort().map((controlId) => `${controlId}:NOT_STARTED`));
        const changes = (await events(id, "CLASSIFICATION_CHANGED")).filter((event) => event.detail.includes("added"));
        expect(changes, id).toHaveLength(1);
        expect(changes[0].detail).toContain(NAME("fan-out"));
      }
      // The Onboarded member's join brought Control 3 in (a Change Review); gaining Framework 1 widened that review.
      expect(await reviews(onboarded)).toHaveLength(1);
      expect((await reviews(onboarded))[0].controls.map((row) => row.controlId).sort()).toEqual([c1, c2, c3].sort());
      expect(await events(onboarded, "CHANGE_REVIEW_WIDENED")).toHaveLength(1);
      expect(await reviews(first)).toHaveLength(0);
      // A member that declared Framework 1 already gains nothing: nothing is written for it.
      expect(await snapshot(alreadyHas)).toBe(alreadyBefore);

      // A repeat of the same list changes nothing.
      const repeatBefore = await Promise.all([first, second, onboarded].map(snapshot));
      expect((await setFrameworks(boundary, [fw1, fw2])).status).toBe(200);
      expect(await Promise.all([first, second, onboarded].map(snapshot))).toEqual(repeatBefore);

      // Dropping Framework 1 again: untouched Assessments go on every member, with one event each.
      await prisma.controlAssessment.update({ where: { systemId_controlId: { systemId: second, controlId: c2 } }, data: { status: "FULFILLED", assessedById: ownerId } });
      expect((await setFrameworks(boundary, [fw2])).status).toBe(200);
      expect(await applicable(first)).toEqual([c3]);
      expect(await assessments(first)).toEqual([`${c3}:NOT_STARTED`]);
      expect(await assessments(second)).toEqual([`${c2}:FULFILLED`, `${c3}:NOT_STARTED`].sort());
      expect((await getStaleAssessments(await loadSystem(second))).map((row) => row.controlId)).toEqual([c2]);
      for (const id of [first, second, onboarded]) {
        expect((await events(id, "CLASSIFICATION_CHANGED")).filter((event) => event.detail.includes("dropped")), id).toHaveLength(1);
      }
      expect(await snapshot(alreadyHas)).toBe(alreadyBefore);
    });

    it("a join racing a Framework change ends with the joined System holding the new Framework's Controls", async () => {
      for (let round = 0; round < 4; round++) {
        const boundary = await makeBoundary(`race ${round}`, [fw2]);
        const existing = await makeSystem(`race existing ${round}`);
        expect((await join(boundary, existing)).status).toBe(201);
        const joining = await makeSystem(`race joining ${round}`);

        const [patched, joined] = await Promise.all([setFrameworks(boundary, [fw2, fw1]), join(boundary, joining)]);
        expect(patched.status).toBe(200);
        expect(joined.status).toBe(201);
        for (const id of [existing, joining]) {
          expect(await applicable(id), `${id} round ${round}`).toEqual([c1, c2, c3].sort());
          expect(await assessments(id), `${id} round ${round}`).toEqual([c1, c2, c3].sort().map((controlId) => `${controlId}:NOT_STARTED`));
        }
      }
    });

    it("leaves a Framework in scope while another Boundary of the System still holds it", async () => {
      const one = await makeBoundary("two boundaries one", [fw1]);
      const two = await makeBoundary("two boundaries two", [fw1]);
      const system = await makeSystem("two boundaries");
      expect((await join(one, system)).status).toBe(201);
      expect((await join(two, system)).status).toBe(201);
      expect(await events(system, "CLASSIFICATION_CHANGED")).toHaveLength(1); // the second join added nothing

      expect((await leave(one, system)).status).toBe(200);
      expect(await applicable(system)).toEqual([c1, c2].sort());
      expect(await events(system, "CLASSIFICATION_CHANGED")).toHaveLength(1);

      expect((await leave(two, system)).status).toBe(200);
      expect(await applicable(system)).toEqual([]);
    });
  });

  describe("a Framework only a Boundary brings in", () => {
    it("is shown with its Boundary and can't be removed by the owner: 409, nothing changes", async () => {
      const boundary = await makeBoundary("only", [fw1]);
      const system = await makeSystem("only via boundary");
      expect((await join(boundary, system)).status).toBe(201);
      const before = await snapshot(system);

      const refused = await undeclare(ownerId, system, fw1);
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toContain(NAME("only"));
      expect(await snapshot(system)).toBe(before);
      expect(await applicable(system)).toEqual([c1, c2].sort());

      const sources = await getSystemFrameworkScopeSources(system);
      expect(sources.find((source) => source.framework.id === fw1)).toMatchObject({ declared: false, boundaries: [{ id: boundary, name: NAME("only") }] });
    });

    it("stays while either the declaration or the Boundary holds it", async () => {
      const boundary = await makeBoundary("both", [fw1]);
      const system = await makeSystem("both");
      expect((await join(boundary, system)).status).toBe(201);
      expect((await declare(ownerId, system, fw1)).status).toBe(201);
      expect(await getSystemFrameworkScopeSources(system).then((sources) => sources.find((source) => source.framework.id === fw1))).toMatchObject({ declared: true, boundaries: [{ id: boundary }] });

      // The owner takes the declaration away: the Boundary still holds the Framework, so its Controls stay.
      const removed = await undeclare(ownerId, system, fw1);
      expect(removed.status).toBe(200);
      expect(await applicable(system)).toEqual([c1, c2].sort());
      expect((await removed.json()).frameworkScopes.find((item: { id: string }) => item.id === fw1)).toMatchObject({ declared: false, boundaries: [{ id: boundary }] });

      // Declared again, then the System leaves: the declaration holds it.
      expect((await declare(ownerId, system, fw1)).status).toBe(201);
      expect((await leave(boundary, system)).status).toBe(200);
      expect(await applicable(system)).toEqual([c1, c2].sort());
      expect((await undeclare(ownerId, system, fw1)).status).toBe(200);
      expect(await applicable(system)).toEqual([]);
    });

    it("shows a declared Framework no Boundary holds as prepared for, not as a task", async () => {
      const system = await makeSystem("prepared", "DRAFT", [fw2]);
      const sources = await getSystemFrameworkScopeSources(system);
      expect(sources.find((source) => source.framework.id === fw2)).toMatchObject({ declared: true, boundaries: [] });
      const base = sources.find((source) => source.framework.isBase);
      expect(base?.boundaries ?? []).toEqual([]);
    });
  });
});

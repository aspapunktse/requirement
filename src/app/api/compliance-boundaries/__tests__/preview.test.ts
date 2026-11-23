import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OnboardingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { getApplicableControls } from "@/lib/control-assessments";
import { withEffectiveScope, EFFECTIVE_SCOPE_SELECT } from "@/lib/effective-framework-scope";
import { loadPreparedCandidates } from "@/lib/compliance-boundary-data";
import { createFixtureFramework, mapControlsToFramework, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { POST as CREATE } from "../route";
import { POST as JOIN } from "../[id]/systems/route";
import { GET as PREVIEW } from "../[id]/systems/[systemId]/preview/route";

/**
 * Candidates and the join preview (#423), against real Postgres. Fixtures only (CI's database is migrated, not seeded): two
 * non-base Frameworks (Framework 1 has a Review Group, so an Onboarded System that gains its Controls gets a Change Review),
 * Controls scoped to a fixture Deployment Facet (C2 is a Both Control the Organization has Fulfilled, so it is effectively
 * Fulfilled by inheritance), Systems and Boundaries named `Test #423 ...`. Nothing here touches the base Framework.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test #423 ${label} ${suffix}`;

function requestAs(userId: string | null, path: string, init?: { method?: string; body?: unknown }) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${path}`, { method: init?.method, headers, body: init?.body === undefined ? undefined : JSON.stringify(init.body) });
}

describe("Boundary candidates and the join preview (#423)", { timeout: 90_000 }, () => {
  let cmId: string;
  let ownerId: string; // owns the fixture Systems
  let boundaryOwnerId: string;
  let strangerId: string; // a System Owner who owns no Boundary
  let viewerId: string;
  let memberId: string;
  let facetId: string;
  let groupId: string;
  let fw1: string; // Controls C1 (Per-System), C2 (Both, Fulfilled by the Organization)
  let fw2: string; // Control C3
  let c1: string;
  let c2: string;
  let c3: string;
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  const boundaryIds: string[] = [];

  async function makeSystem(label: string, status: OnboardingStatus = "DRAFT", declared: string[] = [], closed = false) {
    const system = await prisma.system.create({
      data: {
        name: NAME(label),
        ownerId,
        status: closed ? "REJECTED" : status,
        evaluationClosedAt: closed ? new Date() : null,
        sensitivityLevel: 3,
        deploymentFacets: { connect: [{ id: facetId }] },
        frameworkScopes: { connect: declared.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    return system.id;
  }
  async function makeBoundary(label: string, frameworkIds: string[], boundaryOwner: string | null = null) {
    const response = await CREATE(requestAs(cmId, "/api/compliance-boundaries", { method: "POST", body: { name: NAME(label), frameworkIds, boundaryOwnerId: boundaryOwner } }));
    expect(response.status).toBe(201);
    const id = (await response.json()).boundary.id as string;
    boundaryIds.push(id);
    return id;
  }
  const join = (boundaryId: string, systemId: string) =>
    JOIN(requestAs(cmId, `/api/compliance-boundaries/${boundaryId}/systems`, { method: "POST", body: { systemId } }), { params: Promise.resolve({ id: boundaryId }) });
  const preview = (userId: string | null, boundaryId: string, systemId: string) =>
    PREVIEW(requestAs(userId, `/api/compliance-boundaries/${boundaryId}/systems/${systemId}/preview`), { params: Promise.resolve({ id: boundaryId, systemId }) });

  async function applicable(id: string) {
    const system = withEffectiveScope(await prisma.system.findUniqueOrThrow({ where: { id }, include: { deploymentFacets: true, ...EFFECTIVE_SCOPE_SELECT } }));
    return (await getApplicableControls(system)).map((control) => control.id).filter((controlId) => controlIds.includes(controlId)).sort();
  }
  /** Everything a join could write on a System, for "the preview wrote nothing". */
  async function snapshot(systemId: string, boundaryId: string) {
    return JSON.stringify({
      assessments: (await prisma.controlAssessment.findMany({ where: { systemId }, select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id),
      events: (await prisma.changeEvent.findMany({ where: { systemId }, select: { id: true }, orderBy: { id: "asc" } })).map((row) => row.id),
      reviews: await prisma.changeReview.count({ where: { systemId } }),
      members: await prisma.complianceBoundarySystem.count({ where: { boundaryId } }),
    });
  }

  beforeAll(async () => {
    const user = (label: string, role: "COMPLIANCE_MANAGER" | "SYSTEM_OWNER" | "VIEWER") =>
      prisma.user.create({ data: { email: `test-423-${label}-${suffix}@example.com`, name: `Test #423 ${label}`, role } }).then((created) => created.id);
    cmId = await user("cm", "COMPLIANCE_MANAGER");
    ownerId = await user("owner", "SYSTEM_OWNER");
    boundaryOwnerId = await user("boundary-owner", "SYSTEM_OWNER");
    strangerId = await user("stranger", "SYSTEM_OWNER");
    viewerId = await user("viewer", "VIEWER");
    memberId = await user("member", "SYSTEM_OWNER");
    facetId = (await prisma.deploymentFacet.create({ data: { name: NAME("Facet") } })).id;
    groupId = (await prisma.reviewGroup.create({ data: { name: NAME("Group"), members: { connect: [{ id: memberId }] } } })).id;
    fw1 = (await createFixtureFramework("423 one")).id;
    fw2 = (await createFixtureFramework("423 two")).id;
    await prisma.framework.update({ where: { id: fw1 }, data: { reviewGroupId: groupId } });
    for (const [code, applicability] of [["C1", "PER_SYSTEM"], ["C2", "BOTH"], ["C3", "PER_SYSTEM"]] as const) {
      const control = await prisma.control.create({
        data: { code: `T423-${code}-${suffix}`, title: NAME(code), description: "d", category: "Test", applicability, deploymentFacets: { connect: [{ id: facetId }] } },
      });
      controlIds.push(control.id);
    }
    [c1, c2, c3] = controlIds;
    await prisma.organizationControlImplementation.create({ data: { controlId: c2, status: "FULFILLED", description: "Test #423" } });
    await mapControlsToFramework(fw1, [c1, c2]);
    await mapControlsToFramework(fw2, [c3]);
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.complianceBoundary.deleteMany({ where: { id: { in: boundaryIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } }); // Assessments and Change Reviews cascade
    await cleanupFixtureRequirements();
    await prisma.organizationControlImplementation.deleteMany({ where: { controlId: { in: controlIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.updateMany({ where: { id: { in: [fw1, fw2] } }, data: { reviewGroupId: null } });
    await prisma.reviewGroup.deleteMany({ where: { id: groupId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: [cmId, ownerId, boundaryOwnerId, strangerId, viewerId, memberId] } } });
  }, 60_000);

  describe("the candidates", () => {
    it("lists open non-member Systems prepared for the Boundary's non-base Frameworks, with which ones", async () => {
      const boundary = await makeBoundary("candidates", [fw1, fw2]);
      const both = await makeSystem("cand both", "DRAFT", [fw1, fw2]);
      const one = await makeSystem("cand one", "ONBOARDED", [fw2]);
      const member = await makeSystem("cand member", "DRAFT", [fw1]);
      const unprepared = await makeSystem("cand unprepared");
      const closed = await makeSystem("cand closed", "DRAFT", [fw1], true);
      const otherBoundary = await makeBoundary("candidates other", [fw1]);
      const viaOther = await makeSystem("cand via other boundary"); // in another Boundary holding fw1, but declared nothing
      expect((await join(boundary, member)).status).toBe(201);
      expect((await join(otherBoundary, viaOther)).status).toBe(201);

      const candidates = (await loadPreparedCandidates(boundary)).filter((candidate) => systemIds.includes(candidate.id));
      expect(candidates.map((candidate) => candidate.id).sort()).toEqual([both, one].sort());
      const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
      expect(byId.get(both)!.preparedFor.map((framework) => framework.id).sort()).toEqual([fw1, fw2].sort());
      expect(byId.get(one)!.preparedFor.map((framework) => framework.id)).toEqual([fw2]);
      expect(byId.get(one)!.state).toBe("OPERATING");
      expect(byId.get(both)!.state).toBe("NOT_YET_OPERATING");
      for (const excluded of [member, unprepared, closed, viaOther]) expect(byId.has(excluded), excluded).toBe(false);
    });

    it("has no candidates for a Boundary holding only the base Framework", async () => {
      const base = await prisma.framework.findFirstOrThrow({ where: { isBase: true } });
      const boundary = await makeBoundary("candidates base", [base.id]);
      await makeSystem("cand base prepared", "DRAFT", [fw1]);
      expect(await loadPreparedCandidates(boundary)).toEqual([]);
    });
  });

  describe("the preview", () => {
    it("counts the Controls that would newly apply, with the inherited one already Fulfilled, and flags a Change Review", async () => {
      const boundary = await makeBoundary("preview counts", [fw1]);
      const draft = await makeSystem("prev draft");
      const onboarded = await makeSystem("prev onboarded", "ONBOARDED");

      const draftBody = await (await preview(cmId, boundary, draft)).json();
      expect(draftBody.preview.newControls.map((control: { id: string }) => control.id).sort()).toEqual([c1, c2].sort());
      expect(Object.fromEntries(draftBody.preview.newControls.map((control: { id: string; fulfilled: boolean }) => [control.id, control.fulfilled]))).toEqual({ [c1]: false, [c2]: true });
      expect(draftBody.preview).toMatchObject({ onboarded: false, startsChangeReview: false, state: "NOT_YET_OPERATING" });

      const onboardedBody = await (await preview(cmId, boundary, onboarded)).json();
      expect(onboardedBody.preview).toMatchObject({ onboarded: true, startsChangeReview: true, state: "OPERATING" });
      expect(onboardedBody.preview.newControls).toHaveLength(2);
    });

    it("says nothing new applies for a prepared System, with no Change Review even when Onboarded", async () => {
      const boundary = await makeBoundary("preview prepared", [fw1]);
      const prepared = await makeSystem("prev prepared", "ONBOARDED", [fw1]);
      const { preview: body } = await (await preview(cmId, boundary, prepared)).json();
      expect(body.newControls).toEqual([]);
      expect(body).toMatchObject({ onboarded: true, startsChangeReview: false });
    });

    it("a person-set Assessment kept from before decides the status, so inheritance does not make it Fulfilled", async () => {
      const boundary = await makeBoundary("preview own", [fw1]);
      const system = await makeSystem("prev own");
      await prisma.controlAssessment.create({ data: { systemId: system, controlId: c2, status: "IN_PROGRESS", assessedById: ownerId } }); // stale: C2 doesn't apply yet
      const { preview: body } = await (await preview(cmId, boundary, system)).json();
      expect(Object.fromEntries(body.newControls.map((control: { id: string; fulfilled: boolean }) => [control.id, control.fulfilled]))).toEqual({ [c1]: false, [c2]: false });
    });

    it("equals the actual join: the same newly applicable Controls, the same Assessments and Change Review", async () => {
      const boundary = await makeBoundary("equals", [fw1, fw2]);
      const cases = [
        await makeSystem("eq draft"),
        await makeSystem("eq onboarded", "ONBOARDED"),
        await makeSystem("eq prepared one", "DRAFT", [fw1]),
        await makeSystem("eq prepared all onboarded", "ONBOARDED", [fw1, fw2]),
      ];
      for (const systemId of cases) {
        const before = await applicable(systemId);
        const assessmentsBefore = new Set((await prisma.controlAssessment.findMany({ where: { systemId }, select: { controlId: true } })).map((row) => row.controlId));
        const { preview: body } = await (await preview(cmId, boundary, systemId)).json();

        expect((await join(boundary, systemId)).status).toBe(201);

        const after = await applicable(systemId);
        const added = after.filter((controlId) => !before.includes(controlId));
        expect(body.newControls.map((control: { id: string }) => control.id).sort(), systemId).toEqual(added);
        const created = (await prisma.controlAssessment.findMany({ where: { systemId, controlId: { in: controlIds } }, select: { controlId: true } })).map((row) => row.controlId).filter((controlId) => !assessmentsBefore.has(controlId));
        expect(created.sort(), systemId).toEqual(added);
        expect(await prisma.changeReview.count({ where: { systemId }, }) > 0, systemId).toBe(body.startsChangeReview);
      }
    });

    it("writes nothing", async () => {
      const boundary = await makeBoundary("read only", [fw1]);
      const onboarded = await makeSystem("ro onboarded", "ONBOARDED");
      const before = await snapshot(onboarded, boundary);
      expect((await preview(cmId, boundary, onboarded)).status).toBe(200);
      expect(await snapshot(onboarded, boundary)).toBe(before);
    });
  });

  describe("who may preview, and what is refused", () => {
    it("lets the Boundary Owner, a Compliance Manager and an Admin through; refuses a stranger, a viewer and no user, changing nothing", async () => {
      const boundary = await makeBoundary("authz", [fw1], boundaryOwnerId);
      const system = await makeSystem("authz");
      const before = await snapshot(system, boundary);
      expect((await preview(boundaryOwnerId, boundary, system)).status).toBe(200);
      expect((await preview(cmId, boundary, system)).status).toBe(200);
      for (const refused of [strangerId, viewerId, ownerId]) expect((await preview(refused, boundary, system)).status, refused).toBe(403);
      expect((await preview(null, boundary, system)).status).toBe(401);
      expect(await snapshot(system, boundary)).toBe(before);
    });

    it("answers 404 for an unknown Boundary or System, and 409 for a closed System or a member", async () => {
      const boundary = await makeBoundary("refusals", [fw1]);
      const closed = await makeSystem("refusal closed", "DRAFT", [fw1], true);
      const member = await makeSystem("refusal member");
      expect((await join(boundary, member)).status).toBe(201);
      expect((await preview(cmId, "missing", member)).status).toBe(404);
      expect((await preview(cmId, boundary, "missing")).status).toBe(404);
      expect((await preview(cmId, boundary, closed)).status).toBe(409);
      expect((await preview(cmId, boundary, member)).status).toBe(409);
    });
  });
});

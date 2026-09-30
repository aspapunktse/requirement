import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { OnboardingStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import {
  getApplicableControl,
  getApplicableControls,
  getControlForAssessmentEdit,
  getStaleAssessments,
  getSystemAssessments,
} from "@/lib/control-assessments";
import { getBaseFramework, mapControlsToBase, mapControlsToFramework } from "@/test/framework-fixtures";
import { GET, POST } from "../route";
import { DELETE } from "../[frameworkId]/route";

/**
 * Framework Scope drives applicability (ADR 0007, #85): a Per-System/Both
 * Control applies to a System only if it's mapped to a Requirement of a
 * Published Framework in the System's effective Framework Scope (declared scope
 * rows + the base Framework, always), on top of its facet/overlay/impact
 * scoping. Every fixture Control here is scoped to one fixture Deployment
 * Facet so it can't leak into other test files' Systems.
 */

const SUFFIX = Date.now();

function req(path: string, method: string, userId: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("Framework Scope drives applicability (#85)", () => {
  let ownerId: string;
  let adminId: string;
  let facetId: string;
  let baseId: string;
  let publishedId: string; // a Published, non-base Framework
  let draftId: string; // a Draft Framework
  let baseControlId: string; // mapped to the base Framework
  let pControlId: string; // mapped to the Published non-base Framework
  let pControl2Id: string; // likewise (used for the "touched Assessment is kept" case)
  let draftControlId: string; // mapped only to the Draft Framework
  let unmappedControlId: string; // mapped to no Framework at all
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  let systemId: string;

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const declare = (userId: string, frameworkId: string, id = systemId) =>
    POST(req(`/api/systems/${id}/framework-scopes`, "POST", userId, { frameworkId }), ctx(id));
  const remove = (userId: string, frameworkId: string, id = systemId) =>
    DELETE(req(`/api/systems/${id}/framework-scopes/${frameworkId}`, "DELETE", userId), {
      params: Promise.resolve({ id, frameworkId }),
    });

  async function makeSystem(status: OnboardingStatus = "DRAFT", scopeIds: string[] = []) {
    const system = await prisma.system.create({
      data: {
        name: `Test FwScope Applicability System ${SUFFIX}-${systemIds.length}`,
        ownerId,
        status,
        deploymentFacets: { connect: { id: facetId } },
        frameworkScopes: { connect: scopeIds.map((id) => ({ id })) },
      },
    });
    systemIds.push(system.id);
    return system.id;
  }

  function loadSystem(id: string) {
    return prisma.system.findUniqueOrThrow({
      where: { id },
      include: { deploymentFacets: true, regulatoryOverlays: true, frameworkScopes: { select: { id: true } } },
    });
  }

  /** The applicable fixture Controls (on a seeded DB the seeded catalog applies too; it isn't this test's business). */
  async function applicableIds(id: string) {
    return (await getApplicableControls(await loadSystem(id)))
      .map((c) => c.id)
      .filter((controlId) => controlIds.includes(controlId))
      .sort();
  }

  /** Everything a Framework Scope change could touch, for "no DB change" assertions. */
  async function snapshot(id: string) {
    const system = await loadSystem(id);
    return {
      scopes: system.frameworkScopes.map((f) => f.id).sort(),
      assessments: (await prisma.controlAssessment.findMany({ where: { systemId: id }, orderBy: { controlId: "asc" } })).map(
        (a) => `${a.controlId}:${a.status}:${a.assessedById}`,
      ),
      changeEvents: await prisma.changeEvent.count({ where: { systemId: id } }),
    };
  }

  async function makeControl(code: string, extra: { mandatory?: boolean } = {}) {
    const control = await prisma.control.create({
      data: {
        code: `TEST-FWS-${code}-${SUFFIX}`,
        title: `Test FwScope ${code}`,
        description: "d",
        category: "Test",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: { id: facetId } },
        ...extra,
      },
    });
    controlIds.push(control.id);
    return control.id;
  }

  beforeAll(async () => {
    const [owner, admin] = await Promise.all([
      prisma.user.create({
        data: { email: `test-fws-applic-owner-${SUFFIX}@example.com`, name: "FwScope Owner", role: "SYSTEM_OWNER" },
      }),
      prisma.user.create({
        data: { email: `test-fws-applic-admin-${SUFFIX}@example.com`, name: "FwScope Admin", role: "ADMIN" },
      }),
    ]);
    ownerId = owner.id;
    adminId = admin.id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test FwScope Facet ${SUFFIX}` } })).id;
    baseId = (await getBaseFramework()).id;
    [publishedId, draftId] = (
      await Promise.all([
        prisma.framework.create({ data: { name: `Test FwScope Published FW ${SUFFIX}`, version: "1", status: "PUBLISHED" } }),
        prisma.framework.create({ data: { name: `Test FwScope Draft FW ${SUFFIX}`, version: "1" } }),
      ])
    ).map((f) => f.id);

    baseControlId = await makeControl("BASE");
    pControlId = await makeControl("P1");
    pControl2Id = await makeControl("P2");
    draftControlId = await makeControl("DRAFT");
    unmappedControlId = await makeControl("NONE");
    await mapControlsToBase([baseControlId]);
    await mapControlsToFramework(publishedId, [pControlId, pControl2Id]);
    await mapControlsToFramework(draftId, [draftControlId]);
  });

  beforeEach(async () => {
    systemId = await makeSystem();
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.framework.deleteMany({ where: { id: { in: [publishedId, draftId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
  });

  describe("the applicable-Control set", () => {
    it("gives a System with only the base Framework in scope exactly the base-mapped Controls, with or without a stored row", async () => {
      const implicit = await applicableIds(systemId);
      const explicitId = await makeSystem("DRAFT", [baseId]);
      const explicit = await applicableIds(explicitId);

      expect(implicit).toEqual([baseControlId]);
      expect(explicit).toEqual(implicit);
    });

    it("applies a Control mapped to no Framework to nothing, however it's scoped", async () => {
      const withEverything = await makeSystem("DRAFT", [baseId, publishedId, draftId]);
      expect(await applicableIds(withEverything)).not.toContain(unmappedControlId);
      expect(await getApplicableControl(await loadSystem(withEverything), unmappedControlId)).toBeNull();
    });

    it("adds a Published non-base Framework's Controls once it's in scope, and getApplicableControl agrees", async () => {
      const inScope = await makeSystem("DRAFT", [publishedId]);
      expect(await applicableIds(inScope)).toEqual([baseControlId, pControlId, pControl2Id].sort());
      expect(await getApplicableControl(await loadSystem(inScope), pControlId)).toMatchObject({ id: pControlId });

      // ...and not before.
      expect(await getApplicableControl(await loadSystem(systemId), pControlId)).toBeNull();
    });

    it("treats a scope row pointing at a Draft Framework as inert until it's published", async () => {
      const draftScoped = await makeSystem("DRAFT", [draftId]);
      expect(await applicableIds(draftScoped)).toEqual([baseControlId]);

      await prisma.framework.update({ where: { id: draftId }, data: { status: "PUBLISHED" } });
      try {
        expect(await applicableIds(draftScoped)).toEqual([baseControlId, draftControlId].sort());
      } finally {
        await prisma.framework.update({ where: { id: draftId }, data: { status: "DRAFT" } });
      }
    });

    it("counts a Control once even when several of its Requirements are in scope", async () => {
      // pControlId is also mapped to a base Requirement, so it's reachable through two Frameworks.
      const extra = await mapControlsToBase([pControlId]);
      const both = await makeSystem("DRAFT", [publishedId]);
      const ids = (await getApplicableControls(await loadSystem(both))).map((c) => c.id);
      expect(ids.filter((id) => id === pControlId)).toHaveLength(1);
      // Reachable through the base alone now, with no scope row for the Published Framework.
      expect(await applicableIds(systemId)).toContain(pControlId);
      await prisma.requirement.delete({ where: { id: extra } });
    });
  });

  describe("declaring a Framework Scope", () => {
    it("creates Not Started Assessments for the newly applicable Controls and logs +added/-removed", async () => {
      expect(await snapshot(systemId)).toMatchObject({ scopes: [], assessments: [] });

      const response = await declare(ownerId, publishedId);
      expect(response.status).toBe(201);

      const { frameworkScopes } = await response.json();
      expect(frameworkScopes.map((f: { id: string }) => f.id).sort()).toEqual([baseId, publishedId].sort());

      const assessments = await prisma.controlAssessment.findMany({ where: { systemId } });
      expect(assessments.map((a) => a.controlId).sort()).toEqual([pControlId, pControl2Id].sort());
      expect(assessments.every((a) => a.status === "NOT_STARTED" && a.assessedById === null)).toBe(true);

      const event = await prisma.changeEvent.findFirstOrThrow({ where: { systemId } });
      expect(event.action).toBe("CLASSIFICATION_CHANGED");
      expect(event.detail).toContain("+2/-0");
      expect(event.detail).toContain(`Test FwScope Published FW ${SUFFIX}`);
    });

    it("leaves Assessments that already exist alone, and declaring twice is a no-op diff", async () => {
      await declare(ownerId, publishedId);
      const before = await snapshot(systemId);
      const response = await declare(ownerId, publishedId);
      expect(response.status).toBe(201);
      expect((await snapshot(systemId)).assessments).toEqual(before.assessments);
      expect((await snapshot(systemId)).scopes).toEqual(before.scopes);
    });

    it("declaring the base Framework is accepted but changes nothing", async () => {
      const before = await snapshot(systemId);
      const response = await declare(ownerId, baseId);
      expect(response.status).toBe(201);
      expect(await snapshot(systemId)).toEqual(before);
    });

    it("refuses a Draft Framework (400) and changes nothing", async () => {
      const before = await snapshot(systemId);
      const response = await declare(adminId, draftId);
      expect(response.status).toBe(400);
      expect(await snapshot(systemId)).toEqual(before);
    });
  });

  describe("removing a Framework Scope", () => {
    it("deletes untouched Assessments and keeps touched ones as stale", async () => {
      await declare(ownerId, publishedId);
      // A human has worked on pControl2's Assessment.
      await prisma.controlAssessment.update({
        where: { systemId_controlId: { systemId, controlId: pControl2Id } },
        data: { status: "IN_PROGRESS", assessedById: ownerId, assessedAt: new Date() },
      });

      const response = await remove(ownerId, publishedId);
      expect(response.status).toBe(200);

      const remaining = await prisma.controlAssessment.findMany({ where: { systemId } });
      expect(remaining.map((a) => a.controlId)).toEqual([pControl2Id]);
      expect(remaining[0].status).toBe("IN_PROGRESS");

      const system = await loadSystem(systemId);
      expect(system.frameworkScopes).toEqual([]);
      expect(await applicableIds(systemId)).toEqual([baseControlId]);

      // The kept Assessment surfaces as stale, and stays editable (#15).
      expect((await getStaleAssessments(system)).map((a) => a.controlId)).toEqual([pControl2Id]);
      expect(await getControlForAssessmentEdit(system, pControl2Id)).toMatchObject({ id: pControl2Id });
      expect(
        (await getSystemAssessments(system)).map((r) => r.control.id).filter((controlId) => controlIds.includes(controlId)),
      ).toEqual([baseControlId]);

      const events = await prisma.changeEvent.findMany({ where: { systemId }, orderBy: { createdAt: "asc" } });
      expect(events.at(-1)?.detail).toContain("+0/-1");
    });

    it("keeps a Control's Assessment when it's still applicable through another Framework in scope", async () => {
      // pControlId is mapped to the base Framework as well as the Published one.
      const requirementId = await mapControlsToBase([pControlId]);
      try {
        await prisma.controlAssessment.create({ data: { systemId, controlId: pControlId } });
        await declare(ownerId, publishedId);
        await remove(ownerId, publishedId);
        const remaining = await prisma.controlAssessment.findMany({ where: { systemId } });
        // pControl2 (Published only) was added and removed again; pControl stayed applicable via the base throughout.
        expect(remaining.map((a) => a.controlId)).toEqual([pControlId]);
        expect(await applicableIds(systemId)).toContain(pControlId);
      } finally {
        await prisma.requirement.delete({ where: { id: requirementId } });
      }
    });

    it("removes a stale scope row pointing at a Draft Framework without touching any Assessment", async () => {
      const draftScoped = await makeSystem("DRAFT", [draftId]);
      await prisma.controlAssessment.create({ data: { systemId: draftScoped, controlId: baseControlId } });
      const response = await remove(ownerId, draftId, draftScoped);
      expect(response.status).toBe(200);
      const after = await snapshot(draftScoped);
      expect(after.scopes).toEqual([]);
      expect(after.assessments).toEqual([`${baseControlId}:NOT_STARTED:null`]);
    });

    it("refuses to remove the base Framework (409), whether or not a scope row is stored, and changes nothing", async () => {
      const withoutRow = systemId;
      const withRow = await makeSystem("DRAFT", [baseId]);
      for (const id of [withoutRow, withRow]) {
        await prisma.controlAssessment.create({ data: { systemId: id, controlId: baseControlId } });
        const before = await snapshot(id);
        for (const userId of [ownerId, adminId]) {
          const response = await remove(userId, baseId, id);
          expect(response.status).toBe(409);
          expect((await response.json()).error).toMatch(/base Framework/);
        }
        expect(await snapshot(id)).toEqual(before);
      }
      expect((await snapshot(withRow)).scopes).toEqual([baseId]);
    });
  });

  describe("reading a System's Framework Scope", () => {
    it("always lists the base Framework, flagged isBase, even with no stored row", async () => {
      const response = await GET(req(`/api/systems/${systemId}/framework-scopes`, "GET", ownerId), ctx(systemId));
      const { frameworkScopes } = await response.json();
      expect(frameworkScopes).toHaveLength(1);
      expect(frameworkScopes[0]).toMatchObject({ id: baseId, isBase: true });
    });

    it("lists the base once when it also has a stored row, alongside the declared Frameworks", async () => {
      const id = await makeSystem("DRAFT", [baseId, publishedId]);
      const response = await GET(req(`/api/systems/${id}/framework-scopes`, "GET", ownerId), ctx(id));
      const { frameworkScopes } = await response.json();
      expect(frameworkScopes.map((f: { id: string }) => f.id).sort()).toEqual([baseId, publishedId].sort());
    });
  });

  describe("the Draft-only lock (until #86)", () => {
    it.each(["IN_REVIEW", "APPROVED", "ONBOARDED"] as const)(
      "refuses declaring and removing on a %s System, for its owner and an Admin, changing nothing",
      async (status) => {
        const id = await makeSystem(status, [publishedId]);
        await prisma.controlAssessment.create({ data: { systemId: id, controlId: pControlId } });
        const before = await snapshot(id);

        for (const userId of [ownerId, adminId]) {
          const declared = await declare(userId, publishedId, id);
          const declaredBase = await declare(userId, baseId, id);
          const removed = await remove(userId, publishedId, id);
          const removedBase = await remove(userId, baseId, id);
          expect([declared.status, declaredBase.status, removed.status, removedBase.status]).toEqual([403, 403, 403, 403]);
          expect((await removed.json()).error).toMatch(/Draft System/);
        }
        expect(await snapshot(id)).toEqual(before);
        expect(await applicableIds(id)).toEqual([baseControlId, pControlId, pControl2Id].sort());
      },
    );
  });
});

import { NextRequest } from "next/server";
import type { UserRole } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { mapControlsToBase, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { GET as listControls, POST as createControl } from "../../route";
import { GET, PATCH } from "../route";

/**
 * The Control Owner (F-CL.3, #119): one optional User per Control, assigned and cleared through
 * `PATCH /api/controls/[id]`. Curation, so it writes no Change Event and recomputes nothing.
 * Self-contained fixtures (an ORGANIZATIONAL Control, plus one Facet-scoped Control and a System
 * for the "no recompute" check); nothing depends on seeded data.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const email = (key: string) => `test-control-owner-${key}-${SUFFIX}@example.com`;

const ROLES: Record<string, UserRole> = {
  admin: "ADMIN",
  complianceManager: "COMPLIANCE_MANAGER",
  riskOwner: "RISK_OWNER",
  systemOwner: "SYSTEM_OWNER",
  reviewer: "REVIEWER",
  viewer: "VIEWER",
  businessRiskOwner: "BUSINESS_RISK_OWNER",
};
// Every role except the two that manage the Control Library.
const REFUSED = ["riskOwner", "systemOwner", "reviewer", "viewer", "businessRiskOwner"];

function req(id: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/controls/${id}`, {
    method: body === undefined ? "GET" : "PATCH",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const patchOwner = (controlId: string, userId: string | null, ownerId: string | null) =>
  PATCH(req(controlId, userId, { ownerId }), ctxFor(controlId));

describe("Control Owner (#119)", () => {
  const users: Record<string, string> = {};
  let spareId: string;
  let controlId: string;
  let facetAId: string;
  let facetBId: string;
  let scopedControlId: string;
  let systemId: string;
  const extraUserIds: string[] = [];

  beforeAll(async () => {
    for (const [key, role] of Object.entries(ROLES)) {
      users[key] = (
        await prisma.user.create({ data: { email: email(key), name: `Test Owner ${key}`, role } })
      ).id;
    }
    // A User to assign as the Control Owner (a VIEWER: any role may own a Control).
    spareId = users.viewer;

    facetAId = (await prisma.deploymentFacet.create({ data: { name: `Test Owner Facet A ${SUFFIX}` } })).id;
    facetBId = (await prisma.deploymentFacet.create({ data: { name: `Test Owner Facet B ${SUFFIX}` } })).id;
    scopedControlId = (
      await prisma.control.create({
        data: {
          code: `TEST-OWN-SCOPED-${SUFFIX}`,
          title: "Test Control Owner scoped control",
          description: "Facet-scoped, so it can't leak into other files' Systems.",
          category: "Test",
          applicability: "BOTH",
          question: "Does it?",
          deploymentFacets: { connect: { id: facetAId } },
        },
      })
    ).id;
    await mapControlsToBase([scopedControlId]);
    systemId = (
      await prisma.system.create({
        data: {
          name: `Test Owner System ${SUFFIX}`,
          ownerId: users.systemOwner,
          status: "ONBOARDED",
          deploymentFacets: { connect: { id: facetAId } },
        },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.control.deleteMany({ where: { id: scopedControlId } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetAId, facetBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [...Object.values(users), ...extraUserIds] } } });
  });

  beforeEach(async () => {
    controlId = (
      await prisma.control.create({
        data: {
          code: `TEST-OWN-ORG-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
          title: "Test Control Owner control",
          description: "Organizational, so ownership has nothing to do with applicability.",
          category: "Test",
          applicability: "ORGANIZATIONAL",
        },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.control.deleteMany({ where: { id: controlId } });
  });

  const ownerIdOf = async (id: string) => (await prisma.control.findUniqueOrThrow({ where: { id } })).ownerId;

  describe("assigning and clearing", () => {
    it.each(["complianceManager", "admin"])("lets a %s assign and then clear the Control Owner", async (who) => {
      expect(await ownerIdOf(controlId)).toBeNull();

      const assigned = await patchOwner(controlId, users[who], spareId);
      expect(assigned.status).toBe(200);
      expect((await assigned.json()).control.owner).toEqual({ id: spareId, name: "Test Owner viewer" });
      expect(await ownerIdOf(controlId)).toBe(spareId);

      const cleared = await patchOwner(controlId, users[who], null);
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).control.owner).toBeNull();
      expect(await ownerIdOf(controlId)).toBeNull();
    });

    it("lets any User be the Control Owner, whatever their role", async () => {
      for (const key of Object.keys(ROLES)) {
        const response = await patchOwner(controlId, users.complianceManager, users[key]);
        expect(response.status, key).toBe(200);
        expect(await ownerIdOf(controlId)).toBe(users[key]);
      }
    });

    it("replaces one Control Owner with another", async () => {
      await patchOwner(controlId, users.admin, users.viewer);
      const response = await patchOwner(controlId, users.admin, users.reviewer);
      expect(response.status).toBe(200);
      expect(await ownerIdOf(controlId)).toBe(users.reviewer);
    });

    it("can change the Control Owner together with other fields, and leaves it alone when ownerId is absent", async () => {
      await patchOwner(controlId, users.admin, spareId);
      const response = await PATCH(req(controlId, users.admin, { title: "Renamed" }), ctxFor(controlId));
      expect(response.status).toBe(200);
      expect(await ownerIdOf(controlId)).toBe(spareId);

      const both = await PATCH(req(controlId, users.admin, { title: "Renamed again", ownerId: null }), ctxFor(controlId));
      expect(both.status).toBe(200);
      expect(await ownerIdOf(controlId)).toBeNull();
      expect((await prisma.control.findUniqueOrThrow({ where: { id: controlId } })).title).toBe("Renamed again");
    });
  });

  describe("who may not", () => {
    it.each(REFUSED)("refuses a %s (403) and changes nothing", async (who) => {
      await patchOwner(controlId, users.admin, users.reviewer);

      const assign = await patchOwner(controlId, users[who], spareId);
      expect(assign.status).toBe(403);
      const clear = await patchOwner(controlId, users[who], null);
      expect(clear.status).toBe(403);

      expect(await ownerIdOf(controlId)).toBe(users.reviewer);
    });

    it("refuses an unauthenticated request (401) and changes nothing", async () => {
      const response = await patchOwner(controlId, null, spareId);
      expect(response.status).toBe(401);
      expect(await ownerIdOf(controlId)).toBeNull();
    });
  });

  describe("an Internal Auditor can't be a Control Owner (#147, decision of 2026-10-13)", () => {
    async function makeAuditor() {
      const auditor = await prisma.user.create({
        data: { email: email(`ia-${extraUserIds.length}`), name: "Test Owner IA", role: "INTERNAL_AUDITOR" },
      });
      extraUserIds.push(auditor.id);
      return auditor.id;
    }

    it.each(["complianceManager", "admin"])("refuses %s assigning one (400) and changes nothing", async (who) => {
      const auditorId = await makeAuditor();
      const response = await patchOwner(controlId, users[who], auditorId);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("An Internal Auditor can't be a Control Owner: the role is read-only");
      expect(await ownerIdOf(controlId)).toBeNull();
    });

    it("keeps the existing Control Owner when an auditor is refused, together with other fields", async () => {
      const auditorId = await makeAuditor();
      await patchOwner(controlId, users.admin, users.reviewer);
      const response = await PATCH(req(controlId, users.admin, { title: "Not saved", ownerId: auditorId }), ctxFor(controlId));
      expect(response.status).toBe(400);
      expect(await ownerIdOf(controlId)).toBe(users.reviewer);
      expect((await prisma.control.findUniqueOrThrow({ where: { id: controlId } })).title).not.toBe("Not saved");
    });

    it("still clears an owner and assigns a non-auditor", async () => {
      await patchOwner(controlId, users.admin, users.reviewer);
      expect((await patchOwner(controlId, users.admin, null)).status).toBe(200);
      expect((await patchOwner(controlId, users.admin, users.viewer)).status).toBe(200);
      expect(await ownerIdOf(controlId)).toBe(users.viewer);
    });
  });

  describe("validation", () => {
    it("rejects a User id that doesn't exist (400) and changes nothing", async () => {
      await patchOwner(controlId, users.admin, spareId);

      const response = await patchOwner(controlId, users.admin, "no-such-user");
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/Control Owner/);
      expect(await ownerIdOf(controlId)).toBe(spareId);
    });

    it("does not apply the other fields of a request whose ownerId is unknown", async () => {
      const response = await PATCH(
        req(controlId, users.admin, { title: "Must not stick", ownerId: "no-such-user" }),
        ctxFor(controlId),
      );
      expect(response.status).toBe(400);
      expect((await prisma.control.findUniqueOrThrow({ where: { id: controlId } })).title).toBe(
        "Test Control Owner control",
      );
    });

    it.each([["an empty string", ""], ["a number", 7]])("rejects %s as ownerId (400)", async (_label, ownerId) => {
      const response = await PATCH(req(controlId, users.admin, { ownerId }), ctxFor(controlId));
      expect(response.status).toBe(400);
      expect(await ownerIdOf(controlId)).toBeNull();
    });
  });

  describe("deleting the User", () => {
    it("leaves the Control unassigned when its Control Owner is deleted", async () => {
      const doomed = await prisma.user.create({
        data: { email: email("doomed"), name: "Test Owner doomed", role: "SYSTEM_OWNER" },
      });
      extraUserIds.push(doomed.id);
      await patchOwner(controlId, users.admin, doomed.id);
      expect(await ownerIdOf(controlId)).toBe(doomed.id);

      await prisma.user.delete({ where: { id: doomed.id } });

      const control = await prisma.control.findUniqueOrThrow({ where: { id: controlId } });
      expect(control.ownerId).toBeNull();
    });
  });

  describe("no side effects", () => {
    it("writes no Change Event and creates or removes no Control Assessment, however the owner changes", async () => {
      const events = () => prisma.changeEvent.count({ where: { systemId } });
      const assessments = () => prisma.controlAssessment.count({ where: { systemId } });
      // Guards the check below: the fixture Control applies to the fixture System, so a recompute
      // would have created an Assessment for it. Nothing has yet.
      expect(await assessments()).toBe(0);

      for (const ownerId of [spareId, users.reviewer, null]) {
        const response = await patchOwner(scopedControlId, users.complianceManager, ownerId);
        expect(response.status).toBe(200);
      }
      expect(await assessments()).toBe(0);
      expect(await events()).toBe(0);
    });

    it("would have created the Assessment had applicability changed (the guard above can fail)", async () => {
      const response = await PATCH(
        req(scopedControlId, users.admin, { deploymentFacetIds: [facetAId, facetBId] }),
        ctxFor(scopedControlId),
      );
      expect(response.status).toBe(200);
      expect(await prisma.controlAssessment.count({ where: { systemId, controlId: scopedControlId } })).toBe(1);
      await prisma.controlAssessment.deleteMany({ where: { systemId } });
      await prisma.changeEvent.deleteMany({ where: { systemId } });
      await prisma.control.update({ where: { id: scopedControlId }, data: { deploymentFacets: { set: [{ id: facetAId }] } } });
    });
  });

  describe("reading it", () => {
    it("GET /api/controls and GET /api/controls/[id] return the owner's id and name, without an email", async () => {
      await patchOwner(controlId, users.admin, spareId);

      const single = await (await GET(req(controlId, users.viewer), ctxFor(controlId))).json();
      expect(single.control.owner).toEqual({ id: spareId, name: "Test Owner viewer" });

      const list = await (
        await listControls(new NextRequest("http://localhost/api/controls", {
          headers: { cookie: `${ACTING_USER_COOKIE}=${users.viewer}` },
        }))
      ).json();
      const row = list.controls.find((c: { id: string }) => c.id === controlId);
      expect(row.owner).toEqual({ id: spareId, name: "Test Owner viewer" });
      expect(JSON.stringify(row.owner)).not.toContain("@");
    });

    it("returns owner: null for an unassigned Control", async () => {
      const single = await (await GET(req(controlId, users.viewer), ctxFor(controlId))).json();
      expect(single.control.owner).toBeNull();
    });

    it("POST /api/controls takes no owner: a Control starts unassigned", async () => {
      const code = `TEST-OWN-POST-${SUFFIX}`;
      try {
        const response = await createControl(
          new NextRequest("http://localhost/api/controls", {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${users.admin}` },
            body: JSON.stringify({
              code,
              title: "Test created",
              description: "d",
              category: "Test",
              applicability: "ORGANIZATIONAL",
              ownerId: spareId,
            }),
          }),
        );
        expect(response.status).toBe(201);
        expect((await response.json()).control.owner).toBeNull();
        expect((await prisma.control.findUniqueOrThrow({ where: { code } })).ownerId).toBeNull();
      } finally {
        await prisma.control.deleteMany({ where: { code } });
      }
    });
  });
});

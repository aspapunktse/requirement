import { NextRequest } from "next/server";
import type { UserRole } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { mapControlsToBase } from "@/test/framework-fixtures";
import { PATCH } from "../route";

/**
 * Editing an Organization Control Implementation (PRD 0001 F-IN.1, #120): who may, the
 * missing-row rule, the Waived / Not Applicable description rule, and that it changes nothing on
 * any System. Self-contained fixtures (ORGANIZATIONAL Controls, plus one Facet-scoped BOTH Control
 * and one Facet-scoped PER_SYSTEM Control with a System); nothing depends on seeded data.
 */

const SUFFIX = `${process.pid}-${Date.now()}`;
const email = (key: string) => `test-org-impl-${key}-${SUFFIX}@example.com`;

const ROLES: Record<string, UserRole> = {
  admin: "ADMIN",
  complianceManager: "COMPLIANCE_MANAGER",
  riskOwner: "RISK_OWNER",
  systemOwner: "SYSTEM_OWNER",
  reviewer: "REVIEWER",
  viewer: "VIEWER",
  businessRiskOwner: "BUSINESS_RISK_OWNER",
};
// Everyone except the two roles that may edit any Control's implementation.
const OTHER_ROLES = ["riskOwner", "systemOwner", "reviewer", "viewer", "businessRiskOwner"];

function req(controlId: string, userId: string | null, body: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/organization/controls/${controlId}`, {
    method: "PATCH",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const ctxFor = (controlId: string) => ({ params: Promise.resolve({ controlId }) });
const patch = (controlId: string, userId: string | null, body: unknown) =>
  PATCH(req(controlId, userId, body), ctxFor(controlId));

describe("PATCH /api/organization/controls/[controlId] (#120)", () => {
  const users: Record<string, string> = {};
  const extraUserIds: string[] = [];
  const controlIds: string[] = [];
  let controlId: string;
  let facetId: string;
  let bothControlId: string;
  let perSystemControlId: string;
  let systemId: string;
  let counter = 0;

  const makeControl = async (applicability: "ORGANIZATIONAL" | "BOTH" | "PER_SYSTEM", over: Record<string, unknown> = {}) => {
    const control = await prisma.control.create({
      data: {
        code: `TEST-OCI-${SUFFIX}-${++counter}`,
        title: `Test implementation control ${counter}`,
        description: "d",
        category: "Test",
        applicability,
        ...(applicability !== "ORGANIZATIONAL" && { question: "Does it?" }),
        ...over,
      },
    });
    controlIds.push(control.id);
    return control.id;
  };

  const rowOf = (id: string) => prisma.organizationControlImplementation.findUnique({ where: { controlId: id } });
  const ownerOf = (id: string, ownerId: string | null) => prisma.control.update({ where: { id }, data: { ownerId } });

  beforeAll(async () => {
    for (const [key, role] of Object.entries(ROLES)) {
      users[key] = (await prisma.user.create({ data: { email: email(key), name: `Test OCI ${key}`, role } })).id;
    }
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test OCI Facet ${SUFFIX}` } })).id;
    bothControlId = await makeControl("BOTH", { deploymentFacets: { connect: { id: facetId } } });
    perSystemControlId = await makeControl("PER_SYSTEM", { deploymentFacets: { connect: { id: facetId } } });
    await mapControlsToBase([bothControlId, perSystemControlId]);
    systemId = (
      await prisma.system.create({
        data: {
          name: `Test OCI System ${SUFFIX}`,
          ownerId: users.systemOwner,
          status: "ONBOARDED",
          deploymentFacets: { connect: { id: facetId } },
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.controlAssessment.deleteMany({ where: { systemId } });
    await prisma.changeEvent.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    // The implementations go with their Controls (cascade).
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: [...Object.values(users), ...extraUserIds] } } });
  });

  beforeEach(async () => {
    // A fresh Organizational Control with no implementation row (the missing-row case), owned by nobody.
    controlId = await makeControl("ORGANIZATIONAL");
  });

  describe("who may edit", () => {
    it.each(Object.keys(ROLES))("lets a %s who is the Control Owner set status and description", async (who) => {
      await ownerOf(controlId, users[who]);
      const response = await patch(controlId, users[who], { status: "IN_PROGRESS", description: "Policy drafted" });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.control).toMatchObject({
        id: controlId,
        owner: { id: users[who], name: `Test OCI ${who}` },
        implementation: { status: "IN_PROGRESS", description: "Policy drafted", updatedBy: { id: users[who] } },
      });
      expect(await rowOf(controlId)).toMatchObject({ status: "IN_PROGRESS", description: "Policy drafted", updatedById: users[who] });
    });

    it.each(["complianceManager", "admin"])("lets a %s edit a Control owned by someone else", async (who) => {
      await ownerOf(controlId, users.viewer);
      const response = await patch(controlId, users[who], { status: "FULFILLED", description: "Done" });
      expect(response.status).toBe(200);
      expect(await rowOf(controlId)).toMatchObject({ status: "FULFILLED", updatedById: users[who] });
    });

    it.each(["complianceManager", "admin"])("lets a %s edit a Control with no Control Owner", async (who) => {
      const response = await patch(controlId, users[who], { status: "IN_PROGRESS" });
      expect(response.status).toBe(200);
      expect((await response.json()).control.owner).toBeNull();
    });

    it.each(OTHER_ROLES)("refuses a %s who is not the Control Owner (403) and changes nothing", async (who) => {
      await ownerOf(controlId, users.reviewer === users[who] ? users.viewer : users.reviewer);
      await prisma.organizationControlImplementation.create({
        data: { controlId, status: "IN_PROGRESS", description: "Before", updatedById: users.admin },
      });
      const before = await rowOf(controlId);

      const response = await patch(controlId, users[who], { status: "FULFILLED", description: "Hijacked" });
      expect(response.status).toBe(403);
      expect(await rowOf(controlId)).toEqual(before);
    });

    it.each(OTHER_ROLES)("refuses a %s on an unowned Control without creating the row", async (who) => {
      const response = await patch(controlId, users[who], { status: "FULFILLED" });
      expect(response.status).toBe(403);
      expect(await rowOf(controlId)).toBeNull();
    });

    it("refuses an unauthenticated request (401) and changes nothing", async () => {
      const response = await patch(controlId, null, { status: "FULFILLED" });
      expect(response.status).toBe(401);
      expect(await rowOf(controlId)).toBeNull();
    });

    it("checks permission before validating the body: a refused user gets 403 even for an invalid body", async () => {
      const response = await patch(controlId, users.viewer, { status: "NOT_A_STATUS" });
      expect(response.status).toBe(403);
    });
  });

  describe("which Controls", () => {
    it("works for a BOTH Control", async () => {
      const response = await patch(bothControlId, users.complianceManager, { status: "FULFILLED", description: "Both" });
      expect(response.status).toBe(200);
      expect((await response.json()).control.applicability).toBe("BOTH");
      await prisma.organizationControlImplementation.deleteMany({ where: { controlId: bothControlId } });
    });

    it("refuses a PER_SYSTEM Control (404) for everyone, an Admin included, and creates no row", async () => {
      for (const who of ["admin", "complianceManager", "viewer"]) {
        const response = await patch(perSystemControlId, users[who], { status: "FULFILLED" });
        expect(response.status, who).toBe(404);
      }
      expect(await rowOf(perSystemControlId)).toBeNull();
    });

    it("refuses an unknown Control (404)", async () => {
      expect((await patch("no-such-control", users.admin, { status: "FULFILLED" })).status).toBe(404);
    });

    it("answers 404 before 403: an unknown Control is a 404 even for a user who may not edit", async () => {
      expect((await patch("no-such-control", users.viewer, { status: "FULFILLED" })).status).toBe(404);
    });
  });

  describe("the missing-row rule", () => {
    it("reads a Control with no row as Not Started, and the first edit creates the row", async () => {
      expect(await rowOf(controlId)).toBeNull();

      const response = await patch(controlId, users.admin, { status: "IN_PROGRESS" });
      expect(response.status).toBe(200);
      expect(await prisma.organizationControlImplementation.count({ where: { controlId } })).toBe(1);
      expect(await rowOf(controlId)).toMatchObject({ status: "IN_PROGRESS", description: null, updatedById: users.admin });
    });

    it("creates the row with a description alone, still Not Started", async () => {
      const response = await patch(controlId, users.admin, { description: "Planned for Q4" });
      expect(response.status).toBe(200);
      expect(await rowOf(controlId)).toMatchObject({ status: "NOT_STARTED", description: "Planned for Q4" });
    });

    it("edits an existing row in place: one row, createdAt kept, only the given field changed", async () => {
      await patch(controlId, users.admin, { status: "IN_PROGRESS", description: "First" });
      const first = await rowOf(controlId);

      await patch(controlId, users.complianceManager, { status: "FULFILLED" });
      const second = await rowOf(controlId);
      expect(await prisma.organizationControlImplementation.count({ where: { controlId } })).toBe(1);
      expect(second).toMatchObject({ id: first!.id, status: "FULFILLED", description: "First", updatedById: users.complianceManager });
      expect(second!.createdAt).toEqual(first!.createdAt);

      await patch(controlId, users.admin, { description: "Second" });
      expect(await rowOf(controlId)).toMatchObject({ status: "FULFILLED", description: "Second", updatedById: users.admin });
    });

    it("writes nothing for a Save that changes nothing, so 'updated by' is not bumped", async () => {
      await patch(controlId, users.admin, { status: "IN_PROGRESS", description: "Same" });
      const before = await rowOf(controlId);
      const response = await patch(controlId, users.complianceManager, { status: "IN_PROGRESS", description: "Same" });
      expect(response.status).toBe(200);
      expect(await rowOf(controlId)).toEqual(before);
    });

    it("records updatedBy and a fresh updatedAt on every real edit", async () => {
      await patch(controlId, users.admin, { status: "IN_PROGRESS" });
      const first = await rowOf(controlId);
      await new Promise((resolve) => setTimeout(resolve, 15));
      await patch(controlId, users.complianceManager, { status: "FULFILLED" });
      const second = await rowOf(controlId);
      expect(second!.updatedById).toBe(users.complianceManager);
      expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
    });

    it("trims the description and stores a blank one as none", async () => {
      await patch(controlId, users.admin, { description: "  padded  " });
      expect((await rowOf(controlId))!.description).toBe("padded");
      await patch(controlId, users.admin, { description: "   " });
      expect((await rowOf(controlId))!.description).toBeNull();
      await patch(controlId, users.admin, { description: "again" });
      await patch(controlId, users.admin, { description: null });
      expect((await rowOf(controlId))!.description).toBeNull();
    });
  });

  describe("Waived and Not Applicable need a description", () => {
    it.each(["WAIVED", "NOT_APPLICABLE"])("refuses %s without a description (400) and changes nothing", async (status) => {
      for (const body of [{ status }, { status, description: "" }, { status, description: "   " }, { status, description: null }]) {
        const response = await patch(controlId, users.admin, body);
        expect(response.status, JSON.stringify(body)).toBe(400);
        expect((await response.json()).error).toMatch(/description/i);
      }
      expect(await rowOf(controlId)).toBeNull();
    });

    it.each(["WAIVED", "NOT_APPLICABLE"])("accepts %s with a description", async (status) => {
      const response = await patch(controlId, users.admin, { status, description: "Accepted risk, approved by the CISO" });
      expect(response.status).toBe(200);
      expect((await rowOf(controlId))!.status).toBe(status);
    });

    it("judges the resulting state: clearing the description of a Waived implementation is refused", async () => {
      await patch(controlId, users.admin, { status: "WAIVED", description: "Reason" });
      const response = await patch(controlId, users.admin, { description: "" });
      expect(response.status).toBe(400);
      expect(await rowOf(controlId)).toMatchObject({ status: "WAIVED", description: "Reason" });
    });

    it("accepts moving to Waived when the description is already on record", async () => {
      await patch(controlId, users.admin, { status: "IN_PROGRESS", description: "Existing text" });
      const response = await patch(controlId, users.admin, { status: "WAIVED" });
      expect(response.status).toBe(200);
      expect(await rowOf(controlId)).toMatchObject({ status: "WAIVED", description: "Existing text" });
    });

    it("lets any status without a description go through (Not Started, In Progress, Fulfilled)", async () => {
      for (const status of ["IN_PROGRESS", "FULFILLED", "NOT_STARTED"]) {
        expect((await patch(controlId, users.admin, { status })).status, status).toBe(200);
      }
    });

    it("applies the rule to the Control Owner too, whatever their role", async () => {
      await ownerOf(controlId, users.viewer);
      const response = await patch(controlId, users.viewer, { status: "WAIVED" });
      expect(response.status).toBe(400);
      expect(await rowOf(controlId)).toBeNull();
    });
  });

  describe("validation", () => {
    it.each([
      ["an empty object", {}],
      ["an unknown status", { status: "DONE" }],
      ["a numeric description", { description: 7 }],
      ["a null status", { status: null }],
    ])("rejects %s (400) and changes nothing", async (_label, body) => {
      const response = await patch(controlId, users.admin, body);
      expect(response.status).toBe(400);
      expect(await rowOf(controlId)).toBeNull();
    });

    it("rejects a body that isn't JSON (400)", async () => {
      const response = await patch(controlId, users.admin, "not json");
      expect(response.status).toBe(400);
    });
  });

  describe("deleting the User who edited", () => {
    it("keeps the implementation and drops the attribution", async () => {
      const doomed = await prisma.user.create({ data: { email: email("doomed"), name: "Test OCI doomed", role: "ADMIN" } });
      extraUserIds.push(doomed.id);
      await patch(controlId, doomed.id, { status: "FULFILLED", description: "Done" });
      expect((await rowOf(controlId))!.updatedById).toBe(doomed.id);

      await prisma.user.delete({ where: { id: doomed.id } });

      expect(await rowOf(controlId)).toMatchObject({ status: "FULFILLED", description: "Done", updatedById: null });
    });
  });

  describe("nothing changes on Systems", () => {
    it("writes no Change Event for a person-set Assessment and creates, changes or removes no Control Assessment", async () => {
      // The BOTH Control applies to the fixture System (Facet match + base mapping). Give it an Assessment
      // a person has set, then move the Organization's implementation around. A person-set Assessment is
      // never overridden by inheritance (#121), so the System's effective status never moves and no event
      // is written; the cases where it does move are in inheritance-events.test.ts. Earlier cases in this
      // file may already have moved this System (it had no Assessment of the Control then), so the count
      // is compared with what it was before the Assessment existed.
      await prisma.controlAssessment.create({
        data: { systemId, controlId: bothControlId, status: "IN_PROGRESS", notes: "System's own", assessedById: users.systemOwner, assessedAt: new Date() },
      });
      const snapshot = () => prisma.controlAssessment.findMany({ where: { systemId }, orderBy: { controlId: "asc" } });
      const events = () => prisma.changeEvent.count({ where: { systemId } });
      const controlEvents = () => prisma.changeEvent.count({ where: { detail: { contains: `TEST-OCI-${SUFFIX}` } } });
      const eventsBefore = await events();
      const controlEventsBefore = await controlEvents();
      const before = await snapshot();
      expect(before).toHaveLength(1);

      for (const body of [
        { status: "FULFILLED", description: "Org done" },
        { status: "WAIVED", description: "Org waives" },
        { status: "NOT_STARTED" },
      ]) {
        expect((await patch(bothControlId, users.complianceManager, body)).status).toBe(200);
      }

      expect(await snapshot()).toEqual(before);
      expect(await events()).toBe(eventsBefore);
      expect(await controlEvents()).toBe(controlEventsBefore);
      await prisma.organizationControlImplementation.deleteMany({ where: { controlId: bothControlId } });
    });
  });
});

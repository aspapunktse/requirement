import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { SYSTEM_ACTOR } from "@/lib/change-events";
import { createFixtureFramework, mapControlsToBase, mapControlsToFramework, cleanupFixtureRequirements, deleteFixtureRequirement } from "@/test/framework-fixtures";
import { PATCH } from "../route";

/**
 * F-IN.7 (#121): changing an Organization Control Implementation logs one `"system"` Change Event
 * per System whose effective status for the Control changed, and none for the others. Fixture
 * Controls are scoped to a fixture Deployment Facet, so only fixture Systems are ever involved, and
 * nothing here touches a seeded Control's implementation.
 *
 * An Organizational Control (#122) writes ONE System-less ORGANIZATION_IMPLEMENTATION_CHANGED event
 * per status change, by the editor, and nothing per System. Its fixture Control is mapped to a
 * fixture Framework no System declares (an Organizational Control mapped to the base would count on
 * every other test file's Systems).
 */
describe("PATCH /api/organization/controls/[controlId]: Change Events for inheriting Systems (#121)", () => {
  const suffix = `${process.pid}-${Date.now()}`;
  let adminId: string;
  let viewerId: string;
  let ownerId: string;
  let facetId: string;
  let otherFacetId: string;
  let bothId: string;
  let bothCode: string;
  let organizationalId: string;
  let unmappedBothId: string;
  const system = {} as Record<"untouched" | "noRow" | "personSet" | "ownFulfilled" | "nobodySet" | "otherFacet", string>;
  const expectedChanged = () => [system.untouched, system.noRow].sort();

  const patch = (controlId: string, userId: string, body: unknown) =>
    PATCH(
      new NextRequest(`http://localhost/api/organization/controls/${controlId}`, {
        method: "PATCH",
        headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` }),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ controlId }) },
    );
  const setStatus = async (status: string, description?: string) => {
    const response = await patch(bothId, adminId, { status, ...(description && { description }) });
    expect(response.status).toBe(200);
  };
  const events = () =>
    prisma.changeEvent.findMany({
      where: { systemId: { in: Object.values(system) } },
      orderBy: [{ systemId: "asc" }, { createdAt: "asc" }],
    });
  const assessmentRows = () =>
    prisma.controlAssessment.findMany({
      where: { systemId: { in: Object.values(system) } },
      orderBy: [{ systemId: "asc" }, { controlId: "asc" }],
      select: { systemId: true, controlId: true, status: true, assessedById: true, updatedAt: true },
    });

  beforeAll(async () => {
    const user = async (key: string, role: "ADMIN" | "VIEWER" | "SYSTEM_OWNER") =>
      (await prisma.user.create({ data: { email: `test-orgevents-${key}-${suffix}@example.com`, name: `Test OrgEvents ${key}`, role } })).id;
    adminId = await user("admin", "ADMIN");
    viewerId = await user("viewer", "VIEWER");
    ownerId = await user("owner", "SYSTEM_OWNER");
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test OrgEvents Facet ${suffix}` } })).id;
    otherFacetId = (await prisma.deploymentFacet.create({ data: { name: `Test OrgEvents Other Facet ${suffix}` } })).id;

    const both = await prisma.control.create({
      data: {
        code: `TEST-ORGEV-BOTH-${suffix}`,
        title: "Test OrgEvents Both",
        description: "d",
        category: "Test",
        applicability: "BOTH",
        question: "Does it?",
        deploymentFacets: { connect: { id: facetId } },
      },
    });
    bothId = both.id;
    bothCode = both.code;
    organizationalId = (
      await prisma.control.create({
        data: { code: `TEST-ORGEV-ORG-${suffix}`, title: "Test OrgEvents Org", description: "d", category: "Test", applicability: "ORGANIZATIONAL" },
      })
    ).id;
    // A Both Control mapped to no Framework applies to no System, whatever its scoping.
    unmappedBothId = (
      await prisma.control.create({
        data: { code: `TEST-ORGEV-UNMAPPED-${suffix}`, title: "Test OrgEvents Unmapped", description: "d", category: "Test", applicability: "BOTH", question: "Does it?" },
      })
    ).id;
    await mapControlsToBase([bothId]);
    await mapControlsToFramework((await createFixtureFramework("OrgEvents Org")).id, [organizationalId]);

    const makeSystem = async (key: keyof typeof system, facet = facetId) => {
      system[key] = (
        await prisma.system.create({
          data: { name: `Test OrgEvents ${key} ${suffix}`, ownerId, status: "ONBOARDED", deploymentFacets: { connect: { id: facet } } },
        })
      ).id;
    };
    await makeSystem("untouched");
    await makeSystem("noRow");
    await makeSystem("personSet");
    await makeSystem("ownFulfilled");
    await makeSystem("nobodySet");
    await makeSystem("otherFacet", otherFacetId);
    await prisma.controlAssessment.createMany({
      data: [
        { systemId: system.untouched, controlId: bothId },
        { systemId: system.personSet, controlId: bothId, status: "IN_PROGRESS", assessedById: ownerId, assessedAt: new Date() },
        { systemId: system.ownFulfilled, controlId: bothId, status: "FULFILLED", assessedById: ownerId, assessedAt: new Date() },
        // Fulfilled, but no person set it (a migration left it so): its own status is Fulfilled already.
        { systemId: system.nobodySet, controlId: bothId, status: "FULFILLED" },
      ],
    });
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped (#231)
    const systemIds = Object.values(system);
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.changeEvent.deleteMany({ where: { systemId: null, detail: { contains: `-${suffix}` } } });
    await prisma.controlAssessment.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.control.deleteMany({ where: { id: { in: [bothId, organizationalId, unmappedBothId] } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: [facetId, otherFacetId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, viewerId, ownerId] } } });
  });

  it("logs exactly one system event per System whose effective status changed, and writes nothing to any Assessment", async () => {
    const rowsBefore = await assessmentRows();
    expect(await events()).toHaveLength(0);

    await setStatus("FULFILLED");

    const logged = await events();
    // The untouched row and the Control with no row at all change; a person-set, an own-Fulfilled and a nobody-set Fulfilled
    // Assessment and a System the Control does not apply to do not.
    expect(logged.map((e) => e.systemId).sort()).toEqual(expectedChanged());
    for (const event of logged) {
      expect(event).toMatchObject({
        action: "ASSESSMENT_STATUS_CHANGED",
        actorId: SYSTEM_ACTOR,
        detail: `${bothCode} is now Fulfilled, inherited from the Organization`,
      });
    }
    // Nothing was created, updated or deleted on any System.
    expect(await assessmentRows()).toEqual(rowsBefore);
    expect(await assessmentRows()).toHaveLength(4);
  });

  it("logs nothing for a no-op edit, a description-only edit or the same status again", async () => {
    const before = (await events()).length;
    await setStatus("FULFILLED");
    expect((await patch(bothId, adminId, { description: "Now written down" })).status).toBe(200);
    expect((await patch(bothId, adminId, { status: "FULFILLED", description: "And again" })).status).toBe(200);
    expect(await events()).toHaveLength(before);
  });

  it("logs one event per System when the Organization stops being Fulfilled, naming the status the System falls back to", async () => {
    await patch(bothId, adminId, { status: "WAIVED", description: "Out of scope this year" });

    const logged = (await events()).filter((e) => e.detail.includes("no longer"));
    expect(logged.map((e) => e.systemId).sort()).toEqual(expectedChanged());
    for (const event of logged) {
      expect(event).toMatchObject({
        action: "ASSESSMENT_STATUS_CHANGED",
        actorId: SYSTEM_ACTOR,
        detail: `${bothCode} is no longer inherited from the Organization (now Not Started)`,
      });
    }
    expect(await events()).toHaveLength(4);
  });

  it("logs nothing for changes between statuses that give no credit", async () => {
    const before = (await events()).length;
    await setStatus("IN_PROGRESS");
    await setStatus("NOT_STARTED");
    await patch(bothId, adminId, { status: "NOT_APPLICABLE", description: "Not relevant" });
    expect(await events()).toHaveLength(before);
  });

  it("logs again when it becomes Fulfilled a second time, and each System still gets one event", async () => {
    const before = (await events()).length;
    await setStatus("FULFILLED");
    const added = (await events()).length - before;
    expect(added).toBe(2);
  });

  it("does not double the events when two edits of the same Control run at once", async () => {
    await patch(bothId, adminId, { status: "NOT_STARTED" });
    const before = (await events()).length;
    const [a, b] = await Promise.all([
      patch(bothId, adminId, { status: "FULFILLED" }),
      patch(bothId, adminId, { status: "FULFILLED" }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await events()).length - before).toBe(2);
  });

  it("logs nothing for a refused edit, and the implementation stays as it was", async () => {
    await patch(bothId, adminId, { status: "NOT_STARTED" });
    const before = (await events()).length;
    const refused = await patch(bothId, viewerId, { status: "FULFILLED" });
    expect(refused.status).toBe(403);
    expect(await events()).toHaveLength(before);
    expect((await prisma.organizationControlImplementation.findUniqueOrThrow({ where: { controlId: bothId } })).status).toBe("NOT_STARTED");
  });

  describe("an Organizational Control (#122)", () => {
    const organizationEvents = (controlId = organizationalId) =>
      prisma.changeEvent.findMany({
        where: { action: "ORGANIZATION_IMPLEMENTATION_CHANGED", detail: { contains: codeOf(controlId) } },
        orderBy: { createdAt: "asc" },
      });
    const codes = new Map<string, string>();
    const codeOf = (controlId: string) => codes.get(controlId) ?? "";

    beforeAll(async () => {
      for (const id of [organizationalId, bothId, unmappedBothId]) {
        codes.set(id, (await prisma.control.findUniqueOrThrow({ where: { id }, select: { code: true } })).code);
      }
    });

    it("writes one System-less event, by the editor, and no System event", async () => {
      const before = (await events()).length;
      const response = await patch(organizationalId, adminId, { status: "FULFILLED" });
      expect(response.status).toBe(200);

      expect(await events()).toHaveLength(before);
      expect(await prisma.changeEvent.count({ where: { actorId: SYSTEM_ACTOR, detail: { contains: codeOf(organizationalId) } } })).toBe(0);
      const logged = await organizationEvents();
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        systemId: null,
        actorId: adminId,
        detail: `${codeOf(organizationalId)} Organization Control Implementation changed from Not Started to Fulfilled`,
      });
    });

    it("writes one event per status change, saying where it came from and went", async () => {
      await patch(organizationalId, adminId, { status: "WAIVED", description: "Accepted risk" });
      await patch(organizationalId, adminId, { status: "NOT_STARTED" });
      const details = (await organizationEvents()).map((e) => e.detail.replace(`${codeOf(organizationalId)} `, ""));
      expect(details).toEqual([
        "Organization Control Implementation changed from Not Started to Fulfilled",
        "Organization Control Implementation changed from Fulfilled to Waived",
        "Organization Control Implementation changed from Waived to Not Started",
      ]);
    });

    it("writes nothing for a description-only edit, a no-op Save, or a refused edit", async () => {
      await patch(organizationalId, adminId, { status: "NOT_APPLICABLE", description: "Out of scope" });
      const before = (await organizationEvents()).length;

      expect((await patch(organizationalId, adminId, { description: "Out of scope, reviewed" })).status).toBe(200);
      expect((await patch(organizationalId, adminId, { status: "NOT_APPLICABLE" })).status).toBe(200);
      expect((await patch(organizationalId, viewerId, { status: "FULFILLED" })).status).toBe(403);
      expect((await patch(organizationalId, adminId, { status: "WAIVED", description: " " })).status).toBe(400); // a reason is required

      expect(await organizationEvents()).toHaveLength(before);
    });

    it("attributes the event to whoever made the change", async () => {
      await patch(organizationalId, adminId, { status: "NOT_STARTED" });
      await prisma.control.update({ where: { id: organizationalId }, data: { ownerId } });
      try {
        // A Control Owner, whatever their role, may edit.
        expect((await patch(organizationalId, ownerId, { status: "IN_PROGRESS" })).status).toBe(200);
        const last = (await organizationEvents()).at(-1)!;
        expect(last).toMatchObject({ actorId: ownerId, systemId: null });
        expect(last.detail).toMatch(/from Not Started to In Progress$/);
      } finally {
        await prisma.control.update({ where: { id: organizationalId }, data: { ownerId: null } });
      }
    });

    it("writes no System-less event for a Both Control (it keeps the per-System events of #121)", async () => {
      await setStatus("NOT_STARTED");
      await setStatus("FULFILLED");
      expect(await prisma.changeEvent.count({ where: { action: "ORGANIZATION_IMPLEMENTATION_CHANGED", detail: { contains: codeOf(bothId) } } })).toBe(0);
      expect(await prisma.changeEvent.count({ where: { systemId: null, detail: { contains: codeOf(bothId) } } })).toBe(0);
      expect((await events()).length).toBeGreaterThan(0);
    });
  });

  it("writes no event for a Both Control that applies to no System", async () => {
    const before = await prisma.changeEvent.count({ where: { actorId: SYSTEM_ACTOR, detail: { contains: "TEST-ORGEV-UNMAPPED" } } });
    const response = await patch(unmappedBothId, adminId, { status: "FULFILLED" });
    expect(response.status).toBe(200);
    expect(await prisma.changeEvent.count({ where: { actorId: SYSTEM_ACTOR, detail: { contains: "TEST-ORGEV-UNMAPPED" } } })).toBe(before);
  });

  it("covers a Both Control that applies to a System by Impact Level and Framework Scope only (the in-memory applicability matches)", async () => {
    // A System with a High confidentiality level gets the event for a Control that needs it; a Low one does not.
    const high = await prisma.control.create({
      data: {
        code: `TEST-ORGEV-HIGH-${suffix}`,
        title: "Test OrgEvents High",
        description: "d",
        category: "Test",
        applicability: "BOTH",
        question: "Does it?",
        minConfidentialityImpactLevel: "HIGH",
        deploymentFacets: { connect: { id: facetId } },
      },
    });
    const highRequirementId = await mapControlsToBase([high.id]);
    const make = (key: string, level: "HIGH" | "LOW") =>
      prisma.system.create({
        data: { name: `Test OrgEvents ${key} ${suffix}`, ownerId, status: "ONBOARDED", confidentialityImpactLevel: level, deploymentFacets: { connect: { id: facetId } } },
      });
    const [highSystem, lowSystem] = [await make("high", "HIGH"), await make("low", "LOW")];
    try {
      const response = await patch(high.id, adminId, { status: "FULFILLED" });
      expect(response.status).toBe(200);
      const logged = await prisma.changeEvent.findMany({
        where: { systemId: { in: [highSystem.id, lowSystem.id] } },
      });
      expect(logged.map((e) => e.systemId)).toEqual([highSystem.id]);
      expect(logged[0].detail).toBe(`${high.code} is now Fulfilled, inherited from the Organization`);
    } finally {
      await prisma.changeEvent.deleteMany({ where: { systemId: { in: [highSystem.id, lowSystem.id] } } });
      await prisma.system.deleteMany({ where: { id: { in: [highSystem.id, lowSystem.id] } } });
      await deleteFixtureRequirement(highRequirementId); // before its Control, or it is left unmapped (#231)
      await prisma.control.deleteMany({ where: { id: high.id } });
    }
  });
});

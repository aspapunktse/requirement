import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { mapControlsToBase, cleanupFixtureRequirements } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { PATCH } from "../route";

/**
 * A System declares its Information Types, and its Sensitivity Level can't go below the highest of them (#304, ADR 0012).
 * Self-contained: it makes its own Information Types, Control, users and Systems, so it passes on CI's unseeded database.
 */

const TAG = `${process.pid}-${Date.now()}`;
const email = (key: string) => `test-304-types-${key}-${TAG}@example.com`;

function requestAs(id: string, userId: string | null, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/systems/${id}`, {
    method: "PATCH",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/systems/[id]: Information Types and the Sensitivity Level floor", () => {
  const users = {} as Record<"owner" | "otherOwner" | "complianceManager" | "admin", string>;
  const type = {} as Record<"payroll" | "code" | "web", string>; // Highly Sensitive (4), Sensitive (3), Public (1)
  let facetId: string;
  let stepUpControlId: string;
  let systemId: string;

  const patch = (userId: string | null, body: unknown) => PATCH(requestAs(systemId, userId, body), ctxFor(systemId));
  const stored = () => prisma.system.findUniqueOrThrow({ where: { id: systemId }, include: { informationTypes: { select: { id: true } } } });
  const declaredIds = async () => (await stored()).informationTypes.map((t) => t.id).sort();
  const events = () => prisma.changeEvent.findMany({ where: { systemId, action: "CLASSIFICATION_CHANGED" }, orderBy: { createdAt: "asc" } });
  const assessmentControlIds = async () => (await prisma.controlAssessment.findMany({ where: { systemId } })).map((a) => a.controlId);

  /** A System as a test needs it, straight in the database. */
  async function makeSystem(level: number | null, typeIds: string[] = []) {
    const system = await prisma.system.create({
      data: {
        name: `Test #304 System ${TAG}`,
        ownerId: users.owner,
        status: "DRAFT",
        sensitivityLevel: level,
        deploymentFacets: { connect: [{ id: facetId }] },
        informationTypes: { connect: typeIds.map((id) => ({ id })) },
      },
    });
    systemId = system.id;
  }

  beforeAll(async () => {
    for (const [key, role] of [
      ["owner", "SYSTEM_OWNER"],
      ["otherOwner", "SYSTEM_OWNER"],
      ["complianceManager", "COMPLIANCE_MANAGER"],
      ["admin", "ADMIN"],
    ] as const) {
      users[key] = (await prisma.user.create({ data: { email: email(key), name: `Test #304 ${key}`, role } })).id;
    }
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test #304 Facet ${TAG}` } })).id;
    for (const [key, name, level] of [
      ["payroll", "Payroll", 4],
      ["code", "Source code", 3],
      ["web", "Public web content", 1],
    ] as const) {
      type[key] = (await prisma.informationType.create({ data: { name: `Test #304 ${name} ${TAG}`, sensitivityLevel: level } })).id;
    }
    // Applies from Highly Sensitive up, scoped to the fixture Facet so no other file's System gets it.
    const control = await prisma.control.create({
      data: {
        code: `T304-STEPUP-${TAG}`,
        title: "Test #304 Step-up authentication",
        description: "d",
        category: "Security",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: [{ id: facetId }] },
        minSensitivityLevel: 4,
      },
    });
    stepUpControlId = control.id;
    await mapControlsToBase([stepUpControlId]);
  });

  afterAll(async () => {
    await cleanupFixtureRequirements(); // before the Controls, so no fixture base Requirement is left unmapped
    await prisma.system.deleteMany({ where: { name: `Test #304 System ${TAG}` } });
    await prisma.control.deleteMany({ where: { id: stepUpControlId } });
    await prisma.informationType.deleteMany({ where: { id: { in: Object.values(type) } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  beforeEach(async () => {
    await makeSystem(null);
  });

  afterEach(async () => {
    await prisma.system.deleteMany({ where: { id: systemId } });
  });

  it("rejects an unauthenticated request", async () => {
    expect((await patch(null, { informationTypeIds: [type.web] })).status).toBe(401);
  });

  it("lets the owner declare types at any Onboarding Status, with one Change Event naming the old and new types", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { status: "ONBOARDED", sensitivityLevel: 3 } });
    const response = await patch(users.owner, { informationTypeIds: [type.code] });

    expect(response.status).toBe(200);
    expect(await declaredIds()).toEqual([type.code]);
    const written = await events();
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ actorId: users.owner, detail: `Information Types: none → Test #304 Source code ${TAG}` });
    expect((await stored()).status).toBe("ONBOARDED");
  });

  it("lets an Admin declare types on a System they don't own", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 3 } });
    const response = await patch(users.admin, { informationTypeIds: [type.code, type.web] });
    expect(response.status).toBe(200);
    expect(await declaredIds()).toEqual([type.code, type.web].sort());
    expect((await events())[0].actorId).toBe(users.admin);
  });

  it("refuses a Compliance Manager and another owner, and changes nothing", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 3, status: "ONBOARDED" } });
    for (const who of [users.complianceManager, users.otherOwner]) {
      const response = await patch(who, { informationTypeIds: [type.code], sensitivityLevel: 5 });
      expect(response.status).toBe(403);
      expect(await declaredIds()).toEqual([]);
      expect(await stored()).toMatchObject({ sensitivityLevel: 3 });
      expect(await events()).toHaveLength(0);
    }
  });

  it("refuses a level below the highest type, naming the type, and changes nothing", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 4, informationTypes: { connect: [{ id: type.payroll }] } } });
    const response = await patch(users.owner, { sensitivityLevel: 3 });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain(`Test #304 Payroll ${TAG}`);
    expect(await stored()).toMatchObject({ sensitivityLevel: 4 });
    expect(await declaredIds()).toEqual([type.payroll]);
    expect(await events()).toHaveLength(0);
  });

  it("refuses to clear the level while the System has types, and allows it once there are none", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 4, informationTypes: { connect: [{ id: type.payroll }] } } });
    const refused = await patch(users.owner, { sensitivityLevel: null });
    expect(refused.status).toBe(400);
    expect(await stored()).toMatchObject({ sensitivityLevel: 4 });
    expect(await events()).toHaveLength(0);

    // Clearing the types and the level in one request is fine: the System ends with no types.
    const cleared = await patch(users.owner, { informationTypeIds: [], sensitivityLevel: null });
    expect(cleared.status).toBe(200);
    expect(await stored()).toMatchObject({ sensitivityLevel: null });
    expect(await declaredIds()).toEqual([]);
  });

  it("refuses to add a type above the current level without raising it, and changes nothing", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 3 } });
    const response = await patch(users.owner, { informationTypeIds: [type.payroll] });

    expect(response.status).toBe(400);
    expect(await declaredIds()).toEqual([]);
    expect(await stored()).toMatchObject({ sensitivityLevel: 3 });
    expect(await events()).toHaveLength(0);
  });

  it("refuses to add a type to a System with no level", async () => {
    const response = await patch(users.owner, { informationTypeIds: [type.web] });
    expect(response.status).toBe(400);
    expect(await declaredIds()).toEqual([]);
    expect(await events()).toHaveLength(0);
  });

  it("adds a higher type and raises the level in one request: both Change Events, and the Control with a minimum level comes in", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 3 } });
    expect(await assessmentControlIds()).not.toContain(stepUpControlId);

    const response = await patch(users.owner, { informationTypeIds: [type.payroll], sensitivityLevel: 4 });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.added).toBeGreaterThanOrEqual(1);
    expect(await stored()).toMatchObject({ sensitivityLevel: 4 });
    expect(await declaredIds()).toEqual([type.payroll]);
    expect(await assessmentControlIds()).toContain(stepUpControlId);

    const written = (await events()).map((event) => event.detail);
    expect(written).toHaveLength(2);
    expect(written.some((detail) => /Sensitivity Level: .+ → .+/.test(detail) && detail.includes("Control Assessment"))).toBe(true);
    expect(written).toContain(`Information Types: none → Test #304 Payroll ${TAG}`);
  });

  it("writes the types event in the same transaction as the change: a refused level leaves no event behind", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 3 } });
    // The types are fine on their own; the level is not: nothing may be written.
    const response = await patch(users.owner, { informationTypeIds: [type.payroll], sensitivityLevel: 3 });
    expect(response.status).toBe(400);
    expect(await declaredIds()).toEqual([]);
    expect(await events()).toHaveLength(0);
  });

  it("never lowers the level when a type is removed, and names old and new types in the event", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 4, informationTypes: { connect: [{ id: type.payroll }, { id: type.web }] } } });
    const response = await patch(users.owner, { informationTypeIds: [type.web] });

    expect(response.status).toBe(200);
    expect(await stored()).toMatchObject({ sensitivityLevel: 4 });
    expect(await declaredIds()).toEqual([type.web]);
    const written = await events();
    expect(written).toHaveLength(1);
    expect(written[0].detail).toBe(`Information Types: Test #304 Payroll ${TAG}, Test #304 Public web content ${TAG} → Test #304 Public web content ${TAG}`);
    expect(await assessmentControlIds()).toEqual([]); // a types-only change recomputes nothing
  });

  it("writes no event when the set doesn't change, and ignores a repeated id", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 3, informationTypes: { connect: [{ id: type.code }] } } });
    const response = await patch(users.owner, { informationTypeIds: [type.code, type.code] });
    expect(response.status).toBe(200);
    expect(await declaredIds()).toEqual([type.code]);
    expect(await events()).toHaveLength(0);
  });

  it("refuses an unknown Information Type id and changes nothing", async () => {
    await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 3 } });
    const response = await patch(users.owner, { informationTypeIds: [type.code, "no-such-type"], sensitivityLevel: 4 });
    expect(response.status).toBe(400);
    expect(await declaredIds()).toEqual([]);
    expect(await stored()).toMatchObject({ sensitivityLevel: 3 });
    expect(await events()).toHaveLength(0);
  });

  describe("a System already below its Information Types (a curator raised a type)", () => {
    beforeEach(async () => {
      await prisma.system.update({ where: { id: systemId }, data: { sensitivityLevel: 3, informationTypes: { connect: [{ id: type.payroll }] } } });
    });

    it("may still change its Impact Levels without touching the level, so the owner is never stuck", async () => {
      const response = await patch(users.owner, { integrityImpactLevel: "HIGH" });
      expect(response.status).toBe(200);
      expect(await stored()).toMatchObject({ sensitivityLevel: 3, integrityImpactLevel: "HIGH" });
    });

    it("refuses any request that sets the level or the types and leaves it below the floor", async () => {
      expect((await patch(users.owner, { sensitivityLevel: 3 })).status).toBe(400);
      expect((await patch(users.owner, { informationTypeIds: [type.payroll] })).status).toBe(400);
      expect(await stored()).toMatchObject({ sensitivityLevel: 3 });
      expect(await events()).toHaveLength(0);
    });

    it("is fixed by raising the level to the floor", async () => {
      const response = await patch(users.owner, { sensitivityLevel: 4 });
      expect(response.status).toBe(200);
      expect(await stored()).toMatchObject({ sensitivityLevel: 4 });
      expect(await assessmentControlIds()).toContain(stepUpControlId);
    });

    it("is also fixed by swapping to a type its level meets", async () => {
      const response = await patch(users.owner, { informationTypeIds: [type.code] });
      expect(response.status).toBe(200);
      expect(await declaredIds()).toEqual([type.code]);
    });
  });
});

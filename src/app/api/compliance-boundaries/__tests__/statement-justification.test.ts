import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { cleanupFixtureRequirements, createFixtureFramework, mapControlsToFramework } from "@/test/framework-fixtures";
import { PUT } from "../[id]/statement/justifications/[requirementId]/route";

/**
 * PUT /api/compliance-boundaries/[id]/statement/justifications/[requirementId] (#420), against real Postgres. Fixtures only
 * (`Test #420 ...`): a non-base Framework with an excluded and an included Requirement, a Boundary with a counted System.
 */
const suffix = `${process.pid}-${Date.now()}`;
const N = (label: string) => `Test #420 route ${label} ${suffix}`;

function put(userId: string | null, boundaryId: string, requirementId: string, body: unknown) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return PUT(new NextRequest(`http://localhost/api/compliance-boundaries/${boundaryId}/statement/justifications/${requirementId}`, { method: "PUT", headers, body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: boundaryId, requirementId }),
  });
}

describe("PUT statement justification (#420)", { timeout: 90_000 }, () => {
  const users: Record<string, string> = {};
  const facets: string[] = [];
  const controlIds: string[] = [];
  const systemIds: string[] = [];
  const boundaryIds: string[] = [];
  let fw: string;
  let otherFw: string;
  let excluded: string;
  let included: string;
  let foreign: string;
  let boundary: string;
  let retired: string;

  const stored = (boundaryId: string, requirementId: string) => prisma.boundaryExclusionJustification.findUnique({ where: { boundaryId_requirementId: { boundaryId, requirementId } } });
  const events = () => prisma.changeEvent.findMany({ where: { action: "SOA_JUSTIFICATION_CHANGED", actorId: { in: Object.values(users) } }, orderBy: { createdAt: "asc" } });
  const snapshot = async () => JSON.stringify([await prisma.boundaryExclusionJustification.findMany({ where: { boundaryId: { in: boundaryIds } }, orderBy: { id: "asc" } }), (await events()).map((e) => e.id)]);

  beforeAll(async () => {
    for (const [key, role] of Object.entries({ cm: "COMPLIANCE_MANAGER", admin: "ADMIN", viewer: "VIEWER", auditor: "INTERNAL_AUDITOR", boundaryOwner: "SYSTEM_OWNER", otherOwner: "SYSTEM_OWNER" } as const)) {
      users[key] = (await prisma.user.create({ data: { email: `test-420-route-${key}-${suffix}@example.com`, name: N(key), role } })).id;
    }
    for (const label of ["in", "out"]) facets.push((await prisma.deploymentFacet.create({ data: { name: N(`Facet ${label}`) } })).id);
    fw = (await createFixtureFramework("420 route")).id;
    otherFw = (await createFixtureFramework("420 route other")).id;
    const make = async (code: string, facet: string) => {
      const control = await prisma.control.create({ data: { code: `T420R-${code}-${suffix}`, title: N(code), description: "d", category: "Test", applicability: "PER_SYSTEM", deploymentFacets: { connect: [{ id: facet }] } } });
      controlIds.push(control.id);
      return control.id;
    };
    included = await mapControlsToFramework(fw, [await make("IN", facets[0])]);
    excluded = await mapControlsToFramework(fw, [await make("OUT", facets[1])]);
    foreign = await mapControlsToFramework(otherFw, [await make("FOREIGN", facets[1])]);
    const system = await prisma.system.create({ data: { name: N("system"), ownerId: users.otherOwner, status: "ONBOARDED", deploymentFacets: { connect: [{ id: facets[0] }] } } });
    systemIds.push(system.id);
    boundary = (await prisma.complianceBoundary.create({ data: { name: N("boundary"), boundaryOwnerId: users.boundaryOwner, frameworks: { create: [{ frameworkId: fw }] }, systems: { create: [{ systemId: system.id }] } } })).id;
    retired = (await prisma.complianceBoundary.create({ data: { name: N("retired"), boundaryOwnerId: users.boundaryOwner, retiredAt: new Date(), frameworks: { create: [{ frameworkId: fw }] } } })).id;
    boundaryIds.push(boundary, retired);
  }, 60_000);

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { actorId: { in: Object.values(users) } } });
    await prisma.complianceBoundary.deleteMany({ where: { id: { in: boundaryIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await cleanupFixtureRequirements();
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: { in: facets } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  }, 60_000);

  it("lets a Compliance Manager, an Admin and the Boundary Owner write, and records a System-less Change Event naming the Boundary", async () => {
    for (const [key, text] of [["cm", "By the manager"], ["admin", "By the admin"], ["boundaryOwner", "By the owner"]] as const) {
      const response = await put(users[key], boundary, excluded, { text });
      expect(response.status, key).toBe(200);
      expect(await response.json()).toEqual({ justification: text });
      expect((await stored(boundary, excluded))?.text).toBe(text);
      expect((await stored(boundary, excluded))?.updatedById).toBe(users[key]);
    }
    const written = await events();
    expect(written).toHaveLength(3);
    expect(written.every((event) => event.systemId === null)).toBe(true);
    expect(written[2].detail).toContain(N("boundary"));
    expect(written[2].detail).toContain("By the owner");
    expect(written[2].detail).toContain("By the admin");
  });

  it("trims the text, writes no event when nothing changes, and clears on empty text", async () => {
    const before = (await events()).length;
    expect((await put(users.cm, boundary, excluded, { text: "  By the owner  " })).status).toBe(200);
    expect((await events()).length).toBe(before);
    const cleared = await put(users.cm, boundary, excluded, { text: "   " });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ justification: null });
    expect(await stored(boundary, excluded)).toBeNull();
    expect((await events()).length).toBe(before + 1);
  });

  it.each(["viewer", "auditor", "otherOwner"])("refuses a %s with 403 and changes nothing", async (key) => {
    const before = await snapshot();
    expect((await put(users[key], boundary, excluded, { text: "Nope" })).status).toBe(403);
    expect(await snapshot()).toBe(before);
  });

  it("refuses an unauthenticated request with 401 and changes nothing", async () => {
    const before = await snapshot();
    expect((await put(null, boundary, excluded, { text: "Nope" })).status).toBe(401);
    expect(await snapshot()).toBe(before);
  });

  it("answers 404 for an unknown Boundary, an unknown Requirement and one outside the Boundary's Frameworks", async () => {
    const before = await snapshot();
    expect((await put(users.cm, "nope", excluded, { text: "x" })).status).toBe(404);
    expect((await put(users.cm, boundary, "nope", { text: "x" })).status).toBe(404);
    expect((await put(users.cm, boundary, foreign, { text: "x" })).status).toBe(404);
    expect(await snapshot()).toBe(before);
  });

  it("answers 409 on a retired Boundary and changes nothing", async () => {
    const before = await snapshot();
    expect((await put(users.cm, retired, excluded, { text: "x" })).status).toBe(409);
    expect(await snapshot()).toBe(before);
  });

  it("refuses a justification on an included Requirement with 409, but lets a stale one be cleared", async () => {
    const before = await snapshot();
    expect((await put(users.cm, boundary, included, { text: "Why is it here" })).status).toBe(409);
    expect(await snapshot()).toBe(before);
    await prisma.boundaryExclusionJustification.create({ data: { boundaryId: boundary, requirementId: included, text: "Stale" } });
    expect((await put(users.cm, boundary, included, { text: "" })).status).toBe(200);
    expect(await stored(boundary, included)).toBeNull();
  });

  it("validates the body with 400 and changes nothing", async () => {
    const before = await snapshot();
    expect((await put(users.cm, boundary, excluded, { text: "x".repeat(2001) })).status).toBe(400);
    expect((await put(users.cm, boundary, excluded, { text: 5 })).status).toBe(400);
    expect((await put(users.cm, boundary, excluded, {})).status).toBe(400);
    expect(await snapshot()).toBe(before);
  });
});

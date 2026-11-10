import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { SYSTEM_CLOSED_REFUSAL } from "@/lib/system-closed";
import { POST as changeOwners } from "../systems/owner/route";
import { PATCH as patchDetails } from "../systems/[id]/details/route";
import { GET as getEvaluation } from "../systems/[id]/evaluation/route";
import { GET as getRisks } from "../systems/[id]/risks/route";

/**
 * A System the Business System Owner rejected at OG3 is closed (#330): every write on it is refused with 409 for every role, and a
 * read still works. The write routes are discovered from the files under `api/systems/[id]`, so a route added later without the check
 * (`refuseIfSystemClosed`) fails here. Fixtures only (CI's database is migrated, not seeded).
 */
const SUFFIX = `${process.pid}-${Date.now()}`;

type Handler = (request: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const modules = import.meta.glob("../systems/[[]id]/**/route.ts", { eager: true }) as Record<string, Record<string, unknown>>;
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** Every write handler under `api/systems/[id]`, with the URL of its file and the names of its dynamic segments. */
const writeRoutes = Object.entries(modules).flatMap(([file, mod]) =>
  WRITE_METHODS.filter((method) => typeof mod[method] === "function").map((method) => ({
    method,
    handler: mod[method] as Handler,
    segments: [...file.matchAll(/\[(\w+)\]/g)].map((match) => match[1]),
    path: file.replace("../systems/", "").replace("/route.ts", ""),
  })),
);

/** A body that gets past each route's own body check, so the closed rule is what answers. */
const bodyFor = (path: string) => (path.endsWith("business-system-owner") ? { businessSystemOwnerId: null } : {});

function requestAs(userId: string, url: string, method: string, body?: unknown) {
  const headers = new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` });
  return new NextRequest(`http://localhost${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("A System rejected at OG3 is closed (#330)", { timeout: 120_000 }, () => {
  const userIds: string[] = [];
  const systemIds: string[] = [];
  let admin: string;
  let owner: string;
  let bso: string;
  let stranger: string;
  let closedId: string;

  /** What a write could change on the System, as one comparable value. */
  async function fingerprint(systemId: string) {
    const system = await prisma.system.findUniqueOrThrow({ where: { id: systemId } });
    const [events, decisions, risks, analyses, assessments, documents, offerings, approvals, scopes, units, deps] = await Promise.all([
      prisma.changeEvent.count({ where: { systemId } }),
      prisma.gateDecision.count({ where: { systemId } }),
      prisma.risk.count({ where: { systemId } }),
      prisma.riskAnalysis.count({ where: { systemId } }),
      prisma.controlAssessment.count({ where: { systemId } }),
      prisma.systemDocument.count({ where: { systemId } }),
      prisma.controlOffering.count({ where: { providerId: systemId } }),
      prisma.approval.count({ where: { systemId } }),
      prisma.system.count({ where: { id: systemId, frameworkScopes: { some: {} } } }),
      prisma.system.count({ where: { id: systemId, businessUnits: { some: {} } } }),
      prisma.providerDependency.count({ where: { dependentId: systemId } }),
    ]);
    return JSON.stringify({ system, events, decisions, risks, analyses, assessments, documents, offerings, approvals, scopes, units, deps });
  }

  beforeAll(async () => {
    for (const [key, role] of [["admin", "ADMIN"], ["owner", "SYSTEM_OWNER"], ["bso", "VIEWER"], ["stranger", "SYSTEM_OWNER"]] as const) {
      const user = await prisma.user.create({ data: { email: `test-330-closed-${key}-${SUFFIX}@example.com`, name: `Test 330 closed ${key} ${SUFFIX}`, role } });
      userIds.push(user.id);
      if (key === "admin") admin = user.id;
      if (key === "owner") owner = user.id;
      if (key === "bso") bso = user.id;
      if (key === "stranger") stranger = user.id;
    }
    const system = await prisma.system.create({
      data: {
        name: `Test 330 Closed ${SUFFIX}`,
        ownerId: owner,
        businessSystemOwnerId: bso,
        status: "REJECTED",
        evaluationStage: "OG3",
        evaluationTrack: "SELF",
        evaluationStageEnteredAt: new Date(),
        evaluationClosedAt: new Date(),
      },
    });
    closedId = system.id;
    systemIds.push(closedId);
    await prisma.risk.create({ data: { systemId: closedId, title: `Test 330 closed risk ${SUFFIX}`, description: "A Risk", severity: "LOW", likelihood: "LOW" } });
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systemIds } } });
    await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }, 60_000);

  it("finds the System write routes", () => {
    // A guard on the discovery itself: it must see the routes (about 35), or the loop below would pass for nothing.
    expect(writeRoutes.length).toBeGreaterThan(30);
    expect(writeRoutes.map((route) => `${route.method} ${route.path}`)).toContain("POST [id]/evaluation/og3-decision");
  });

  it.each(["admin", "owner", "bso"] as const)("refuses every write route for the %s (409; an Admin can only be stopped by the closed rule), and changes nothing", async (who) => {
    const actor = { admin, owner, bso }[who];
    const before = await fingerprint(closedId);
    const wrong: string[] = [];
    for (const route of writeRoutes) {
      const params = Object.fromEntries(route.segments.map((name) => [name, name === "id" ? closedId : `missing-${name}`]));
      const url = `/api/systems/${closedId}/${route.path.replace("[id]/", "").replace(/\[(\w+)\]/g, (_match, name: string) => params[name])}`;
      const response = await route.handler(requestAs(actor, url, route.method, bodyFor(route.path)), { params: Promise.resolve(params) });
      // An Admin may do everything on a System, so only the closed rule can refuse them. For the others a route may refuse earlier, on their role.
      if (response.status !== 409 && !(who !== "admin" && response.status === 403)) {
        wrong.push(`${route.method} ${route.path}: ${response.status}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(await fingerprint(closedId)).toBe(before);
  });

  it("answers 404, not 409, to a user who can't see the closed System (the visibility check comes first)", async () => {
    const before = await fingerprint(closedId);
    const details = await patchDetails(requestAs(stranger, `/api/systems/${closedId}/details`, "PATCH", {}), { params: Promise.resolve({ id: closedId }) });
    expect(details.status).toBe(404);
    // Every write route: never the 409 of the closed rule (a role check may refuse earlier with 403).
    for (const route of writeRoutes) {
      const params = Object.fromEntries(route.segments.map((name) => [name, name === "id" ? closedId : `missing-${name}`]));
      const url = `/api/systems/${closedId}/${route.path.replace("[id]/", "").replace(/\[(\w+)\]/g, (_match, name: string) => params[name])}`;
      const response = await route.handler(requestAs(stranger, url, route.method, bodyFor(route.path)), { params: Promise.resolve(params) });
      expect([403, 404], `${route.method} ${route.path}`).toContain(response.status);
    }
    expect(await fingerprint(closedId)).toBe(before);
  });

  it("refuses a bulk owner change that includes it, and every other System in the batch stays as it was", async () => {
    const other = await prisma.system.create({ data: { name: `Test 330 Other ${SUFFIX}`, ownerId: owner } });
    systemIds.push(other.id);
    const before = await fingerprint(closedId);
    const response = await changeOwners(requestAs(admin, "/api/systems/owner", "POST", { systemIds: [other.id, closedId], ownerId: admin }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(SYSTEM_CLOSED_REFUSAL);
    expect((await prisma.system.findUniqueOrThrow({ where: { id: other.id } })).ownerId).toBe(owner);
    expect(await fingerprint(closedId)).toBe(before);
  });

  it("still lets everyone read it", async () => {
    for (const who of [admin, owner, bso]) {
      const evaluation = await getEvaluation(requestAs(who, `/api/systems/${closedId}/evaluation`, "GET"), { params: Promise.resolve({ id: closedId }) });
      expect(evaluation.status).toBe(200);
      expect((await evaluation.json()).evaluation).toMatchObject({ closed: true });
      const risks = await getRisks(requestAs(who, `/api/systems/${closedId}/risks`, "GET"), { params: Promise.resolve({ id: closedId }) });
      expect(risks.status).toBe(200);
    }
  });
});

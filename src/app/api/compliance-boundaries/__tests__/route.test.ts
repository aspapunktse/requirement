import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OnboardingStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../route";
import { GET as GET_ONE, PATCH } from "../[id]/route";
import { POST as ADD } from "../[id]/systems/route";
import { DELETE as REMOVE } from "../[id]/systems/[systemId]/route";

/**
 * /api/compliance-boundaries (#418), against real Postgres. Fixtures are `Test #418 …` Users, Frameworks, a Business Unit,
 * Systems and Boundaries created here and removed in `afterAll`; CI's database is migrated but not seeded. Frameworks are
 * non-base, so nothing here touches the base Framework. Refused writes assert the rows are exactly as they were.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test #418 ${label} ${suffix}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "INTERNAL_AUDITOR", "RISK_FACILITATOR"];
const CURATORS: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER"];

function requestAs(userId: string | null, init?: { method?: string; body?: string }, path = "") {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/compliance-boundaries${path}`, { ...init, headers });
}
const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const memberCtx = (id: string, systemId: string) => ({ params: Promise.resolve({ id, systemId }) });
const json = (body: unknown) => JSON.stringify(body);
const post = (userId: string | null, body: unknown) => POST(requestAs(userId, { method: "POST", body: json(body) }));
const patch = (id: string, userId: string | null, body: unknown) => PATCH(requestAs(userId, { method: "PATCH", body: json(body) }, `/${id}`), idCtx(id));
const getOne = (id: string, userId: string | null) => GET_ONE(requestAs(userId, undefined, `/${id}`), idCtx(id));
const add = (id: string, userId: string | null, body: unknown) => ADD(requestAs(userId, { method: "POST", body: json(body) }, `/${id}/systems`), idCtx(id));
const remove = (id: string, systemId: string, userId: string | null) => REMOVE(requestAs(userId, { method: "DELETE" }, `/${id}/systems/${systemId}`), memberCtx(id, systemId));

describe("/api/compliance-boundaries", () => {
  const userIds = {} as Record<UserRole, string>;
  let ownerId: string; // a SYSTEM_OWNER-role User who owns the Boundary and a System
  let otherOwnerId: string; // owner of another Boundary
  let publishedA: string;
  let publishedB: string;
  let draftId: string;
  let unitId: string;
  const systemIds: Record<string, string> = {};

  async function createUser(label: string, role: UserRole) {
    return (await prisma.user.create({ data: { email: `test-418-${label}-${suffix}@example.com`, name: `Test #418 ${label}`, role } })).id;
  }
  async function createSystem(label: string, status: OnboardingStatus, closed = false) {
    const system = await prisma.system.create({
      data: { name: NAME(label), status, ownerId: ownerId, ...(closed ? { evaluationClosedAt: new Date() } : {}) },
    });
    systemIds[label] = system.id;
    return system.id;
  }
  const createBoundary = (label: string, boundaryOwnerId: string | null = null, frameworkIds = [publishedA]) =>
    prisma.complianceBoundary.create({
      data: { name: NAME(label), boundaryOwnerId, frameworks: { create: frameworkIds.map((frameworkId) => ({ frameworkId })) } },
    });
  const snapshot = async () => ({
    boundaries: await prisma.complianceBoundary.findMany({ where: { name: { contains: suffix } }, include: { frameworks: true, systems: true }, orderBy: { name: "asc" } }),
    events: await prisma.changeEvent.count({ where: { action: "BOUNDARY_MEMBERSHIP_CHANGED", systemId: { in: Object.values(systemIds) } } }),
  });
  const eventsFor = (systemId: string) => prisma.changeEvent.findMany({ where: { systemId, action: "BOUNDARY_MEMBERSHIP_CHANGED" }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    for (const role of ROLES) userIds[role] = await createUser(role.toLowerCase(), role);
    ownerId = await createUser("boundary-owner", "SYSTEM_OWNER");
    otherOwnerId = await createUser("other-owner", "SYSTEM_OWNER");
    publishedA = (await prisma.framework.create({ data: { name: NAME("Framework A"), version: "1", status: "PUBLISHED" } })).id;
    publishedB = (await prisma.framework.create({ data: { name: NAME("Framework B"), version: "1", status: "PUBLISHED" } })).id;
    draftId = (await prisma.framework.create({ data: { name: NAME("Draft"), version: "1", status: "DRAFT" } })).id;
    unitId = (await prisma.businessUnit.create({ data: { name: NAME("Unit") } })).id;
    await createSystem("onboarded", "ONBOARDED");
    await createSystem("draft", "DRAFT");
    await createSystem("rejected", "REJECTED", true);
    await createSystem("not-selected", "NOT_SELECTED", true);
  });

  afterAll(async () => {
    const systems = Object.values(systemIds);
    await prisma.changeEvent.deleteMany({ where: { systemId: { in: systems } } });
    await prisma.complianceBoundary.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.system.deleteMany({ where: { id: { in: systems } } });
    await prisma.framework.deleteMany({ where: { id: { in: [publishedA, publishedB, draftId] } } });
    await prisma.businessUnit.deleteMany({ where: { id: unitId } });
    await prisma.user.deleteMany({ where: { id: { in: [...Object.values(userIds), ownerId, otherOwnerId] } } });
  });

  it("GET: 401 without a user, and every role reads the list and a Boundary with its members' names", async () => {
    const boundary = await createBoundary("readable", ownerId, [publishedA, publishedB]);
    await prisma.complianceBoundarySystem.create({ data: { boundaryId: boundary.id, systemId: systemIds.onboarded } });
    expect((await GET(requestAs(null))).status).toBe(401);
    expect((await getOne(boundary.id, null)).status).toBe(401);
    for (const role of ROLES) {
      const list = await GET(requestAs(userIds[role]));
      expect(list.status, role).toBe(200);
      const row = (await list.json()).boundaries.find((entry: { id: string }) => entry.id === boundary.id);
      expect(row, role).toMatchObject({ name: NAME("readable"), systemCount: 1, boundaryOwner: { id: ownerId } });
      expect(row.frameworks).toHaveLength(2);
      const one = await getOne(boundary.id, userIds[role]);
      expect(one.status, role).toBe(200);
      expect((await one.json()).boundary.members).toMatchObject([{ systemId: systemIds.onboarded, name: NAME("onboarded"), state: "OPERATING" }]);
    }
    expect((await getOne("missing-id", userIds.VIEWER)).status).toBe(404);
  });

  it("POST: a Compliance Manager and an Admin create a Boundary; everyone else gets 403 and nothing changes", async () => {
    const body = { name: NAME("created"), description: "  A contract  ", businessUnitId: unitId, boundaryOwnerId: ownerId, frameworkIds: [publishedA, publishedB, publishedA] };
    for (const role of ROLES.filter((r) => !CURATORS.includes(r))) {
      const before = await snapshot();
      expect((await post(userIds[role], body)).status, role).toBe(403);
      expect(await snapshot(), role).toEqual(before);
    }
    expect((await post(null, body)).status).toBe(401);
    expect((await prisma.complianceBoundary.findMany({ where: { name: NAME("created") } })).length).toBe(0);

    const response = await post(userIds.COMPLIANCE_MANAGER, body);
    expect(response.status).toBe(201);
    const { boundary } = await response.json();
    expect(boundary).toMatchObject({ name: NAME("created"), description: "A contract", businessUnit: { id: unitId }, boundaryOwner: { id: ownerId }, members: [] });
    expect(boundary.frameworks.map((f: { id: string }) => f.id).sort()).toEqual([publishedA, publishedB].sort());
    const rows = await prisma.complianceBoundaryFramework.findMany({ where: { boundaryId: boundary.id } });
    expect(rows.every((row) => row.addedById === userIds.COMPLIANCE_MANAGER)).toBe(true);

    const adminMade = await post(userIds.ADMIN, { name: NAME("by admin"), frameworkIds: [publishedA] });
    expect(adminMade.status).toBe(201);
    expect((await adminMade.json()).boundary).toMatchObject({ description: null, businessUnit: null, boundaryOwner: null });
  });

  it("POST: validation, a duplicate name (any case), a draft or unknown Framework, a missing Business Unit or Owner change nothing", async () => {
    await createBoundary("taken");
    const before = await snapshot();
    const cm = userIds.COMPLIANCE_MANAGER;
    expect((await post(cm, "not json")).status).toBe(400);
    expect((await post(cm, { frameworkIds: [publishedA] })).status).toBe(400);
    expect((await post(cm, { name: "  ", frameworkIds: [publishedA] })).status).toBe(400);
    expect((await post(cm, { name: NAME("no frameworks"), frameworkIds: [] })).status).toBe(400);
    expect((await post(cm, { name: NAME("no frameworks") })).status).toBe(400);
    expect((await post(cm, { name: NAME("unknown fw"), frameworkIds: ["nope"] })).status).toBe(400);
    expect((await post(cm, { name: NAME("unknown bu"), frameworkIds: [publishedA], businessUnitId: "nope" })).status).toBe(400);
    expect((await post(cm, { name: NAME("unknown user"), frameworkIds: [publishedA], boundaryOwnerId: "nope" })).status).toBe(400);
    const draft = await post(cm, { name: NAME("draft fw"), frameworkIds: [publishedA, draftId] });
    expect(draft.status).toBe(409);
    expect((await draft.json()).error).toMatch(/Published/);
    const clash = await post(cm, { name: NAME("taken").toUpperCase(), frameworkIds: [publishedA] });
    expect(clash.status).toBe(409);
    expect(await snapshot()).toEqual(before);
  });

  it("POST and PATCH: concurrent requests differing only in case can't both win (unique index on lower(name))", async () => {
    const cm = userIds.COMPLIANCE_MANAGER;
    const base = NAME("race");
    const created = await Promise.all([post(cm, { name: base, frameworkIds: [publishedA] }), post(cm, { name: base.toUpperCase(), frameworkIds: [publishedA] })]);
    expect(created.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await prisma.complianceBoundary.count({ where: { name: { equals: base, mode: "insensitive" } } })).toBe(1);

    const one = await createBoundary("rename one");
    const two = await createBoundary("rename two");
    const target = NAME("renamed");
    const renamed = await Promise.all([patch(one.id, cm, { name: target }), patch(two.id, cm, { name: target.toLowerCase() })]);
    expect(renamed.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await prisma.complianceBoundary.count({ where: { name: { equals: target, mode: "insensitive" } } })).toBe(1);
    // The database refuses it too, whatever the route does.
    await expect(prisma.complianceBoundary.create({ data: { name: NAME("RACE") } })).rejects.toThrow();
  });

  it("PATCH: curators edit every field; the whole Framework list is replaced; no Change Event is written", async () => {
    const boundary = await createBoundary("editable", null, [publishedA]);
    const rename = await patch(boundary.id, userIds.ADMIN, { name: NAME("edited"), description: "Contract 7", businessUnitId: unitId, boundaryOwnerId: ownerId, frameworkIds: [publishedB] });
    expect(rename.status).toBe(200);
    expect((await rename.json()).boundary).toMatchObject({ name: NAME("edited"), description: "Contract 7", businessUnit: { id: unitId }, boundaryOwner: { id: ownerId }, frameworks: [{ id: publishedB }] });
    const events = await prisma.changeEvent.count({ where: { action: "BOUNDARY_MEMBERSHIP_CHANGED", systemId: { in: Object.values(systemIds) } } });
    expect(events).toBe(0);

    const cleared = await patch(boundary.id, userIds.COMPLIANCE_MANAGER, { description: null, businessUnitId: null, boundaryOwnerId: null });
    expect((await cleared.json()).boundary).toMatchObject({ description: null, businessUnit: null, boundaryOwner: null, frameworks: [{ id: publishedB }] });
  });

  it("PATCH: other roles (the Boundary Owner too) get 403; bad input, a duplicate name, a draft Framework and a missing Boundary change nothing", async () => {
    const boundary = await createBoundary("guarded", ownerId);
    await createBoundary("other name");
    const before = await snapshot();
    for (const role of ROLES.filter((r) => !CURATORS.includes(r))) {
      expect((await patch(boundary.id, userIds[role], { name: NAME("hijack") })).status, role).toBe(403);
    }
    expect((await patch(boundary.id, ownerId, { name: NAME("hijack") })).status).toBe(403);
    expect((await patch(boundary.id, null, { name: NAME("hijack") })).status).toBe(401);
    const cm = userIds.COMPLIANCE_MANAGER;
    expect((await patch(boundary.id, cm, {})).status).toBe(400);
    expect((await patch(boundary.id, cm, { frameworkIds: [] })).status).toBe(400);
    expect((await patch(boundary.id, cm, { name: "" })).status).toBe(400);
    expect((await patch(boundary.id, cm, { name: NAME("OTHER NAME") })).status).toBe(409);
    expect((await patch(boundary.id, cm, { frameworkIds: [publishedA, draftId] })).status).toBe(409);
    expect((await patch(boundary.id, cm, { frameworkIds: ["nope"] })).status).toBe(400);
    expect((await patch(boundary.id, cm, { businessUnitId: "nope" })).status).toBe(400);
    expect((await patch("missing-id", cm, { name: NAME("x") })).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it("PATCH: a Framework the Boundary already holds stays even when it isn't Published any more", async () => {
    const boundary = await createBoundary("holds-draft", null, [publishedA]);
    await prisma.complianceBoundaryFramework.create({ data: { boundaryId: boundary.id, frameworkId: draftId } });
    const response = await patch(boundary.id, userIds.ADMIN, { description: "Still fine", frameworkIds: [publishedA, draftId] });
    expect(response.status).toBe(200);
    expect((await response.json()).boundary.frameworks).toHaveLength(2);
  });

  it("add member: the Boundary Owner, a Compliance Manager and an Admin may; a Change Event on the System names the Boundary", async () => {
    const boundary = await createBoundary("members", ownerId);
    const adds: [string, string][] = [
      [ownerId, systemIds.onboarded],
      [userIds.COMPLIANCE_MANAGER, systemIds.draft],
    ];
    for (const [actor, systemId] of adds) {
      const response = await add(boundary.id, actor, { systemId });
      expect(response.status).toBe(201);
    }
    const rows = await prisma.complianceBoundarySystem.findMany({ where: { boundaryId: boundary.id } });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.systemId === systemIds.onboarded)?.addedById).toBe(ownerId);
    const event = (await eventsFor(systemIds.onboarded)).at(-1);
    expect(event).toMatchObject({ actorId: ownerId, detail: `Added to Compliance Boundary "${NAME("members")}"` });
    const members = (await (await getOne(boundary.id, userIds.VIEWER)).json()).boundary.members;
    expect(members.map((member: { systemId: string; state: string }) => [member.systemId, member.state])).toEqual([
      [systemIds.onboarded, "OPERATING"],
      [systemIds.draft, "NOT_YET_OPERATING"],
    ]);
    await prisma.complianceBoundarySystem.deleteMany({ where: { boundaryId: boundary.id } });
    const adminAdd = await add(boundary.id, userIds.ADMIN, { systemId: systemIds.onboarded });
    expect(adminAdd.status).toBe(201);
  });

  it("add member: every other role, another Boundary's owner and the System's owner get 403 and nothing changes", async () => {
    const boundary = await createBoundary("guarded members", ownerId);
    // otherOwnerId owns another Boundary, which is no reason to manage this one.
    await createBoundary("someone elses", otherOwnerId);
    const before = await snapshot();
    for (const role of ROLES.filter((r) => !CURATORS.includes(r))) {
      expect((await add(boundary.id, userIds[role], { systemId: systemIds.draft })).status, role).toBe(403);
    }
    expect((await add(boundary.id, otherOwnerId, { systemId: systemIds.draft })).status).toBe(403);
    expect((await add(boundary.id, null, { systemId: systemIds.draft })).status).toBe(401);
    expect(await snapshot()).toEqual(before);
    expect(await prisma.complianceBoundarySystem.count({ where: { boundaryId: boundary.id } })).toBe(0);
  });

  it("add member: a closed System is 409, an unknown System 404, a second add 409, a bad body 400, an unknown Boundary 404", async () => {
    const boundary = await createBoundary("add refusals", ownerId);
    const cm = userIds.COMPLIANCE_MANAGER;
    const rejected = await add(boundary.id, cm, { systemId: systemIds.rejected });
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).error).toMatch(/closed/i);
    expect((await add(boundary.id, cm, { systemId: systemIds["not-selected"] })).status).toBe(409);
    expect((await add(boundary.id, cm, { systemId: "nope" })).status).toBe(404);
    expect((await add(boundary.id, cm, {})).status).toBe(400);
    expect((await add("missing-id", cm, { systemId: systemIds.draft })).status).toBe(404);
    expect(await prisma.complianceBoundarySystem.count({ where: { boundaryId: boundary.id } })).toBe(0);
    expect(await eventsFor(systemIds.rejected)).toHaveLength(0);

    expect((await add(boundary.id, cm, { systemId: systemIds.draft })).status).toBe(201);
    const events = (await eventsFor(systemIds.draft)).length;
    expect((await add(boundary.id, cm, { systemId: systemIds.draft })).status).toBe(409);
    expect(await prisma.complianceBoundarySystem.count({ where: { boundaryId: boundary.id } })).toBe(1);
    expect(await eventsFor(systemIds.draft)).toHaveLength(events);
  });

  it("remove member: the Boundary Owner, a Compliance Manager and an Admin may, with a Change Event; a closed member can be removed", async () => {
    const boundary = await createBoundary("removals", ownerId);
    for (const key of ["onboarded", "draft", "rejected"]) await prisma.complianceBoundarySystem.create({ data: { boundaryId: boundary.id, systemId: systemIds[key] } });
    expect((await remove(boundary.id, systemIds.onboarded, ownerId)).status).toBe(200);
    expect((await remove(boundary.id, systemIds.draft, userIds.COMPLIANCE_MANAGER)).status).toBe(200);
    const last = await remove(boundary.id, systemIds.rejected, userIds.ADMIN);
    expect(last.status).toBe(200);
    expect((await last.json()).boundary.members).toEqual([]);
    expect(await prisma.complianceBoundarySystem.count({ where: { boundaryId: boundary.id } })).toBe(0);
    const event = (await eventsFor(systemIds.onboarded)).at(-1);
    expect(event).toMatchObject({ actorId: ownerId, detail: `Removed from Compliance Boundary "${NAME("removals")}"` });
    expect(await eventsFor(systemIds.rejected)).toHaveLength(1);
  });

  it("remove member: other roles, another Boundary's owner and a System's owner get 403; a non-member is 404; nothing changes", async () => {
    const boundary = await createBoundary("guarded removals", otherOwnerId);
    await prisma.complianceBoundarySystem.create({ data: { boundaryId: boundary.id, systemId: systemIds.onboarded } });
    const before = await snapshot();
    for (const role of ROLES.filter((r) => !CURATORS.includes(r))) {
      expect((await remove(boundary.id, systemIds.onboarded, userIds[role])).status, role).toBe(403);
    }
    // ownerId owns the System itself and the other test Boundaries, but not this one: the System's owner can't leave.
    expect((await remove(boundary.id, systemIds.onboarded, ownerId)).status).toBe(403);
    expect((await remove(boundary.id, systemIds.onboarded, null)).status).toBe(401);
    expect((await remove(boundary.id, systemIds.draft, userIds.ADMIN)).status).toBe(404);
    expect((await remove("missing-id", systemIds.draft, userIds.ADMIN)).status).toBe(404);
    expect(await snapshot()).toEqual(before);
  });

  it("deleting a System removes its memberships; a Framework a Boundary holds can't be deleted", async () => {
    const boundary = await createBoundary("cascade", null, [publishedB]);
    const system = await prisma.system.create({ data: { name: NAME("temporary"), ownerId } });
    await prisma.complianceBoundarySystem.create({ data: { boundaryId: boundary.id, systemId: system.id } });
    await prisma.system.delete({ where: { id: system.id } });
    expect(await prisma.complianceBoundarySystem.count({ where: { boundaryId: boundary.id } })).toBe(0);
    expect(await prisma.complianceBoundary.count({ where: { id: boundary.id } })).toBe(1);
    await expect(prisma.framework.delete({ where: { id: publishedB } })).rejects.toThrow();
    expect(await prisma.framework.count({ where: { id: publishedB } })).toBe(1);
  });
});

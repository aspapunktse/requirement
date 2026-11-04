import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { createFixtureFramework, getBaseFramework } from "@/test/framework-fixtures";
import { GET, POST } from "../route";
import { POST as declareScope } from "../../framework-scopes/route";
import { DELETE as removeScope } from "../../framework-scopes/[frameworkId]/route";
import { PATCH as patchType, GET as getType } from "@/app/api/information-types/[id]/route";
import { POST as createType, GET as listTypes } from "@/app/api/information-types/route";
import { POST as createSystem } from "@/app/api/systems/route";
import { loadSystemsView } from "@/app/systems/systems-data";
import { inView } from "@/app/systems/systems-logic";

/**
 * Information Types suggest Frameworks (#300, ADR 0013), against real Postgres. Fixtures are `Test #300 …` rows created
 * here and removed in `afterAll` (CI's database is not seeded); Frameworks come from `createFixtureFramework` and the base
 * Framework is only read. Refused writes assert nothing changed in the database.
 */
const suffix = `${process.pid}-${Date.now()}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "VIEWER"];
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("Information Types suggest Frameworks (#300)", () => {
  const users = {} as Record<UserRole | "OTHER_OWNER", string>;
  const typeIds: string[] = [];
  const systemIds: string[] = [];
  const draftIds: string[] = [];
  let gdpr: { id: string; name: string; version: string };
  let other: { id: string; name: string; version: string };
  let draft: { id: string };
  let personal: string; // suggests gdpr
  let payroll: string; // suggests gdpr too
  let facetId: string;
  const systemName = `Test #300 System ${suffix}`;

  const makeType = async (label: string, frameworkIds: string[]) => {
    const row = await prisma.informationType.create({
      data: { name: `Test #300 ${label} ${suffix}`, sensitivityLevel: 3, suggestedFrameworks: { connect: frameworkIds.map((id) => ({ id })) } },
    });
    typeIds.push(row.id);
    return row.id;
  };
  const makeSystem = async (label: string, ownerId: string, types: string[], level: number | null = 3) => {
    const row = await prisma.system.create({
      data: {
        name: `${systemName} ${label}`,
        ownerId,
        status: "ONBOARDED",
        sensitivityLevel: level,
        deploymentFacets: { connect: [{ id: facetId }] },
        informationTypes: { connect: types.map((id) => ({ id })) },
      },
    });
    systemIds.push(row.id);
    return row.id;
  };
  const suggestions = async (systemId: string, userId = users.SYSTEM_OWNER) => {
    const response = await GET(requestAs(`/api/systems/${systemId}/framework-suggestions`, userId, "GET"), ctx(systemId));
    expect(response.status).toBe(200);
    return (await response.json()).suggestions as { framework: { id: string }; types: { id: string }[]; state: string }[];
  };
  const leaveOut = (systemId: string, userId: string | null, frameworkId: string) =>
    POST(requestAs(`/api/systems/${systemId}/framework-suggestions`, userId, "POST", { frameworkId }), ctx(systemId));
  const declines = (systemId: string) => prisma.frameworkSuggestionDecline.findMany({ where: { systemId }, orderBy: { informationTypeId: "asc" } });
  const scopeOf = async (systemId: string) =>
    (await prisma.framework.findMany({ where: { scopedSystems: { some: { id: systemId } } }, select: { id: true } })).map((f) => f.id).sort();
  const eventCount = (systemId: string) => prisma.changeEvent.count({ where: { systemId } });

  beforeAll(async () => {
    for (const role of ROLES) {
      users[role] = (await prisma.user.create({ data: { email: `test-300-${role.toLowerCase()}-${suffix}@example.com`, name: `Test #300 ${role}`, role } })).id;
    }
    users.OTHER_OWNER = (await prisma.user.create({ data: { email: `test-300-other-${suffix}@example.com`, name: "Test #300 other owner", role: "SYSTEM_OWNER" } })).id;
    facetId = (await prisma.deploymentFacet.create({ data: { name: `Test #300 Facet ${suffix}` } })).id;
    gdpr = await createFixtureFramework("#300 privacy");
    other = await createFixtureFramework("#300 other");
    draft = await prisma.framework.create({ data: { name: `Test #300 Draft ${suffix}`, version: "1", status: "DRAFT" } });
    draftIds.push(draft.id);
    personal = await makeType("Personal data", [gdpr.id]);
    payroll = await makeType("Payroll", [gdpr.id, draft.id]);
  });

  afterAll(async () => {
    await prisma.system.deleteMany({ where: { name: { startsWith: systemName } } });
    await prisma.informationType.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.framework.deleteMany({ where: { id: { in: draftIds } } });
    await prisma.deploymentFacet.deleteMany({ where: { id: facetId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  });

  describe("what a System is offered", () => {
    it("offers a Published Framework a declared type suggests, ignores a Draft one, and changes no scope", async () => {
      const id = await makeSystem("offer", users.SYSTEM_OWNER, [personal, payroll]);
      const list = await suggestions(id);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ framework: { id: gdpr.id }, state: "open" });
      expect(list[0].types.map((t) => t.id).sort()).toEqual([personal, payroll].sort());
      expect(await scopeOf(id)).toEqual([]);
    });

    it("offers nothing for a type the System does not declare", async () => {
      const id = await makeSystem("none", users.SYSTEM_OWNER, []);
      expect(await suggestions(id)).toEqual([]);
    });

    it("is 401 without a user and 404 for a System that does not exist", async () => {
      const id = await makeSystem("auth", users.SYSTEM_OWNER, [personal]);
      expect((await GET(requestAs(`/api/systems/${id}/framework-suggestions`, null, "GET"), ctx(id))).status).toBe(401);
      expect((await GET(requestAs("/api/systems/nope/framework-suggestions", users.SYSTEM_OWNER, "GET"), ctx("nope"))).status).toBe(404);
    });
  });

  describe("leaving a suggestion out", () => {
    it("records a decline for every declared type that suggests it, flags nothing more, and writes no Change Event", async () => {
      const id = await makeSystem("leave", users.SYSTEM_OWNER, [personal, payroll]);
      const events = await eventCount(id);
      const response = await leaveOut(id, users.SYSTEM_OWNER, gdpr.id);
      expect(response.status).toBe(201);
      expect((await declines(id)).map((d) => d.informationTypeId).sort()).toEqual([personal, payroll].sort());
      expect((await suggestions(id))[0].state).toBe("left-out");
      expect(await scopeOf(id)).toEqual([]);
      expect(await eventCount(id)).toBe(events);
      // Leaving it out again is harmless.
      expect((await leaveOut(id, users.SYSTEM_OWNER, gdpr.id)).status).toBe(201);
      expect(await declines(id)).toHaveLength(2);
    });

    it("is allowed for an Admin, refused with 403 for another owner and a Viewer, 401 for nobody; nothing is recorded", async () => {
      const id = await makeSystem("perm", users.SYSTEM_OWNER, [personal]);
      expect((await leaveOut(id, users.OTHER_OWNER, gdpr.id)).status).toBe(403);
      expect((await leaveOut(id, users.VIEWER, gdpr.id)).status).toBe(403);
      expect((await leaveOut(id, null, gdpr.id)).status).toBe(401);
      expect(await declines(id)).toEqual([]);
      expect((await leaveOut(id, users.ADMIN, gdpr.id)).status).toBe(201);
      expect(await declines(id)).toHaveLength(1);
    });

    it("refuses a Framework no declared type suggests, a Draft one, and a missing id, recording nothing", async () => {
      const id = await makeSystem("notsug", users.SYSTEM_OWNER, [personal]);
      expect((await leaveOut(id, users.SYSTEM_OWNER, other.id)).status).toBe(400);
      expect((await leaveOut(id, users.SYSTEM_OWNER, draft.id)).status).toBe(400);
      const base = await getBaseFramework();
      expect((await leaveOut(id, users.SYSTEM_OWNER, base.id)).status).toBe(400);
      expect((await POST(requestAs(`/api/systems/${id}/framework-suggestions`, users.SYSTEM_OWNER, "POST", {}), ctx(id))).status).toBe(400);
      expect(await declines(id)).toEqual([]);
    });
  });

  describe("adding to and removing from the Framework Scope", () => {
    it("adding a suggested Framework puts it in scope; removing it then records the decision so the System is not flagged again", async () => {
      const id = await makeSystem("scope", users.SYSTEM_OWNER, [personal, payroll]);
      const add = await declareScope(requestAs(`/api/systems/${id}/framework-scopes`, users.SYSTEM_OWNER, "POST", { frameworkId: gdpr.id }), ctx(id));
      expect(add.status).toBe(201);
      expect(await scopeOf(id)).toEqual([gdpr.id]);
      expect((await suggestions(id))[0].state).toBe("in-scope");

      const remove = await removeScope(requestAs(`/api/systems/${id}/framework-scopes/${gdpr.id}`, users.SYSTEM_OWNER, "DELETE"), {
        params: Promise.resolve({ id, frameworkId: gdpr.id }),
      });
      expect(remove.status).toBe(200);
      expect(await scopeOf(id)).toEqual([]);
      expect((await declines(id)).map((d) => d.informationTypeId).sort()).toEqual([personal, payroll].sort());
      expect((await suggestions(id))[0].state).toBe("left-out");
    });

    it("removing a Framework no type suggests records no decline", async () => {
      const id = await makeSystem("plain", users.SYSTEM_OWNER, [personal]);
      await declareScope(requestAs(`/api/systems/${id}/framework-scopes`, users.SYSTEM_OWNER, "POST", { frameworkId: other.id }), ctx(id));
      await removeScope(requestAs(`/api/systems/${id}/framework-scopes/${other.id}`, users.SYSTEM_OWNER, "DELETE"), {
        params: Promise.resolve({ id, frameworkId: other.id }),
      });
      expect(await declines(id)).toEqual([]);
    });
  });

  describe("a curator changing a type's Frameworks", () => {
    const patch = (id: string, userId: string | null, body: unknown) =>
      patchType(requestAs(`/api/information-types/${id}`, userId, "PATCH", body), ctx(id));
    const linkedIds = async (id: string) => (await prisma.informationType.findUniqueOrThrow({ where: { id }, select: { suggestedFrameworks: { select: { id: true } } } })).suggestedFrameworks.map((f) => f.id).sort();

    it("flags the Systems that declare the type, with their scope, declines and Change Events untouched", async () => {
      const typeId = await makeType("Flagging", []);
      const id = await makeSystem("flagged", users.SYSTEM_OWNER, [typeId]);
      expect(await suggestions(id)).toEqual([]);
      const events = await eventCount(id);

      const response = await patch(typeId, users.COMPLIANCE_MANAGER, { frameworkIds: [other.id] });
      expect(response.status).toBe(200);
      expect((await response.json()).informationType.suggestedFrameworks.map((f: { id: string }) => f.id)).toEqual([other.id]);
      expect((await suggestions(id))[0]).toMatchObject({ framework: { id: other.id }, state: "open" });
      expect(await scopeOf(id)).toEqual([]);
      expect(await declines(id)).toEqual([]);
      expect(await eventCount(id)).toBe(events);

      // Unlinking clears the flag, again without touching the System.
      expect((await patch(typeId, users.ADMIN, { frameworkIds: [] })).status).toBe(200);
      expect(await suggestions(id)).toEqual([]);
    });

    it("re-opens a left-out suggestion for a type linked later", async () => {
      const first = await makeType("First", [other.id]);
      const second = await makeType("Second", []);
      const id = await makeSystem("reopen", users.SYSTEM_OWNER, [first, second]);
      await leaveOut(id, users.SYSTEM_OWNER, other.id);
      expect((await suggestions(id))[0].state).toBe("left-out");
      await patch(second, users.COMPLIANCE_MANAGER, { frameworkIds: [other.id] });
      expect((await suggestions(id))[0].state).toBe("open");
    });

    it("refuses the base Framework and unknown ids with 400, changing nothing", async () => {
      const typeId = await makeType("Refusals", [other.id]);
      const base = await getBaseFramework();
      expect((await patch(typeId, users.COMPLIANCE_MANAGER, { frameworkIds: [other.id, base.id] })).status).toBe(400);
      expect((await patch(typeId, users.COMPLIANCE_MANAGER, { frameworkIds: [other.id, "no-such-framework"] })).status).toBe(400);
      expect((await patch(typeId, users.COMPLIANCE_MANAGER, { frameworkIds: "gdpr" })).status).toBe(400);
      expect(await linkedIds(typeId)).toEqual([other.id]);
    });

    it("refuses a System owner and nobody, changing nothing", async () => {
      const typeId = await makeType("Permission", [other.id]);
      expect((await patch(typeId, users.SYSTEM_OWNER, { frameworkIds: [] })).status).toBe(403);
      expect((await patch(typeId, null, { frameworkIds: [] })).status).toBe(401);
      expect(await linkedIds(typeId)).toEqual([other.id]);
    });

    it("may link a Draft Framework, which suggests nothing and is hidden from those who cannot see Drafts", async () => {
      const typeId = await makeType("Drafty", []);
      expect((await patch(typeId, users.COMPLIANCE_MANAGER, { frameworkIds: [draft.id] })).status).toBe(200);
      const id = await makeSystem("drafty", users.SYSTEM_OWNER, [typeId]);
      expect(await suggestions(id)).toEqual([]);

      const asCurator = await getType(requestAs(`/api/information-types/${typeId}`, users.COMPLIANCE_MANAGER, "GET"), ctx(typeId));
      expect((await asCurator.json()).informationType.suggestedFrameworks.map((f: { id: string }) => f.id)).toEqual([draft.id]);
      const asOwner = await getType(requestAs(`/api/information-types/${typeId}`, users.SYSTEM_OWNER, "GET"), ctx(typeId));
      expect((await asOwner.json()).informationType.suggestedFrameworks).toEqual([]);
      const list = await listTypes(requestAs("/api/information-types", users.SYSTEM_OWNER, "GET"));
      const row = (await list.json()).informationTypes.find((t: { id: string }) => t.id === typeId);
      expect(row.suggestedFrameworks).toEqual([]);
    });

    it("creates a type with Frameworks, and refuses a base Framework without creating it", async () => {
      const name = `Test #300 Created ${suffix}`;
      const created = await createType(requestAs("/api/information-types", users.COMPLIANCE_MANAGER, "POST", { name, sensitivityLevel: 2, frameworkIds: [other.id] }));
      expect(created.status).toBe(201);
      typeIds.push((await created.json()).informationType.id);
      const base = await getBaseFramework();
      const refused = await createType(requestAs("/api/information-types", users.COMPLIANCE_MANAGER, "POST", { name: `${name} 2`, sensitivityLevel: 2, frameworkIds: [base.id] }));
      expect(refused.status).toBe(400);
      expect(await prisma.informationType.count({ where: { name: `${name} 2` } })).toBe(0);
    });
  });

  describe("creating a System from the onboarding interview", () => {
    const create = (label: string, body: Record<string, unknown>) =>
      createSystem(requestAs("/api/systems", users.SYSTEM_OWNER, "POST", { name: `${systemName} ${label}`, deploymentFacetIds: [facetId], ...body }));
    const created = async (label: string) => prisma.system.findFirst({ where: { name: `${systemName} ${label}` } });

    it("with No records a decline per suggesting type, in the same create, and the System is not flagged", async () => {
      const response = await create("no", { sensitivityLevel: 3, informationTypeIds: [personal, payroll], declinedFrameworkIds: [gdpr.id] });
      expect(response.status).toBe(201);
      const id = (await response.json()).system.id as string;
      systemIds.push(id);
      expect((await declines(id)).map((d) => d.informationTypeId).sort()).toEqual([personal, payroll].sort());
      expect((await suggestions(id))[0].state).toBe("left-out");
      expect(await scopeOf(id)).toEqual([]);
    });

    it("with Yes puts the Framework in scope and records no decline", async () => {
      const response = await create("yes", { sensitivityLevel: 3, informationTypeIds: [personal], frameworkScopeIds: [gdpr.id] });
      expect(response.status).toBe(201);
      const id = (await response.json()).system.id as string;
      systemIds.push(id);
      expect(await scopeOf(id)).toEqual([gdpr.id]);
      expect(await declines(id)).toEqual([]);
      expect((await suggestions(id))[0].state).toBe("in-scope");
    });

    it("unanswered creates the System flagged, with nothing recorded and nothing in scope", async () => {
      const response = await create("open", { sensitivityLevel: 3, informationTypeIds: [personal] });
      expect(response.status).toBe(201);
      const id = (await response.json()).system.id as string;
      systemIds.push(id);
      expect(await declines(id)).toEqual([]);
      expect(await scopeOf(id)).toEqual([]);
      expect((await suggestions(id))[0].state).toBe("open");
      const view = await loadSystemsView({ id: users.SYSTEM_OWNER, name: "Test #300 SYSTEM_OWNER", role: "SYSTEM_OWNER" });
      const row = view.rows.find((r) => r.id === id)!;
      expect(row.hasSuggestedFrameworks).toBe(true);
      expect(inView(row, "suggested")).toBe(true);
    });

    it("refuses forged decline ids and creates nothing", async () => {
      // Not suggested by any declared type, a Framework only another type suggests, the base Framework, a made-up id,
      // and one that is also being put in scope.
      const base = await getBaseFramework();
      const bodies = [
        { informationTypeIds: [personal], declinedFrameworkIds: [other.id] },
        { informationTypeIds: [], declinedFrameworkIds: [gdpr.id] },
        { informationTypeIds: [personal], declinedFrameworkIds: [base.id] },
        { informationTypeIds: [personal], declinedFrameworkIds: ["no-such-framework"] },
        { informationTypeIds: [personal], declinedFrameworkIds: [gdpr.id], frameworkScopeIds: [gdpr.id] },
      ];
      for (const [index, body] of bodies.entries()) {
        const response = await create(`forged${index}`, { sensitivityLevel: 3, ...body });
        expect(response.status).toBe(400);
        expect(await created(`forged${index}`)).toBeNull();
      }
    });
  });

  describe("the Systems list", () => {
    it("flags only the Systems with an open suggestion and counts them in the saved view", async () => {
      const open = await makeSystem("list-open", users.SYSTEM_OWNER, [personal]);
      const left = await makeSystem("list-left", users.SYSTEM_OWNER, [personal]);
      const scoped = await makeSystem("list-scoped", users.SYSTEM_OWNER, [personal]);
      const none = await makeSystem("list-none", users.SYSTEM_OWNER, []);
      await leaveOut(left, users.SYSTEM_OWNER, gdpr.id);
      await declareScope(requestAs(`/api/systems/${scoped}/framework-scopes`, users.SYSTEM_OWNER, "POST", { frameworkId: gdpr.id }), ctx(scoped));

      const view = await loadSystemsView({ id: users.ADMIN, name: "Test #300 ADMIN", role: "ADMIN" });
      const flagged = new Set(view.rows.filter((row) => inView(row, "suggested")).map((row) => row.id));
      expect(flagged.has(open)).toBe(true);
      for (const id of [left, scoped, none]) expect(flagged.has(id)).toBe(false);
    });
  });
});

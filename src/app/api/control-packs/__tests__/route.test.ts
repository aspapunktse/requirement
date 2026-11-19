import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { loadPlannerData } from "@/lib/audit-planner";
import { DELETE, GET as GET_ONE, PATCH } from "../[id]/route";
import { GET, POST } from "../route";

/**
 * /api/control-packs and /api/control-packs/[id] (#394), against real Postgres. Fixtures are `Test #394 …` Controls
 * (Organizational, never mapped to a Framework), packs and Internal Audits created here and removed in `afterAll`;
 * CI's database is migrated but not seeded. Refused writes assert the rows are exactly as they were.
 */
const suffix = `${process.pid}-${Date.now()}`;
const NAME = (label: string) => `Test #394 ${label} ${suffix}`;
const ROLES: UserRole[] = ["ADMIN", "COMPLIANCE_MANAGER", "SYSTEM_OWNER", "RISK_OWNER", "REVIEWER", "VIEWER", "BUSINESS_RISK_OWNER", "INTERNAL_AUDITOR"];
const READERS: UserRole[] = ["INTERNAL_AUDITOR", "ADMIN", "COMPLIANCE_MANAGER", "RISK_OWNER"];

function requestAs(userId: string | null, init?: { method?: string; body?: string }, path = "") {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost/api/control-packs${path}`, { ...init, headers });
}
const ctxFor = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) => (typeof body === "string" ? body : JSON.stringify(body));
const post = (userId: string | null, body: unknown) => POST(requestAs(userId, { method: "POST", body: json(body) }));
const patch = (id: string, userId: string | null, body: unknown) => PATCH(requestAs(userId, { method: "PATCH", body: json(body) }, `/${id}`), ctxFor(id));
const del = (id: string, userId: string | null) => DELETE(requestAs(userId, { method: "DELETE" }, `/${id}`), ctxFor(id));
const getOne = (id: string, userId: string | null) => GET_ONE(requestAs(userId, undefined, `/${id}`), ctxFor(id));

describe("/api/control-packs", () => {
  const userIds = {} as Record<UserRole, string>;
  const controlIds: string[] = [];
  const auditIds: string[] = [];
  let c1: string;
  let c2: string;
  let c3: string;

  const fixtureRows = () => prisma.controlPack.findMany({ where: { name: { contains: suffix } }, include: { controls: true }, orderBy: { name: "asc" } });
  async function createControl(label: string, code: string) {
    const control = await prisma.control.create({
      data: { code: `TEST394-${code}-${suffix}`, title: NAME(label), description: "Fixture.", category: "Test", applicability: "ORGANIZATIONAL" },
    });
    controlIds.push(control.id);
    return control.id;
  }
  const createPack = (label: string, ids: string[] = [], note = "") =>
    prisma.controlPack.create({ data: { name: NAME(label), note, controls: { create: ids.map((controlId) => ({ controlId })) } } });

  beforeAll(async () => {
    for (const role of ROLES) {
      userIds[role] = (await prisma.user.create({ data: { email: `test-394-${role.toLowerCase()}-${suffix}@example.com`, name: `Test #394 ${role}`, role } })).id;
    }
    c1 = await createControl("one", "A1");
    c2 = await createControl("two", "A2");
    c3 = await createControl("three", "A10");
  });

  afterAll(async () => {
    await prisma.internalAudit.deleteMany({ where: { id: { in: auditIds } } });
    await prisma.controlPack.deleteMany({ where: { name: { contains: suffix } } });
    await prisma.control.deleteMany({ where: { id: { in: controlIds } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(userIds) } } });
  });

  it("GET: 401 without a user, 403 for a role that can't read Internal Audits, and every reader sees the packs with their Controls in code order", async () => {
    const pack = await createPack("list", [c3, c1], "Listed.");
    expect((await GET(requestAs(null))).status).toBe(401);
    for (const role of ROLES) {
      const response = await GET(requestAs(userIds[role]));
      if (!READERS.includes(role)) {
        expect(response.status, role).toBe(403);
        continue;
      }
      expect(response.status, role).toBe(200);
      const { controlPacks } = await response.json();
      expect(controlPacks.find((row: { id: string }) => row.id === pack.id), role).toEqual({ id: pack.id, name: NAME("list"), note: "Listed.", controlIds: [c1, c3] });
    }
    expect((await getOne(pack.id, userIds.INTERNAL_AUDITOR)).status).toBe(200);
    expect((await getOne(pack.id, userIds.VIEWER)).status).toBe(403);
    expect((await getOne("nope", userIds.INTERNAL_AUDITOR)).status).toBe(404);
  });

  it("POST: an Internal Auditor creates a pack, trimming the name and dropping repeated Controls", async () => {
    const response = await post(userIds.INTERNAL_AUDITOR, { name: `  ${NAME("created")}  `, note: " For access. ", controlIds: [c1, c2, c1] });
    expect(response.status).toBe(201);
    const { controlPack } = await response.json();
    expect(controlPack).toMatchObject({ name: NAME("created"), note: "For access.", controlIds: [c1, c2] });
    expect((await fixtureRows()).find((row) => row.id === controlPack.id)?.controls).toHaveLength(2);
  });

  it("POST: every other role, and no user, is refused and nothing is created", async () => {
    const before = await fixtureRows();
    for (const role of ROLES.filter((r) => r !== "INTERNAL_AUDITOR")) {
      expect((await post(userIds[role], { name: NAME(`refused ${role}`), controlIds: [c1] })).status, role).toBe(403);
    }
    expect((await post(null, { name: NAME("refused anon") })).status).toBe(401);
    expect(await fixtureRows()).toEqual(before);
  });

  it("POST: refuses bad bodies, unknown Controls and a repeated name in any case, naming the clash", async () => {
    await createPack("Dupe");
    const before = await fixtureRows();
    const user = userIds.INTERNAL_AUDITOR;
    expect((await post(user, "not json")).status).toBe(400);
    expect((await post(user, { name: "   " })).status).toBe(400);
    expect((await post(user, { name: "x".repeat(81) })).status).toBe(400);
    expect((await post(user, { name: NAME("bad note"), note: "x".repeat(201) })).status).toBe(400);
    expect((await post(user, { name: NAME("bad ids"), controlIds: "c1" })).status).toBe(400);
    const unknown = await post(user, { name: NAME("unknown"), controlIds: [c1, "no-such-control"] });
    expect(unknown.status).toBe(400);

    for (const attempt of [NAME("Dupe"), NAME("Dupe").toUpperCase(), NAME("Dupe").toLowerCase()]) {
      const clash = await post(user, { name: attempt });
      expect(clash.status, attempt).toBe(409);
      expect((await clash.json()).error).toContain(NAME("Dupe"));
    }
    expect(await fixtureRows()).toEqual(before);
  });

  it("the database refuses a name that differs only by case, whatever the handler checks", async () => {
    await createPack("Index");
    await expect(prisma.controlPack.create({ data: { name: NAME("INDEX") } })).rejects.toMatchObject({ code: "P2002" });
  });

  it("PATCH: renames, changes the note and replaces the Controls; an omitted field is left alone", async () => {
    const pack = await createPack("patch", [c1, c2], "Before.");
    const user = userIds.INTERNAL_AUDITOR;

    const controls = await patch(pack.id, user, { controlIds: [c2, c3] });
    expect(controls.status).toBe(200);
    expect((await controls.json()).controlPack).toEqual({ id: pack.id, name: NAME("patch"), note: "Before.", controlIds: [c2, c3] });

    const text = await patch(pack.id, user, { name: NAME("patch renamed"), note: "" });
    expect((await text.json()).controlPack).toEqual({ id: pack.id, name: NAME("patch renamed"), note: "", controlIds: [c2, c3] });

    const emptied = await patch(pack.id, user, { controlIds: [] });
    expect((await emptied.json()).controlPack.controlIds).toEqual([]);
    expect(await prisma.controlPack.findUnique({ where: { id: pack.id } })).not.toBeNull();
  });

  it("PATCH: renaming to its own name in another case is fine; to another pack's name is refused and nothing changes", async () => {
    const own = await createPack("Own", [c1]);
    const other = await createPack("Other");
    const user = userIds.INTERNAL_AUDITOR;
    expect((await patch(own.id, user, { name: NAME("OWN") })).status).toBe(200);

    const before = await fixtureRows();
    const clash = await patch(own.id, user, { name: NAME("other").toUpperCase(), controlIds: [c2] });
    expect(clash.status).toBe(409);
    expect((await clash.json()).error).toContain(other.name);
    expect(await fixtureRows()).toEqual(before);
  });

  it("PATCH: refuses an empty body, unknown Controls and a missing pack; every other role is refused and nothing changes", async () => {
    const pack = await createPack("patch refused", [c1], "Same.");
    const user = userIds.INTERNAL_AUDITOR;
    const before = await fixtureRows();
    expect((await patch(pack.id, user, {})).status).toBe(400);
    expect((await patch(pack.id, user, { controlIds: [c2, "no-such-control"] })).status).toBe(400);
    expect((await patch("no-such-pack", user, { note: "x" })).status).toBe(404);
    for (const role of ROLES.filter((r) => r !== "INTERNAL_AUDITOR")) {
      expect((await patch(pack.id, userIds[role], { name: NAME("hijacked"), controlIds: [c2] })).status, role).toBe(403);
    }
    expect((await patch(pack.id, null, { note: "x" })).status).toBe(401);
    expect(await fixtureRows()).toEqual(before);
  });

  it("DELETE: only an Internal Auditor deletes; the pack and its rows go and the Controls stay", async () => {
    const pack = await createPack("delete", [c1, c2]);
    for (const role of ROLES.filter((r) => r !== "INTERNAL_AUDITOR")) {
      expect((await del(pack.id, userIds[role])).status, role).toBe(403);
    }
    expect((await del(pack.id, null)).status).toBe(401);
    expect(await prisma.controlPackControl.count({ where: { controlPackId: pack.id } })).toBe(2);

    expect((await del(pack.id, userIds.INTERNAL_AUDITOR)).status).toBe(204);
    expect(await prisma.controlPack.findUnique({ where: { id: pack.id } })).toBeNull();
    expect(await prisma.controlPackControl.count({ where: { controlPackId: pack.id } })).toBe(0);
    expect(await prisma.control.count({ where: { id: { in: [c1, c2] } } })).toBe(2);
    expect((await del(pack.id, userIds.INTERNAL_AUDITOR)).status).toBe(404);
  });

  it("a deleted Control drops out of the pack, and a pack left with none still exists", async () => {
    const lonely = await createControl("lonely", "L1");
    const pack = await createPack("lonely", [lonely]);
    expect((await loadPlannerData()).packs.find((row) => row.id === pack.id)?.controlIds).toEqual([lonely]);

    await prisma.control.delete({ where: { id: lonely } });
    const { controlPack } = await (await getOne(pack.id, userIds.INTERNAL_AUDITOR)).json();
    expect(controlPack).toEqual({ id: pack.id, name: NAME("lonely"), note: "", controlIds: [] });
    expect((await loadPlannerData()).packs.find((row) => row.id === pack.id)?.controlIds).toEqual([]);
  });

  it("the planner data lists the packs by name", async () => {
    await createPack("planner b", [c1]);
    await createPack("planner a", [c2, c1]);
    const names = (await loadPlannerData()).packs.map((row) => row.name).filter((n) => n.includes(`planner`) && n.includes(suffix));
    expect(names).toEqual([NAME("planner a"), NAME("planner b")]);
  });

  it("editing or deleting a pack leaves a draft and a launched Internal Audit as they were", async () => {
    const pack = await createPack("audits", [c1, c2]);
    const make = async (label: string, status: "DRAFT" | "LAUNCHED") => {
      const audit = await prisma.internalAudit.create({
        data: {
          title: NAME(label),
          dueDate: new Date("2099-01-01T00:00:00.000Z"),
          status,
          launchedAt: status === "LAUNCHED" ? new Date() : null,
          createdById: userIds.INTERNAL_AUDITOR,
          controls: { create: [{ controlId: c1 }, { controlId: c2 }] },
        },
      });
      auditIds.push(audit.id);
      return audit.id;
    };
    const draftId = await make("draft", "DRAFT");
    const launchedId = await make("launched", "LAUNCHED");
    const snapshot = () =>
      prisma.internalAudit.findMany({
        where: { id: { in: [draftId, launchedId] } },
        orderBy: { title: "asc" },
        include: { controls: { select: { controlId: true }, orderBy: { controlId: "asc" } } },
      });
    const before = await snapshot();

    expect((await patch(pack.id, userIds.INTERNAL_AUDITOR, { name: NAME("audits renamed"), controlIds: [c3] })).status).toBe(200);
    expect(await snapshot()).toEqual(before);
    expect((await del(pack.id, userIds.INTERNAL_AUDITOR)).status).toBe(204);
    expect(await snapshot()).toEqual(before);
  });
});

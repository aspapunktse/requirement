import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { POST, GET } from "../route";
import { DELETE, PATCH } from "../[id]/route";

const SUFFIX = Date.now();
const CM_EMAIL = "test-frameworks-cm@example.com";
const VIEWER_EMAIL = "test-frameworks-viewer@example.com";

function req(path: string, method: string, userId: string | null, body?: unknown) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("/api/frameworks: version, base Framework and supersedes rules", () => {
  let cmId: string;
  let viewerId: string;
  let baseId: string;
  const createdIds: string[] = [];
  // Only set when this file had to create a base Framework itself (CI's DB is migrated but not seeded).
  let createdBaseId: string | null = null;

  async function create(body: Record<string, unknown>) {
    const response = await POST(req("/api/frameworks", "POST", cmId, body));
    if (response.status === 201) createdIds.push((await response.clone().json()).framework.id);
    return response;
  }

  beforeAll(async () => {
    const [cm, viewer] = await Promise.all([
      prisma.user.upsert({
        where: { email: CM_EMAIL },
        update: {},
        create: { email: CM_EMAIL, name: "Frameworks CM", role: "COMPLIANCE_MANAGER" },
      }),
      prisma.user.upsert({
        where: { email: VIEWER_EMAIL },
        update: {},
        create: { email: VIEWER_EMAIL, name: "Frameworks Viewer", role: "VIEWER" },
      }),
    ]);
    cmId = cm.id;
    viewerId = viewer.id;
    // The base Framework: the seeded ISO/IEC 27001:2022 on a seeded DB (never mutated by these
    // tests), otherwise a fixture base created here and removed in afterAll.
    const existingBase = await prisma.framework.findFirst({ where: { isBase: true } });
    if (existingBase) {
      baseId = existingBase.id;
    } else {
      const base = await prisma.framework.create({
        data: { name: `Test Base FW ${SUFFIX}`, version: "1", isBase: true, status: "PUBLISHED" },
      });
      baseId = createdBaseId = base.id;
    }
  });

  afterAll(async () => {
    await prisma.framework.updateMany({ where: { id: { in: createdIds } }, data: { supersedesId: null } });
    await prisma.framework.deleteMany({ where: { id: { in: createdIds } } });
    if (createdBaseId) await prisma.framework.deleteMany({ where: { id: createdBaseId } });
    await prisma.user.deleteMany({ where: { email: { in: [CM_EMAIL, VIEWER_EMAIL] } } });
  });

  it("there is exactly one base Framework, and it lists with its version and Requirement count", async () => {
    expect(await prisma.framework.count({ where: { isBase: true } })).toBe(1);

    const response = await GET(req("/api/frameworks", "GET", viewerId));
    const { frameworks } = await response.json();
    const base = frameworks.find((f: { id: string }) => f.id === baseId);
    expect(base).toMatchObject({ isBase: true, status: "PUBLISHED", licensing: "PARAPHRASE_ONLY" });
    expect(typeof base.version).toBe("string");
    expect(typeof base._count.requirements).toBe("number");
  });

  it("creates a Draft, non-base Framework; status cannot be set through the API", async () => {
    const response = await create({
      name: `Test FW ${SUFFIX}`,
      version: "1",
      status: "PUBLISHED",
      licensing: "QUOTABLE",
    });
    expect(response.status).toBe(201);
    const { framework } = await response.json();
    expect(framework).toMatchObject({ status: "DRAFT", isBase: false, licensing: "QUOTABLE", supersedesId: null });
  });

  it("requires a version", async () => {
    const response = await POST(req("/api/frameworks", "POST", cmId, { name: `Test FW no version ${SUFFIX}` }));
    expect(response.status).toBe(400);
  });

  it("name + version is unique; the same name at another version is allowed", async () => {
    const name = `Test FW versions ${SUFFIX}`;
    expect((await create({ name, version: "2013" })).status).toBe(201);
    expect((await create({ name, version: "2013" })).status).toBe(409);
    expect((await create({ name, version: "2022" })).status).toBe(201);
  });

  it("refuses to create a second base Framework", async () => {
    const response = await POST(
      req("/api/frameworks", "POST", cmId, { name: `Test FW base ${SUFFIX}`, version: "1", isBase: true }),
    );
    expect(response.status).toBe(409);
    expect(await prisma.framework.count({ where: { isBase: true } })).toBe(1);
  });

  it("refuses to promote another Framework to base, or to unset or retire the base", async () => {
    const created = await create({ name: `Test FW promote ${SUFFIX}`, version: "1" });
    const { framework } = await created.json();

    const promote = await PATCH(
      req(`/api/frameworks/${framework.id}`, "PATCH", cmId, { isBase: true }),
      ctx(framework.id),
    );
    expect(promote.status).toBe(409);

    const unset = await PATCH(req(`/api/frameworks/${baseId}`, "PATCH", cmId, { isBase: false }), ctx(baseId));
    expect(unset.status).toBe(409);

    const retire = await DELETE(req(`/api/frameworks/${baseId}`, "DELETE", cmId), ctx(baseId));
    expect(retire.status).toBe(409);

    expect(await prisma.framework.count({ where: { isBase: true } })).toBe(1);
    expect((await prisma.framework.findUniqueOrThrow({ where: { id: baseId } })).isBase).toBe(true);
  });

  it("can link a Framework to the version it supersedes, but not in a loop", async () => {
    const older = await (await create({ name: `Test FW chain ${SUFFIX}`, version: "2013" })).json();
    const newer = await (
      await create({ name: `Test FW chain ${SUFFIX}`, version: "2022", supersedesId: older.framework.id })
    ).json();
    expect(newer.framework.supersedesId).toBe(older.framework.id);

    const loop = await PATCH(
      req(`/api/frameworks/${older.framework.id}`, "PATCH", cmId, { supersedesId: newer.framework.id }),
      ctx(older.framework.id),
    );
    expect(loop.status).toBe(400);

    const self = await PATCH(
      req(`/api/frameworks/${older.framework.id}`, "PATCH", cmId, { supersedesId: older.framework.id }),
      ctx(older.framework.id),
    );
    expect(self.status).toBe(400);

    const missing = await create({ name: `Test FW missing ${SUFFIX}`, version: "1", supersedesId: "does-not-exist" });
    expect(missing.status).toBe(400);
  });

  it("will not retire a Framework that has Requirements", async () => {
    const { framework } = await (await create({ name: `Test FW with reqs ${SUFFIX}`, version: "1" })).json();
    await prisma.requirement.create({
      data: { frameworkId: framework.id, code: "R.1", section: "R", title: "t", text: "t" },
    });

    const response = await DELETE(req(`/api/frameworks/${framework.id}`, "DELETE", cmId), ctx(framework.id));
    expect(response.status).toBe(409);
  });

  it("retires an empty Draft Framework", async () => {
    const { framework } = await (await create({ name: `Test FW retire ${SUFFIX}`, version: "1" })).json();
    const response = await DELETE(req(`/api/frameworks/${framework.id}`, "DELETE", cmId), ctx(framework.id));
    expect(response.status).toBe(204);
  });

  it("is refused to a Viewer", async () => {
    const response = await POST(
      req("/api/frameworks", "POST", viewerId, { name: `Test FW viewer ${SUFFIX}`, version: "1" }),
    );
    expect(response.status).toBe(403);
  });
});

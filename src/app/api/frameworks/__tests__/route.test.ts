import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getBaseFramework } from "@/test/framework-fixtures";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { POST, GET } from "../route";
import { DELETE, PATCH } from "../[id]/route";
import { POST as publish } from "../[id]/publish/route";
import { POST as createRequirement } from "../[id]/requirements/route";
import { PATCH as patchRequirement, DELETE as deleteRequirement } from "../[id]/requirements/[requirementId]/route";
import { POST as createMapping } from "../[id]/requirements/[requirementId]/mappings/route";

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
    // The base Framework: the seeded ISO/IEC 27001:2022, or the one vitest.global-setup.ts creates
    // for CI's unseeded DB. Never mutated by these tests.
    baseId = (await getBaseFramework()).id;
  });

  afterAll(async () => {
    await prisma.framework.updateMany({ where: { id: { in: createdIds } }, data: { supersedesId: null } });
    await prisma.framework.deleteMany({ where: { id: { in: createdIds } } });
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

  it("the base Framework can't be moved back to Draft, or published again", async () => {
    const back = await PATCH(req(`/api/frameworks/${baseId}`, "PATCH", cmId, { status: "DRAFT" }), ctx(baseId));
    expect(back.status).toBe(409);
    expect((await back.json()).error).toMatch(/base Framework/);

    const again = await publish(req(`/api/frameworks/${baseId}/publish`, "POST", cmId), ctx(baseId));
    expect(again.status).toBe(409);

    expect((await prisma.framework.findUniqueOrThrow({ where: { id: baseId } })).status).toBe("PUBLISHED");
  });

  it("the base Framework's Requirements are editable: add, edit, map and delete", async () => {
    const code = `TEST-BASE-${SUFFIX}`;
    // A Per-System Control on a Deployment Facet no System has, so the base Requirement is Not Applicable
    // everywhere once mapped. An Organizational one would count on every System, other test files' too (#231).
    const facet = await prisma.deploymentFacet.create({ data: { name: `Test Base Editing Facet ${SUFFIX}` } });
    const control = await prisma.control.create({
      data: {
        code: `TEST-BASE-CTL-${SUFFIX}`,
        title: "Base editing control",
        description: "d",
        category: "Test",
        applicability: "PER_SYSTEM",
        deploymentFacets: { connect: { id: facet.id } },
      },
    });
    let requirementId: string | null = null;
    try {
      const created = await createRequirement(
        req(`/api/frameworks/${baseId}/requirements`, "POST", cmId, { code, section: "Test", title: "T", text: "t" }),
        ctx(baseId),
      );
      expect(created.status).toBe(201);
      requirementId = (await created.json()).requirement.id as string;
      const rctx = { params: Promise.resolve({ id: baseId, requirementId }) };

      // Mapped straight away: until then it is Not Met on every System.
      const mapped = await createMapping(
        req(`/api/frameworks/${baseId}/requirements/${requirementId}/mappings`, "POST", cmId, {
          controlId: control.id,
          coverage: "FULL",
        }),
        rctx,
      );
      expect(mapped.status).toBe(201);

      const edited = await patchRequirement(
        req(`/api/frameworks/${baseId}/requirements/${requirementId}`, "PATCH", cmId, { title: "Edited" }),
        rctx,
      );
      expect(edited.status).toBe(200);
      expect((await edited.json()).requirement.title).toBe("Edited");

      const deleted = await deleteRequirement(
        req(`/api/frameworks/${baseId}/requirements/${requirementId}`, "DELETE", cmId),
        rctx,
      );
      expect(deleted.status).toBe(204);
      requirementId = null;
    } finally {
      // Net-zero on the (possibly seeded) base Framework, whatever happened above.
      if (requirementId) await prisma.requirement.deleteMany({ where: { id: requirementId } });
      await prisma.requirement.deleteMany({ where: { frameworkId: baseId, code } });
      await prisma.control.delete({ where: { id: control.id } });
      await prisma.deploymentFacet.delete({ where: { id: facet.id } });
      await prisma.changeEvent.deleteMany({ where: { actorId: cmId, detail: { contains: code } } });
    }
    expect(await prisma.requirement.count({ where: { frameworkId: baseId, code } })).toBe(0);
  });

  it("is refused to a Viewer", async () => {
    const response = await POST(
      req("/api/frameworks", "POST", viewerId, { name: `Test FW viewer ${SUFFIX}`, version: "1" }),
    );
    expect(response.status).toBe(403);
  });
});

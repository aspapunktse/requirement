import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { POST } from "../route";
import { PATCH } from "../[id]/route";

// Supersedes guards (#146): a Framework can't supersede itself, directly or through a chain.
// POST can't form a cycle: a new Framework has no id yet, so nothing can point at it before it exists.
const SUFFIX = `${process.pid}-${Date.now()}`;
const CM_EMAIL = `test-146-supersedes-cm-${SUFFIX}@example.com`;

function req(path: string, method: string, userId: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: new Headers({ cookie: `${ACTING_USER_COOKIE}=${userId}` }),
    body: JSON.stringify(body),
  });
}

describe("supersedes cycles are refused with no DB change", () => {
  let cmId: string;
  const ids: string[] = [];

  async function create(version: string, supersedesId: string | null) {
    const response = await POST(req("/api/frameworks", "POST", cmId, { name: `Test 146 cycle ${SUFFIX}`, version, supersedesId }));
    expect(response.status).toBe(201);
    const { framework } = await response.json();
    ids.push(framework.id);
    return framework.id as string;
  }

  async function patchSupersedes(id: string, supersedesId: string) {
    return PATCH(req(`/api/frameworks/${id}`, "PATCH", cmId, { supersedesId }), { params: Promise.resolve({ id }) });
  }

  async function links() {
    const rows = await prisma.framework.findMany({ where: { id: { in: ids } } });
    return JSON.stringify(rows.sort((a, b) => a.id.localeCompare(b.id)));
  }

  beforeAll(async () => {
    cmId = (await prisma.user.create({ data: { email: CM_EMAIL, name: "Test 146 CM", role: "COMPLIANCE_MANAGER" } })).id;
  });

  afterAll(async () => {
    // SetNull on supersedes lets these go in any order.
    await prisma.framework.deleteMany({ where: { id: { in: ids } } });
    await prisma.user.deleteMany({ where: { email: CM_EMAIL } });
  });

  it("refuses a self-reference", async () => {
    const a = await create("1", null);
    const before = await links();
    const response = await patchSupersedes(a, a);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/can't supersede itself/);
    expect(await links()).toBe(before);
  });

  it("refuses a two-step cycle", async () => {
    const a = await create("2a", null);
    const b = await create("2b", a);
    const before = await links();
    expect((await patchSupersedes(a, b)).status).toBe(400);
    expect(await links()).toBe(before);
  });

  it("refuses a three-step cycle", async () => {
    const a = await create("3a", null);
    const b = await create("3b", a);
    const c = await create("3c", b);
    const before = await links();
    expect((await patchSupersedes(a, c)).status).toBe(400);
    expect(await links()).toBe(before);
  });

  it("still allows re-pointing to a Framework that is not a descendant", async () => {
    const a = await create("4a", null);
    const b = await create("4b", null);
    expect((await patchSupersedes(b, a)).status).toBe(200);
    expect((await prisma.framework.findUniqueOrThrow({ where: { id: b } })).supersedesId).toBe(a);
  });
});

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { GET, POST } from "../[id]/framework-scopes/route";

/**
 * A Draft Framework can't be added to a System's Framework Scope (#73): the
 * API rejects it (and, for users who can't see Drafts, as if it didn't
 * exist). Scope rows that already point at a Draft Framework (left over from
 * the #72 migration) are not touched and still read back.
 */

const SUFFIX = Date.now();

function req(path: string, method: string, userId: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: new Headers({ "Content-Type": "application/json", cookie: `${ACTING_USER_COOKIE}=${userId}` }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/systems/[id]/framework-scopes: Draft Frameworks", () => {
  let ownerId: string;
  let adminId: string;
  let systemId: string;
  let draftId: string;
  let publishedId: string;
  let legacyDraftId: string;
  const ctx = () => ({ params: Promise.resolve({ id: systemId }) });
  const declare = (userId: string, frameworkId: string) =>
    POST(req(`/api/systems/${systemId}/framework-scopes`, "POST", userId, { frameworkId }), ctx());
  const scopeIds = async () =>
    (await prisma.system.findUniqueOrThrow({ where: { id: systemId }, include: { frameworkScopes: true } })).frameworkScopes
      .map((f) => f.id)
      .sort();

  beforeAll(async () => {
    const [owner, admin] = await Promise.all([
      prisma.user.create({
        data: { email: `test-scope-draft-owner-${SUFFIX}@example.com`, name: "Scope Owner", role: "SYSTEM_OWNER" },
      }),
      prisma.user.create({
        data: { email: `test-scope-draft-admin-${SUFFIX}@example.com`, name: "Scope Admin", role: "ADMIN" },
      }),
    ]);
    ownerId = owner.id;
    adminId = admin.id;
    const [draft, published, legacy] = await Promise.all([
      prisma.framework.create({ data: { name: `Test Scope Draft FW ${SUFFIX}`, version: "1" } }),
      prisma.framework.create({ data: { name: `Test Scope Published FW ${SUFFIX}`, version: "1", status: "PUBLISHED" } }),
      prisma.framework.create({ data: { name: `Test Scope Legacy Draft FW ${SUFFIX}`, version: "1" } }),
    ]);
    draftId = draft.id;
    publishedId = published.id;
    legacyDraftId = legacy.id;
    const system = await prisma.system.create({
      data: {
        name: `Scope Draft System ${SUFFIX}`,
        ownerId,
        frameworkScopes: { connect: { id: legacyDraftId } },
      },
    });
    systemId = system.id;
  });

  afterAll(async () => {
    await prisma.changeEvent.deleteMany({ where: { systemId } });
    await prisma.system.deleteMany({ where: { id: systemId } });
    await prisma.framework.deleteMany({ where: { id: { in: [draftId, publishedId, legacyDraftId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId] } } });
  });

  it("rejects a Draft Framework with a clear message when an Admin declares it, and adds nothing", async () => {
    const response = await declare(adminId, draftId);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Draft Framework can't be added/);
    expect(await scopeIds()).toEqual([legacyDraftId]);
  });

  it("treats a Draft Framework as not found for the System Owner, who can't see Drafts", async () => {
    const response = await declare(ownerId, draftId);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Framework not found");
    expect(await scopeIds()).toEqual([legacyDraftId]);
  });

  it("still accepts a Published Framework", async () => {
    const response = await declare(ownerId, publishedId);
    expect(response.status).toBe(201);
    expect(await scopeIds()).toEqual([publishedId, legacyDraftId].sort());
  });

  it("leaves an existing Draft scope row alone: it is still listed", async () => {
    const response = await GET(req(`/api/systems/${systemId}/framework-scopes`, "GET", ownerId), ctx());
    const { frameworkScopes } = await response.json();
    expect(frameworkScopes.map((f: { id: string }) => f.id)).toContain(legacyDraftId);
  });
});

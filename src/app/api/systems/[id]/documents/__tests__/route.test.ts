import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import type { SystemDocumentRow } from "@/lib/system-documentation";
import { prisma } from "@/lib/prisma";
import { requestAs } from "@/test/provider-fixtures";
import { DELETE as deleteRequirement } from "../../../../document-requirements/[id]/route";
import { GET } from "../route";
import { PUT } from "../[documentRequirementId]/route";

/**
 * A System's documentation (#324, PRD 0002 F-DOC.2), against real Postgres. Self-contained fixtures (CI's DB is
 * migrated, not seeded): Test Users, Test Systems and Test Document Requirements, all removed in `afterAll`. The
 * catalogue is shared, so reads look only at the fixtures. A refused write asserts the rows are exactly as they were.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "otherOwner", "riskOwner", "viewer", "complianceManager", "internalAuditor", "bso"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = {
  admin: "ADMIN",
  owner: "SYSTEM_OWNER",
  otherOwner: "SYSTEM_OWNER",
  riskOwner: "RISK_OWNER",
  viewer: "VIEWER",
  complianceManager: "COMPLIANCE_MANAGER",
  internalAuditor: "INTERNAL_AUDITOR",
  bso: "REVIEWER",
};
const users = {} as Record<Key, string>;
const systemIds: string[] = [];
let draftId: string;
let onboardedId: string;
let requirementId: string;
let secondId: string;

beforeAll(async () => {
  for (const key of KEYS) {
    users[key] = (await prisma.user.create({ data: { email: `test-sdoc-${key}-${suffix}@example.com`, name: `Test Sdoc ${key}`, role: ROLE[key] } })).id;
  }
  const make = async (status: "DRAFT" | "ONBOARDED") => {
    const system = await prisma.system.create({
      data: { name: `Test Sdoc System ${suffix}-${systemIds.length}`, ownerId: users.owner, status, businessSystemOwnerId: users.bso },
    });
    systemIds.push(system.id);
    return system.id;
  };
  draftId = await make("DRAFT");
  onboardedId = await make("ONBOARDED");
  requirementId = (await prisma.documentRequirement.create({ data: { name: `Test Sdoc Architecture ${suffix}`, description: "How it is built.", stage: "FIRST_DOCUMENTATION", tracks: ["FULL"] } })).id;
  secondId = (await prisma.documentRequirement.create({ data: { name: `Test Sdoc Handover ${suffix}`, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] } })).id;
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.documentRequirement.deleteMany({ where: { name: { contains: suffix } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const get = (userId: string | null, id: string) => GET(requestAs(`/api/systems/${id}/documents`, userId, "GET"), { params: Promise.resolve({ id }) });
const put = (userId: string | null, id: string, documentRequirementId: string, body: unknown) =>
  PUT(requestAs(`/api/systems/${id}/documents/${documentRequirementId}`, userId, "PUT", body), { params: Promise.resolve({ id, documentRequirementId }) });
const rowsOf = (id: string) => prisma.systemDocument.findMany({ where: { systemId: id }, orderBy: { documentRequirementId: "asc" } });
const mine = <T extends { name: string }>(documents: T[]) => documents.filter((document) => document.name.includes(suffix));
const GOOD = { link: "https://example.com/architecture", provided: true };

describe("PUT /api/systems/[id]/documents/[documentRequirementId] (#324)", { timeout: 30_000 }, () => {
  it("lets the owner set a link and mark it provided, recording who and when, at any Onboarding Status", async () => {
    for (const id of [draftId, onboardedId]) {
      const response = await put(users.owner, id, requirementId, GOOD);
      expect(response.status).toBe(200);
      expect((await response.json()).document).toMatchObject({ id: requirementId, link: GOOD.link, provided: true, updatedBy: { id: users.owner, name: "Test Sdoc owner" } });
      const rows = await rowsOf(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ documentRequirementId: requirementId, link: GOOD.link, provided: true, updatedById: users.owner });
    }
  });

  it("lets an Admin write, updates the same row (no duplicate) and keeps a link while un-marking provided", async () => {
    const id = draftId;
    const before = await rowsOf(id);
    expect((await put(users.admin, id, requirementId, { link: "  https://example.com/v2  ", provided: false })).status).toBe(200);
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: before[0].id, link: "https://example.com/v2", provided: false, updatedById: users.admin });
    // Back to provided, then clear the link and un-mark: a row with no link and not provided.
    expect((await put(users.owner, id, requirementId, GOOD)).status).toBe(200);
    expect((await put(users.owner, id, requirementId, { link: "", provided: false })).status).toBe(200);
    expect(await rowsOf(id)).toMatchObject([{ link: null, provided: false }]);
  });

  it("refuses everyone else with 403 and changes nothing: another System Owner, a Risk Owner, a Viewer, the Business System Owner, the read-only roles", async () => {
    await put(users.owner, onboardedId, requirementId, GOOD);
    const before = await rowsOf(onboardedId);
    for (const key of ["otherOwner", "riskOwner", "viewer", "bso", "complianceManager", "internalAuditor"] as const) {
      const response = await put(users[key], onboardedId, requirementId, { link: "https://example.com/other", provided: false });
      expect(response.status, key).toBe(403);
    }
    expect(await rowsOf(onboardedId)).toEqual(before);
    // On a Draft the Business System Owner sees the System but still can't write; nothing is created.
    const draftBefore = await rowsOf(draftId);
    expect((await put(users.bso, draftId, secondId, GOOD)).status).toBe(403);
    expect(await rowsOf(draftId)).toEqual(draftBefore);
  });

  it("answers 404 for a System the user can't see (a Draft of someone else's), 401 with nobody signed in, and writes nothing", async () => {
    const before = await rowsOf(draftId);
    expect((await put(users.viewer, draftId, secondId, GOOD)).status).toBe(404);
    expect((await put(users.otherOwner, draftId, secondId, GOOD)).status).toBe(404);
    expect((await put(null, draftId, secondId, GOOD)).status).toBe(401);
    expect((await put(users.owner, "no-such-system", secondId, GOOD)).status).toBe(404);
    expect(await rowsOf(draftId)).toEqual(before);
  });

  it("checks the right before the body, so a refused user learns nothing from a bad body", async () => {
    expect((await put(users.viewer, onboardedId, requirementId, { nonsense: true })).status).toBe(403);
  });

  it("validates the body: 400 and nothing written", async () => {
    const before = await rowsOf(draftId);
    for (const body of [
      { link: null, provided: true },
      { link: "", provided: true },
      { link: "javascript:alert(1)", provided: false },
      { link: "ftp://example.com/a", provided: false },
      { link: "not a url", provided: false },
      { link: `https://example.com/${"a".repeat(2000)}`, provided: false },
      { link: "https://example.com/a" },
      { provided: false },
      { link: 5, provided: false },
      { link: null, provided: "yes" },
      null,
    ]) {
      const response = await put(users.owner, draftId, secondId, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await response.json()).error).toBe("string");
    }
    expect((await put(users.owner, draftId, secondId, { link: null, provided: true })).status).toBe(400);
    expect(await rowsOf(draftId)).toEqual(before);
  });

  it("answers 404 for an unknown Document Requirement, and nothing is written", async () => {
    const before = await rowsOf(draftId);
    expect((await put(users.owner, draftId, "no-such-requirement", GOOD)).status).toBe(404);
    expect(await rowsOf(draftId)).toEqual(before);
  });
});

describe("GET /api/systems/[id]/documents (#324)", { timeout: 30_000 }, () => {
  it("lists the Document Requirements with what the System provided, and who may edit", async () => {
    await prisma.systemDocument.deleteMany({ where: { systemId: onboardedId } });
    await put(users.owner, onboardedId, requirementId, GOOD);

    const response = await get(users.owner, onboardedId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.canEdit).toBe(true);
    const documents = mine<SystemDocumentRow>(body.documents);
    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      id: requirementId,
      name: `Test Sdoc Architecture ${suffix}`,
      description: "How it is built.",
      stage: "FIRST_DOCUMENTATION",
      tracks: ["FULL"],
      link: GOOD.link,
      provided: true,
      updatedBy: { id: users.owner },
    });
    expect(typeof documents[0].updatedAt).toBe("string");
    // No row: not provided.
    expect(documents[1]).toMatchObject({ id: secondId, link: null, provided: false, updatedAt: null, updatedBy: null, tracks: ["SELF", "FULL"] });
  });

  it("is readable, without edit rights, by everyone who may see the System", async () => {
    for (const key of ["admin", "viewer", "bso", "riskOwner", "complianceManager", "internalAuditor", "otherOwner"] as const) {
      const response = await get(users[key], onboardedId);
      expect(response.status, key).toBe(200);
      expect((await response.json()).canEdit, key).toBe(key === "admin");
    }
    // The Business System Owner sees a Draft too.
    expect((await get(users.bso, draftId)).status).toBe(200);
  });

  it("answers 404 for a System the user can't see, 401 with nobody signed in", async () => {
    expect((await get(users.viewer, draftId)).status).toBe(404);
    expect((await get(users.otherOwner, draftId)).status).toBe(404);
    expect((await get(users.owner, "no-such-system")).status).toBe(404);
    expect((await get(null, onboardedId)).status).toBe(401);
  });
});

describe("deleting what a System provided against", { timeout: 30_000 }, () => {
  it("removes a Document Requirement from every System, with its rows, when it leaves the catalogue; the Systems keep working", async () => {
    const doomed = await prisma.documentRequirement.create({ data: { name: `Test Sdoc Doomed ${suffix}`, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] } });
    await put(users.owner, draftId, doomed.id, GOOD);
    await put(users.owner, onboardedId, doomed.id, GOOD);
    expect(await prisma.systemDocument.count({ where: { documentRequirementId: doomed.id } })).toBe(2);

    const response = await deleteRequirement(requestAs(`/api/document-requirements/${doomed.id}`, users.complianceManager, "DELETE"), { params: Promise.resolve({ id: doomed.id }) });
    expect(response.status).toBe(204);

    expect(await prisma.systemDocument.count({ where: { documentRequirementId: doomed.id } })).toBe(0);
    for (const id of [draftId, onboardedId]) {
      const read = await get(users.owner, id);
      expect(read.status).toBe(200);
      expect((await read.json()).documents.some((document: { id: string }) => document.id === doomed.id)).toBe(false);
    }
    expect((await put(users.owner, draftId, doomed.id, GOOD)).status).toBe(404);
  });

  it("removes a System's rows with the System and leaves the catalogue alone", async () => {
    const system = await prisma.system.create({ data: { name: `Test Sdoc Gone ${suffix}`, ownerId: users.owner, status: "DRAFT" } });
    await put(users.owner, system.id, requirementId, GOOD);
    expect(await prisma.systemDocument.count({ where: { systemId: system.id } })).toBe(1);
    await prisma.system.delete({ where: { id: system.id } });
    expect(await prisma.systemDocument.count({ where: { systemId: system.id } })).toBe(0);
    expect(await prisma.documentRequirement.findUnique({ where: { id: requirementId } })).not.toBeNull();
  });
});

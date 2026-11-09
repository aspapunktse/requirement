// @vitest-environment node
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ACTING_USER_COOKIE } from "@/lib/acting-user";
import { MAX_DOCUMENT_FILE_BYTES } from "@/lib/system-document-file";
import { requestAs } from "@/test/provider-fixtures";
import { GET as listDocuments } from "../route";
import { PUT } from "../[documentRequirementId]/route";
import { DELETE, GET, POST } from "../[documentRequirementId]/file/route";

/**
 * The file a System uploads for a Document Requirement (#324): upload, replace, remove, download, the size and type
 * limits and the rights. Self-contained fixtures (CI's DB is migrated, not seeded), removed in `afterAll`. A refused
 * request asserts the stored rows are exactly as they were.
 */
const suffix = `${process.pid}-${Date.now()}`;
const KEYS = ["admin", "owner", "otherOwner", "viewer", "bso", "complianceManager"] as const;
type Key = (typeof KEYS)[number];
const ROLE: Record<Key, UserRole> = { admin: "ADMIN", owner: "SYSTEM_OWNER", otherOwner: "SYSTEM_OWNER", viewer: "VIEWER", bso: "REVIEWER", complianceManager: "COMPLIANCE_MANAGER" };
const users = {} as Record<Key, string>;
let draftId: string;
let onboardedId: string;
let requirementId: string;
const systemIds: string[] = [];

beforeAll(async () => {
  for (const key of KEYS) users[key] = (await prisma.user.create({ data: { email: `test-sdf-${key}-${suffix}@example.com`, name: `Test Sdf ${key}`, role: ROLE[key] } })).id;
  const make = async (status: "DRAFT" | "ONBOARDED") => {
    const system = await prisma.system.create({ data: { name: `Test Sdf System ${suffix}-${systemIds.length}`, ownerId: users.owner, status, businessSystemOwnerId: users.bso } });
    systemIds.push(system.id);
    return system.id;
  };
  draftId = await make("DRAFT");
  onboardedId = await make("ONBOARDED");
  requirementId = (await prisma.documentRequirement.create({ data: { name: `Test Sdf Architecture ${suffix}`, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] } })).id;
});

afterAll(async () => {
  await prisma.system.deleteMany({ where: { id: { in: systemIds } } });
  await prisma.documentRequirement.deleteMany({ where: { name: { contains: suffix } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
});

const ctxFor = (id: string, documentRequirementId: string) => ({ params: Promise.resolve({ id, documentRequirementId }) });
const url = (id: string, documentRequirementId = requirementId) => `/api/systems/${id}/documents/${documentRequirementId}/file`;

function formRequest(userId: string | null, path: string, form: FormData | string) {
  const headers = new Headers();
  if (userId) headers.set("cookie", `${ACTING_USER_COOKIE}=${userId}`);
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers, body: form });
}
const fileForm = (name: string, content: string | Uint8Array, type: string) => {
  const form = new FormData();
  form.append("file", new File([content as BlobPart], name, { type }));
  return form;
};
const upload = (userId: string | null, id: string, form: FormData | string, documentRequirementId = requirementId) =>
  POST(formRequest(userId, url(id, documentRequirementId), form), ctxFor(id, documentRequirementId));
const remove = (userId: string | null, id: string, documentRequirementId = requirementId) =>
  DELETE(requestAs(url(id, documentRequirementId), userId, "DELETE"), ctxFor(id, documentRequirementId));
const download = (userId: string | null, id: string, documentRequirementId = requirementId) =>
  GET(requestAs(url(id, documentRequirementId), userId, "GET"), ctxFor(id, documentRequirementId));
const put = (userId: string | null, id: string, body: unknown) =>
  PUT(requestAs(`/api/systems/${id}/documents/${requirementId}`, userId, "PUT", body), ctxFor(id, requirementId));
const snapshot = async (id: string) => ({
  documents: await prisma.systemDocument.findMany({ where: { systemId: id }, orderBy: { id: "asc" } }),
  files: await prisma.systemDocumentFile.findMany({ where: { systemDocument: { systemId: id } }, orderBy: { id: "asc" } }),
});
const reset = (id: string) => prisma.systemDocument.deleteMany({ where: { systemId: id } });

describe("uploading, replacing and removing a file (#324)", { timeout: 30_000 }, () => {
  it("lets the owner upload a file at any Onboarding Status; the listing shows it without its bytes and it is not yet provided", async () => {
    for (const id of [draftId, onboardedId]) {
      await reset(id);
      const response = await upload(users.owner, id, fileForm("Architecture é.pdf", "%PDF-1.4 hello", "application/pdf"));
      expect(response.status).toBe(200);
      const { document } = await response.json();
      expect(document).toMatchObject({ id: requirementId, provided: false, link: null, file: { fileName: "Architecture é.pdf", contentType: "application/pdf", size: 14 } });
      expect(document.file).not.toHaveProperty("data");
      const { files } = await snapshot(id);
      expect(files).toHaveLength(1);
      expect(Buffer.from(files[0].data).toString()).toBe("%PDF-1.4 hello");
      expect(files[0].uploadedById).toBe(users.owner);

      const listed = await (await listDocuments(requestAs(`/api/systems/${id}/documents`, users.owner, "GET"), { params: Promise.resolve({ id }) })).json();
      const row = listed.documents.find((item: { id: string }) => item.id === requirementId);
      expect(row.file).toMatchObject({ fileName: "Architecture é.pdf", size: 14 });
      expect(JSON.stringify(listed)).not.toContain("%PDF-1.4");
    }
  });

  it("lets an Admin upload; a second upload replaces the first (one file per Document Requirement) and keeps the link and provided", async () => {
    const id = onboardedId;
    await reset(id);
    await put(users.owner, id, { link: "https://example.com/doc", provided: true });
    expect((await upload(users.owner, id, fileForm("v1.txt", "one", "text/plain"))).status).toBe(200);
    expect((await upload(users.admin, id, fileForm("v2.md", "# two", "text/markdown"))).status).toBe(200);

    const { documents, files } = await snapshot(id);
    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({ link: "https://example.com/doc", provided: true, updatedById: users.admin });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ fileName: "v2.md", contentType: "text/markdown", size: 5, uploadedById: users.admin });
    expect(Buffer.from(files[0].data).toString()).toBe("# two");
  });

  it("allows provided with only a file, and refuses it with neither a link nor a file", async () => {
    const id = draftId;
    await reset(id);
    expect((await put(users.owner, id, { link: null, provided: true })).status).toBe(400);
    expect(await snapshot(id)).toEqual({ documents: [], files: [] });

    await upload(users.owner, id, fileForm("a.docx", "x", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    const response = await put(users.owner, id, { link: null, provided: true });
    expect(response.status).toBe(200);
    expect((await response.json()).document).toMatchObject({ provided: true, link: null, file: { fileName: "a.docx" } });
  });

  it("removes the file; with a link left it stays provided, with none left it goes back to not provided in the same step", async () => {
    const id = onboardedId;
    await reset(id);
    await upload(users.owner, id, fileForm("a.pdf", "x", "application/pdf"));
    await put(users.owner, id, { link: "https://example.com/doc", provided: true });
    let response = await remove(users.owner, id);
    expect(response.status).toBe(200);
    expect((await response.json()).document).toMatchObject({ provided: true, link: "https://example.com/doc", file: null });
    expect((await snapshot(id)).files).toHaveLength(0);

    await upload(users.admin, id, fileForm("b.pdf", "y", "application/pdf"));
    await put(users.owner, id, { link: null, provided: true });
    response = await remove(users.admin, id);
    expect(response.status).toBe(200);
    expect((await response.json()).document).toMatchObject({ provided: false, link: null, file: null });
    const { documents, files } = await snapshot(id);
    expect(files).toHaveLength(0);
    expect(documents[0]).toMatchObject({ provided: false, link: null, updatedById: users.admin });

    expect((await remove(users.owner, id)).status).toBe(404);
  });

  it("removes the file when its System or its Document Requirement is deleted", async () => {
    const doomed = await prisma.documentRequirement.create({ data: { name: `Test Sdf Doomed ${suffix}`, stage: "SECOND_ROUND", tracks: ["SELF", "FULL"] } });
    await upload(users.owner, draftId, fileForm("a.pdf", "x", "application/pdf"), doomed.id);
    const row = await prisma.systemDocument.findFirstOrThrow({ where: { systemId: draftId, documentRequirementId: doomed.id } });
    await prisma.documentRequirement.delete({ where: { id: doomed.id } });
    expect(await prisma.systemDocumentFile.count({ where: { systemDocumentId: row.id } })).toBe(0);

    const system = await prisma.system.create({ data: { name: `Test Sdf Gone ${suffix}`, ownerId: users.owner, status: "DRAFT" } });
    await upload(users.owner, system.id, fileForm("a.pdf", "x", "application/pdf"));
    const before = await prisma.systemDocumentFile.count({ where: { systemDocument: { systemId: system.id } } });
    expect(before).toBe(1);
    await prisma.system.delete({ where: { id: system.id } });
    expect(await prisma.systemDocumentFile.count({ where: { fileName: "a.pdf", systemDocument: { systemId: system.id } } })).toBe(0);
  });
});

describe("marking provided while the file is removed (#324)", { timeout: 30_000 }, () => {
  it("never leaves provided set with neither a link nor a file, whichever of the two requests wins", async () => {
    const id = onboardedId;
    for (let round = 0; round < 8; round++) {
      await reset(id);
      await upload(users.owner, id, fileForm("a.pdf", "x", "application/pdf"));
      const [marked, removed] = await Promise.all([put(users.owner, id, { link: null, provided: true }), remove(users.admin, id)]);
      expect([200, 400]).toContain(marked.status);
      expect([200, 404]).toContain(removed.status);
      const { documents, files } = await snapshot(id);
      for (const document of documents) expect(!document.provided || document.link !== null || files.length > 0, `round ${round}`).toBe(true);
    }
  });
});

describe("limits and refusals on the file routes (#324)", { timeout: 30_000 }, () => {
  it("refuses a file over the cap with 413, and a body over it before reading, writing nothing", async () => {
    await reset(draftId);
    const big = new Uint8Array(MAX_DOCUMENT_FILE_BYTES + 1);
    const response = await upload(users.owner, draftId, fileForm("big.pdf", big, "application/pdf"));
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain("4 MB");

    const huge = new Uint8Array(MAX_DOCUMENT_FILE_BYTES + 200 * 1024);
    expect((await upload(users.owner, draftId, fileForm("huge.pdf", huge, "application/pdf"))).status).toBe(413);
    expect(await snapshot(draftId)).toEqual({ documents: [], files: [] });

    const atCap = await upload(users.owner, draftId, fileForm("cap.pdf", new Uint8Array(MAX_DOCUMENT_FILE_BYTES), "application/pdf"));
    expect(atCap.status).toBe(200);
  });

  it("refuses other types with 415: by extension, by declared content type, and HTML or SVG", async () => {
    await reset(draftId);
    for (const [name, type] of [
      ["page.html", "text/html"],
      ["image.svg", "image/svg+xml"],
      ["run.exe", "application/octet-stream"],
      ["noextension", "text/plain"],
      ["fake.pdf", "text/html"],
      ["fake.png", "application/pdf"],
    ]) {
      const response = await upload(users.owner, draftId, fileForm(name, "x", type));
      expect(response.status, name).toBe(415);
    }
    expect(await snapshot(draftId)).toEqual({ documents: [], files: [] });
  });

  it("accepts every allowed extension with its type", async () => {
    await reset(draftId);
    for (const [name, type] of [["a.pdf", "application/pdf"], ["a.doc", "application/msword"], ["a.xls", "application/vnd.ms-excel"], ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["a.ppt", "application/vnd.ms-powerpoint"], ["a.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"], ["a.PNG", "image/png"], ["a.jpg", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.txt", "text/plain"], ["a.md", ""]]) {
      expect((await upload(users.owner, draftId, fileForm(name, "x", type))).status, name).toBe(200);
    }
  });

  it("answers 400 for a missing file, an empty file or a body that is not multipart", async () => {
    expect((await upload(users.owner, draftId, new FormData())).status).toBe(400);
    expect((await upload(users.owner, draftId, fileForm("empty.pdf", "", "application/pdf"))).status).toBe(400);
    const form = new FormData();
    form.append("file", "just text");
    expect((await upload(users.owner, draftId, form)).status).toBe(400);
  });

  it("refuses everyone but the owner and an Admin with 403, changing nothing: upload, replace and remove", async () => {
    const id = onboardedId;
    await reset(id);
    await upload(users.owner, id, fileForm("keep.pdf", "keep", "application/pdf"));
    const before = await snapshot(id);
    for (const key of ["otherOwner", "viewer", "bso", "complianceManager"] as const) {
      expect((await upload(users[key], id, fileForm("evil.pdf", "evil", "application/pdf"))).status, `${key} upload`).toBe(403);
      expect((await remove(users[key], id)).status, `${key} remove`).toBe(403);
    }
    expect(await snapshot(id)).toEqual(before);
  });

  it("answers 404 for a System the user can't see, an unknown Document Requirement, and 401 with nobody signed in", async () => {
    await reset(draftId);
    expect((await upload(users.viewer, draftId, fileForm("a.pdf", "x", "application/pdf"))).status).toBe(404);
    expect((await upload(users.otherOwner, draftId, fileForm("a.pdf", "x", "application/pdf"))).status).toBe(404);
    expect((await upload(null, draftId, fileForm("a.pdf", "x", "application/pdf"))).status).toBe(401);
    expect((await upload(users.owner, draftId, fileForm("a.pdf", "x", "application/pdf"), "no-such-requirement")).status).toBe(404);
    expect(await snapshot(draftId)).toEqual({ documents: [], files: [] });
  });
});

describe("downloading the file (#324)", { timeout: 30_000 }, () => {
  it("serves the bytes as an attachment with the stored type, the encoded name and nosniff, to whoever may see the System", async () => {
    const id = onboardedId;
    await reset(id);
    await upload(users.owner, id, fileForm("Årsrapport (v2) 'x'.pdf", "%PDF-bytes", "application/pdf"));

    for (const key of ["owner", "admin", "viewer", "bso", "complianceManager", "otherOwner"] as const) {
      const response = await download(users[key], id);
      expect(response.status, key).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-disposition")).toBe("attachment; filename*=UTF-8''%C3%85rsrapport%20%28v2%29%20%27x%27.pdf");
      expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("%PDF-bytes");
    }
  });

  it("is attachment even for a text file whose content looks like HTML", async () => {
    await upload(users.owner, onboardedId, fileForm("notes.txt", "<script>alert(1)</script>", "text/plain"));
    const response = await download(users.owner, onboardedId);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  it("is refused for someone who can't see the System (404), with nobody signed in (401), and 404 when there is no file", async () => {
    await upload(users.owner, draftId, fileForm("a.pdf", "x", "application/pdf"));
    expect((await download(users.viewer, draftId)).status).toBe(404);
    expect((await download(users.otherOwner, draftId)).status).toBe(404);
    expect((await download(null, draftId)).status).toBe(401);
    expect((await download(users.bso, draftId)).status).toBe(200);
    await remove(users.owner, draftId);
    expect((await download(users.owner, draftId)).status).toBe(404);
  });
});

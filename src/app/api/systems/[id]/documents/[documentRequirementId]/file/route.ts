import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authenticate } from "@/lib/api-authz";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { applicableRequirements, canEditSystemDocuments, listSystemDocuments } from "@/lib/system-documentation";
import { checkDocumentFile, DOCUMENT_FILE_TOO_LARGE, MAX_DOCUMENT_FILE_BYTES } from "@/lib/system-document-file";

type Ctx = RouteContext<"/api/systems/[id]/documents/[documentRequirementId]/file">;

const NOT_FOUND = { error: "Document Requirement not found" };
/** Room for the multipart envelope around a file at the cap, so an oversized body is refused before it is read. */
const ENVELOPE_ALLOWANCE = 64 * 1024;

/** The System if the user may see it (404 otherwise), and whether they may edit its documentation. */
async function resolveSystem(request: NextRequest, ctx: Ctx) {
  const auth = await authenticate(request);
  if ("response" in auth) return { response: auth.response };
  const { id, documentRequirementId } = await ctx.params;
  const system = await prisma.system.findFirst({ where: { AND: [{ id }, await visibleSystemsWhere(auth.user)] }, select: { id: true, ownerId: true } });
  if (!system) return { response: NextResponse.json({ error: "System not found" }, { status: 404 }) };
  return { user: auth.user, system, documentRequirementId, canEdit: canEditSystemDocuments(auth.user, system) };
}

const refuseWrite = () => NextResponse.json({ error: "Only a System's owner or an Admin can change its documentation" }, { status: 403 });

/**
 * Downloads the file a System uploaded for a Document Requirement (#324). Whoever may see the System may download;
 * 404 for a System they can't see or when there is no file. Always an attachment with the stored content type and
 * `nosniff`, never inline, so an uploaded HTML or SVG file can't run on this origin.
 */
export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const resolved = await resolveSystem(request, ctx);
  if (resolved.response) return resolved.response;

  const file = await prisma.systemDocumentFile.findFirst({
    where: { systemDocument: { systemId: resolved.system.id, documentRequirementId: resolved.documentRequirementId } },
    select: { fileName: true, contentType: true, size: true, data: true },
  });
  if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 404 });

  const encodedName = encodeURIComponent(file.fileName).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Uploads (or replaces) the one file for a Document Requirement on a System (#324). `multipart/form-data` with the
 * field `file`. The System's owner or an Admin, at any Onboarding Status; 404 for a System the user can't see, 403
 * for one they can see but don't own (nothing changes, and checked before the body is read). 413 over the size cap,
 * 415 for a type that isn't accepted, 400 for a missing or empty file. Uploading doesn't change `provided`; it makes
 * marking it provided possible. Returns `{ document }` as `GET /api/systems/[id]/documents` lists it.
 */
export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const resolved = await resolveSystem(request, ctx);
  if (resolved.response) return resolved.response;
  if (!resolved.canEdit) return refuseWrite();

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DOCUMENT_FILE_BYTES + ENVELOPE_ALLOWANCE) {
    return NextResponse.json({ error: DOCUMENT_FILE_TOO_LARGE }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const entry = form?.get("file");
  // A file entry, not a string (checked by shape: `File` differs between runtimes).
  if (!entry || typeof entry === "string" || typeof entry.arrayBuffer !== "function") return NextResponse.json({ error: "Send the file as multipart/form-data in the field \"file\"." }, { status: 400 });
  const file = entry;
  const checked = checkDocumentFile(file);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: checked.status });
  const data = Buffer.from(await file.arrayBuffer());
  if (data.length > MAX_DOCUMENT_FILE_BYTES) return NextResponse.json({ error: DOCUMENT_FILE_TOO_LARGE }, { status: 413 });

  const { system, user, documentRequirementId } = resolved;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const requirement = await tx.documentRequirement.findUnique({ where: { id: documentRequirementId }, select: { id: true, tracks: true } });
      if (!requirement || applicableRequirements([requirement]).length === 0) return null;
      // The upsert writes, so it takes the row lock before the file changes (see the DELETE and PUT).
      const document = await tx.systemDocument.upsert({
        where: { systemId_documentRequirementId: { systemId: system.id, documentRequirementId: requirement.id } },
        create: { systemId: system.id, documentRequirementId: requirement.id, provided: false, updatedById: user.id },
        update: { updatedById: user.id },
        select: { id: true },
      });
      const stored = { fileName: file.name, contentType: checked.contentType, size: data.length, data, uploadedAt: new Date(), uploadedById: user.id };
      await tx.systemDocumentFile.upsert({ where: { systemDocumentId: document.id }, create: { systemDocumentId: document.id, ...stored }, update: stored });
      return (await listSystemDocuments(tx, system.id)).find((item) => item.id === requirement.id) ?? null;
      // A 4 MB write over a remote connection can outlast Prisma's default 5 s interactive-transaction timeout.
    }, { timeout: 20_000 });
    if (!row) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ document: row });
  } catch (error) {
    // The catalogue entry was deleted between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return NextResponse.json(NOT_FOUND, { status: 404 });
    throw error;
  }
}

/**
 * Removes the file. The System's owner or an Admin (403 otherwise, nothing changes); 404 when there is no file. If
 * that leaves neither a file nor a link, `provided` goes back to false in the same transaction. Returns `{ document }`.
 */
export async function DELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const resolved = await resolveSystem(request, ctx);
  if (resolved.response) return resolved.response;
  if (!resolved.canEdit) return refuseWrite();

  const { system, user, documentRequirementId } = resolved;
  const row = await prisma.$transaction(async (tx) => {
    const where = { systemId_documentRequirementId: { systemId: system.id, documentRequirementId } };
    // Lock the row first (a real write), then read the link and file under the lock, so a concurrent PUT marking it
    // provided can't leave `provided` set with neither.
    try {
      await tx.systemDocument.update({ where, data: { updatedById: user.id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
      throw error;
    }
    const document = await tx.systemDocument.findUnique({ where, select: { id: true, link: true, file: { select: { id: true } } } });
    if (!document?.file) return null;
    await tx.systemDocumentFile.delete({ where: { id: document.file.id } });
    if (document.link === null) await tx.systemDocument.update({ where: { id: document.id }, data: { provided: false } });
    return (await listSystemDocuments(tx, system.id)).find((item) => item.id === documentRequirementId) ?? null;
  });
  if (!row) return NextResponse.json({ error: "No file uploaded" }, { status: 404 });
  return NextResponse.json({ document: row });
}

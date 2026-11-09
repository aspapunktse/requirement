import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { authenticate } from "@/lib/api-authz";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { applicableRequirements, canEditSystemDocuments, listSystemDocuments, PROVIDED_NEEDS_EVIDENCE, systemDocumentBodySchema } from "@/lib/system-documentation";

/** Thrown inside the transaction so the lock-taking upsert is rolled back with it. */
class NeedsEvidence extends Error {}

const NOT_FOUND = { error: "Document Requirement not found" };

/**
 * Sets a System's link and "provided" mark for one Document Requirement (#324, PRD 0002 F-DOC.2). Body
 * `{ link: string | null, provided: boolean }`; the link is an http(s) URL (trimmed, at most 2000 characters, empty
 * is none) and marking provided needs a link or an uploaded file (400). Allowed for the System's owner or an Admin at any Onboarding
 * Status. A System the user can't see is 404; one they can see but don't own is 403 and nothing changes (checked
 * before the body is read). 404 too for a Document Requirement that doesn't exist or doesn't apply to the System.
 * One upsert, recording who and when; no Change Event. Returns the row as `GET /api/systems/[id]/documents` lists it.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/documents/[documentRequirementId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id, documentRequirementId } = await ctx.params;

  const system = await prisma.system.findFirst({ where: { AND: [{ id }, await visibleSystemsWhere(auth.user)] }, select: { id: true, ownerId: true } });
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (!canEditSystemDocuments(auth.user, system)) {
    return NextResponse.json({ error: "Only a System's owner or an Admin can change its documentation" }, { status: 403 });
  }

  const parsed = systemDocumentBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body: expected { link, provided }" }, { status: 400 });
  }

  try {
    const row = await prisma.$transaction(async (tx) => {
      const requirement = await tx.documentRequirement.findUnique({ where: { id: documentRequirementId }, select: { id: true, tracks: true } });
      if (!requirement || applicableRequirements([requirement]).length === 0) return null;
      // Take the row's lock first (an upsert that really writes), then check the evidence under it: a file removal
      // running at the same time waits for this transaction and sees its result, or this one sees the removal.
      const where = { systemId_documentRequirementId: { systemId: system.id, documentRequirementId: requirement.id } };
      await tx.systemDocument.upsert({
        where,
        create: { systemId: system.id, documentRequirementId: requirement.id, updatedById: auth.user.id },
        update: { updatedById: auth.user.id },
      });
      if (parsed.data.provided && parsed.data.link === null) {
        const files = await tx.systemDocumentFile.count({ where: { systemDocument: { systemId: system.id, documentRequirementId: requirement.id } } });
        if (files === 0) throw new NeedsEvidence();
      }
      await tx.systemDocument.update({ where, data: { link: parsed.data.link, provided: parsed.data.provided, updatedById: auth.user.id } });
      return (await listSystemDocuments(tx, system.id)).find((document) => document.id === requirement.id) ?? null;
    });
    if (!row) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ document: row });
  } catch (error) {
    if (error instanceof NeedsEvidence) return NextResponse.json({ error: PROVIDED_NEEDS_EVIDENCE }, { status: 400 });
    // The catalogue entry was deleted between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return NextResponse.json(NOT_FOUND, { status: 404 });
    throw error;
  }
}

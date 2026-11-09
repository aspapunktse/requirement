import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import {
  FIRST_DOCUMENTATION_IS_FULL,
  ROLES_ALLOWED_TO_CURATE_DOCUMENT_REQUIREMENTS,
  stageAllowsTracks,
  updateDocumentRequirementSchema,
} from "@/lib/document-requirement";
import { DOCUMENT_REQUIREMENT_SELECT, toRow } from "@/lib/document-requirement-data";

const NOT_FOUND = { error: "Document Requirement not found." };

export async function GET(request: NextRequest, ctx: RouteContext<"/api/document-requirements/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const row = await prisma.documentRequirement.findUnique({ where: { id }, select: DOCUMENT_REQUIREMENT_SELECT });
  if (!row) return NextResponse.json(NOT_FOUND, { status: 404 });
  return NextResponse.json({ documentRequirement: toRow(row) });
}

/**
 * Rename, describe, or change the stage or Tracks. The stage/Tracks pairing (first documentation never includes Self)
 * is checked on the result of the edit, against the stored value of whichever of the two the edit leaves out; the
 * row is locked for the read and the write so a concurrent edit can't slip a refused pairing past the check.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/document-requirements/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_DOCUMENT_REQUIREMENTS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateDocumentRequirementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "DocumentRequirement" WHERE "id" = ${id} FOR UPDATE`;
      if (locked.length === 0) return { status: "missing" as const };
      const stored = await tx.documentRequirement.findUniqueOrThrow({ where: { id }, select: { stage: true, tracks: true } });
      const stage = parsed.data.stage ?? stored.stage;
      const tracks = parsed.data.tracks ?? stored.tracks;
      if (!stageAllowsTracks(stage, tracks)) return { status: "refused" as const };
      const updated = await tx.documentRequirement.update({ where: { id }, data: parsed.data, select: DOCUMENT_REQUIREMENT_SELECT });
      return { status: "updated" as const, updated };
    });
    if (outcome.status === "missing") return NextResponse.json(NOT_FOUND, { status: 404 });
    if (outcome.status === "refused") return NextResponse.json({ error: FIRST_DOCUMENTATION_IS_FULL }, { status: 400 });
    return NextResponse.json({ documentRequirement: toRow(outcome.updated) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Document Requirement with that name already exists." }, { status: 409 });
    }
    throw error;
  }
}

/** A hard delete: what Systems provided against it (SystemDocument, #324) goes with it. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/document-requirements/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_DOCUMENT_REQUIREMENTS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    await prisma.documentRequirement.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return NextResponse.json(NOT_FOUND, { status: 404 });
    throw error;
  }
  return new NextResponse(null, { status: 204 });
}

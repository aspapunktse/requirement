import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { duplicateNameMessage, NOT_FOUND_MESSAGE, ROLES_ALLOWED_TO_CURATE_BOUNDARIES, updateBoundarySchema } from "@/lib/compliance-boundary";
import { checkFrameworks, findBoundaryNamed, getBoundary } from "@/lib/compliance-boundary-data";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const boundary = await prisma.$transaction((tx) => getBoundary(id, tx), READ_SNAPSHOT);
  if (!boundary) return NextResponse.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  return NextResponse.json({ boundary });
}

/**
 * Edit the Boundary's name, description, Business Unit, Frameworks (the whole new list, at least one, Published ones only
 * when newly added) or Boundary Owner. A Compliance Manager or an Admin. Curation: no Change Event.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_BOUNDARIES);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateBoundarySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const { name, description, businessUnitId, boundaryOwnerId, frameworkIds } = parsed.data;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.complianceBoundary.findUnique({ where: { id }, select: { id: true, frameworks: { select: { frameworkId: true } } } });
      if (!existing) return { error: NOT_FOUND_MESSAGE, status: 404 };
      if (name !== undefined) {
        const clash = await findBoundaryNamed(tx, name, id);
        if (clash) return { error: duplicateNameMessage(clash.name), status: 409 };
      }
      if (frameworkIds) {
        const held = new Set(existing.frameworks.map((row) => row.frameworkId));
        // A Framework the Boundary already holds stays; only a newly added one must exist and be Published.
        const { missing, unpublished } = await checkFrameworks(tx, frameworkIds.filter((frameworkId) => !held.has(frameworkId)));
        if (missing.length > 0) return { error: "Some of those Frameworks no longer exist. Reload and pick again.", status: 400 };
        if (unpublished.length > 0) return { error: "Only a Published Framework can be added to a Compliance Boundary.", status: 409 };
      }
      if (businessUnitId && !(await tx.businessUnit.findUnique({ where: { id: businessUnitId }, select: { id: true } }))) {
        return { error: "That Business Unit no longer exists. Reload and pick again.", status: 400 };
      }
      if (boundaryOwnerId && !(await tx.user.findUnique({ where: { id: boundaryOwnerId }, select: { id: true } }))) {
        return { error: "That User no longer exists. Reload and pick again.", status: 400 };
      }
      await tx.complianceBoundary.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(businessUnitId !== undefined && { businessUnitId }),
          ...(boundaryOwnerId !== undefined && { boundaryOwnerId }),
        },
      });
      if (frameworkIds) {
        await tx.complianceBoundaryFramework.deleteMany({ where: { boundaryId: id, frameworkId: { notIn: frameworkIds } } });
        await tx.complianceBoundaryFramework.createMany({
          data: frameworkIds.map((frameworkId) => ({ boundaryId: id, frameworkId, addedById: auth.user.id })),
          skipDuplicates: true,
        });
      }
      return { boundary: await getBoundary(id, tx) };
    });
    if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ boundary: outcome.boundary });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && name !== undefined) {
      return NextResponse.json({ error: duplicateNameMessage(name) }, { status: 409 });
    }
    // The Boundary, a Framework, the Business Unit or the User deleted between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2025")) {
      return NextResponse.json({ error: "The Compliance Boundary or something it refers to changed. Reload and try again." }, { status: 409 });
    }
    throw error;
  }
}

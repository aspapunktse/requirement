import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { createBoundarySchema, duplicateNameMessage, ROLES_ALLOWED_TO_CURATE_BOUNDARIES } from "@/lib/compliance-boundary";
import { checkFrameworks, findBoundaryNamed, getBoundary, listBoundaries } from "@/lib/compliance-boundary-data";

/**
 * Compliance Boundaries (#418). Every signed-in role reads the list; a Compliance Manager or an Admin creates a Boundary.
 * Curation, not compliance evidence: no Change Event. A Boundary's Frameworks don't change applicability yet (#419).
 */

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const boundaries = await prisma.$transaction((tx) => listBoundaries(tx), READ_SNAPSHOT);
  return NextResponse.json({ boundaries });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_BOUNDARIES);
  if ("response" in auth) return auth.response;

  const parsed = createBoundarySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const { name, description, businessUnitId, boundaryOwnerId, frameworkIds } = parsed.data;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const clash = await findBoundaryNamed(tx, name);
      if (clash) return { error: duplicateNameMessage(clash.name), status: 409 };
      const { missing, unpublished } = await checkFrameworks(tx, frameworkIds);
      if (missing.length > 0) return { error: "Some of those Frameworks no longer exist. Reload and pick again.", status: 400 };
      if (unpublished.length > 0) return { error: "Only a Published Framework can be added to a Compliance Boundary.", status: 409 };
      if (businessUnitId && !(await tx.businessUnit.findUnique({ where: { id: businessUnitId }, select: { id: true } }))) {
        return { error: "That Business Unit no longer exists. Reload and pick again.", status: 400 };
      }
      if (boundaryOwnerId && !(await tx.user.findUnique({ where: { id: boundaryOwnerId }, select: { id: true } }))) {
        return { error: "That User no longer exists. Reload and pick again.", status: 400 };
      }
      const created = await tx.complianceBoundary.create({
        data: {
          name,
          description,
          businessUnitId,
          boundaryOwnerId,
          frameworks: { create: frameworkIds.map((frameworkId) => ({ frameworkId, addedById: auth.user.id })) },
        },
        select: { id: true },
      });
      return { boundary: await getBoundary(created.id, tx) };
    });
    if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ boundary: outcome.boundary }, { status: 201 });
  } catch (error) {
    // Two creates of the same name racing: the unique index refuses the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: duplicateNameMessage(name) }, { status: 409 });
    }
    // A Framework, Business Unit or User deleted between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ error: "A Framework, Business Unit or User changed. Reload and try again." }, { status: 409 });
    }
    throw error;
  }
}

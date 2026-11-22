import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { logChangeEvent } from "@/lib/change-events";
import { canManageBoundaryMembers, MEMBERS_FORBIDDEN_MESSAGE, NOT_FOUND_MESSAGE } from "@/lib/compliance-boundary";
import { getBoundary } from "@/lib/compliance-boundary-data";

/**
 * Remove a System from a Compliance Boundary (#418). The Boundary's own Boundary Owner, a Compliance Manager or an Admin; the
 * System's owner can't leave. A closed System can be removed (it only ever stays listed): the clean-up is allowed. One Change
 * Event on the System, in the same transaction.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]/systems/[systemId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, systemId } = await ctx.params;
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const boundary = await tx.complianceBoundary.findUnique({ where: { id }, select: { id: true, name: true, boundaryOwnerId: true } });
      if (!boundary) return { error: NOT_FOUND_MESSAGE, status: 404 };
      if (!canManageBoundaryMembers(auth.user, boundary)) return { error: MEMBERS_FORBIDDEN_MESSAGE, status: 403 };
      const membership = await tx.complianceBoundarySystem.findUnique({ where: { boundaryId_systemId: { boundaryId: id, systemId } }, select: { id: true } });
      if (!membership) return { error: "That System is not in this Compliance Boundary.", status: 404 };
      await tx.complianceBoundarySystem.delete({ where: { id: membership.id } });
      await logChangeEvent(systemId, "BOUNDARY_MEMBERSHIP_CHANGED", `Removed from Compliance Boundary "${boundary.name}"`, auth.user.id, tx);
      return { boundary: await getBoundary(id, tx) };
    });
    if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ boundary: outcome.boundary });
  } catch (error) {
    // The membership removed by someone else between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2025" || error.code === "P2003")) {
      return NextResponse.json({ error: "The Compliance Boundary changed. Reload and try again." }, { status: 409 });
    }
    throw error;
  }
}

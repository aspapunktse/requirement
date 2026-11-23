import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { closedRefusalText } from "@/lib/system-closed";
import { logChangeEvent } from "@/lib/change-events";
import {
  addMemberSchema,
  ALREADY_MEMBER_REFUSAL,
  canManageBoundaryMembers,
  MEMBERS_FORBIDDEN_MESSAGE,
  NOT_FOUND_MESSAGE,
} from "@/lib/compliance-boundary";
import { getBoundary } from "@/lib/compliance-boundary-data";

/**
 * Add a System to a Compliance Boundary (#418). The Boundary's own Boundary Owner, a Compliance Manager or an Admin: the role
 * is not enough, the object-level check is part of it. A closed System (Rejected, Not selected) is refused (409); a System still
 * in evaluation can join. One Change Event on the System, written in the same transaction, names the Boundary.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]/systems">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = addMemberSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const { systemId } = parsed.data;

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const boundary = await tx.complianceBoundary.findUnique({ where: { id }, select: { id: true, name: true, boundaryOwnerId: true } });
      if (!boundary) return { error: NOT_FOUND_MESSAGE, status: 404 };
      if (!canManageBoundaryMembers(auth.user, boundary)) return { error: MEMBERS_FORBIDDEN_MESSAGE, status: 403 };
      const system = await tx.system.findUnique({ where: { id: systemId }, select: { id: true, name: true, status: true, evaluationClosedAt: true } });
      if (!system) return { error: "System not found.", status: 404 };
      if (system.evaluationClosedAt) return { error: closedRefusalText(system.status), status: 409 };
      const already = await tx.complianceBoundarySystem.findUnique({ where: { boundaryId_systemId: { boundaryId: id, systemId } }, select: { id: true } });
      if (already) return { error: ALREADY_MEMBER_REFUSAL, status: 409 };
      await tx.complianceBoundarySystem.create({ data: { boundaryId: id, systemId, addedById: auth.user.id } });
      await logChangeEvent(systemId, "BOUNDARY_MEMBERSHIP_CHANGED", `Added to Compliance Boundary "${boundary.name}"`, auth.user.id, tx);
      return { boundary: await getBoundary(id, tx) };
    });
    if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ boundary: outcome.boundary }, { status: 201 });
  } catch (error) {
    // Two adds racing: the unique row refuses the second. Or the System or Boundary deleted between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: ALREADY_MEMBER_REFUSAL }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2025")) {
      return NextResponse.json({ error: "The Compliance Boundary or the System changed. Reload and try again." }, { status: 409 });
    }
    throw error;
  }
}

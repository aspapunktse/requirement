import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { BOUNDARY_FAN_OUT_TRANSACTION, lockBoundary, retireBoundaryIn } from "@/lib/compliance-boundary-scope";
import { recordProviderChanges } from "@/lib/framework-scope";
import { reconcileReviewSteps } from "@/lib/review-steps";
import { ALREADY_RETIRED_REFUSAL, canManageBoundaryMembers, NOT_FOUND_MESSAGE, RETIRE_FORBIDDEN_MESSAGE, retireBoundarySchema } from "@/lib/compliance-boundary";
import { getBoundary } from "@/lib/compliance-boundary-data";

/**
 * Retire a Compliance Boundary (#424): its purpose ended, for example a contract. The Boundary's own Boundary Owner, a Compliance
 * Manager or an Admin, with a required comment. Final: there is no un-retire. The Boundary then brings no Framework into any
 * member's scope, so applicability is recomputed on each member System with a Change Event on each (a scope change, #419), all in
 * this one transaction. The Boundary stays as a read-only record. 404 if it doesn't exist, 403 for anyone else, 409 if it is
 * already retired.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]/retire">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = retireBoundarySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const { comment } = parsed.data;

  try {
    // A member System that is a Provider moves its dependents when its scope changes (#124). This pre-read only picks the
    // Providers to wrap (`recordProviderChanges`); the fan-out reads its own member list after the Boundary lock.
    const memberIds = (await prisma.complianceBoundarySystem.findMany({ where: { boundaryId: id }, select: { systemId: true } })).map((row) => row.systemId);
    let reconcile: string[] = [];
    const outcome = await recordProviderChanges(memberIds, () => prisma.$transaction(async (tx) => {
      await lockBoundary(tx, id); // first, before any System lock
      const boundary = await tx.complianceBoundary.findUnique({ where: { id }, select: { id: true, name: true, boundaryOwnerId: true, retiredAt: true } });
      if (!boundary) return { error: NOT_FOUND_MESSAGE, status: 404 };
      if (!canManageBoundaryMembers(auth.user, boundary)) return { error: RETIRE_FORBIDDEN_MESSAGE, status: 403 };
      if (boundary.retiredAt) return { error: ALREADY_RETIRED_REFUSAL, status: 409 };
      reconcile = await retireBoundaryIn(tx, boundary, comment, auth.user.id);
      return { boundary: await getBoundary(id, tx) };
    }, BOUNDARY_FAN_OUT_TRANSACTION));
    for (const systemId of reconcile) await reconcileReviewSteps(systemId);
    if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ boundary: outcome.boundary });
  } catch (error) {
    // The Boundary or a member System deleted between the check and the write.
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2025")) {
      return NextResponse.json({ error: "The Compliance Boundary changed. Reload and try again." }, { status: 409 });
    }
    throw error;
  }
}

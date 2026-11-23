import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { READ_SNAPSHOT } from "@/lib/read-transaction";
import { duplicateNameMessage, NOT_FOUND_MESSAGE, RETIRED_REFUSAL, ROLES_ALLOWED_TO_CURATE_BOUNDARIES, updateBoundarySchema } from "@/lib/compliance-boundary";
import { BOUNDARY_FAN_OUT_TRANSACTION, lockBoundary, setBoundaryFrameworksIn } from "@/lib/compliance-boundary-scope";
import { recordProviderChanges } from "@/lib/framework-scope";
import { reconcileReviewSteps } from "@/lib/review-steps";
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
 * when newly added) or Boundary Owner. A Compliance Manager or an Admin. Curation: no Change Event of its own. Adding or dropping a
 * Framework is a scope change on every member System (#419): applicability is recomputed on each, with one Change Event per System whose
 * applicable Controls changed and a Change Review on a System with an ATO or Onboarded that gains Controls, all in this transaction. A retired
 * Boundary can't be edited (409, #424).
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_BOUNDARIES);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateBoundarySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map((issue) => issue.message).join(" ") }, { status: 400 });
  const { name, description, businessUnitId, boundaryOwnerId, frameworkIds } = parsed.data;

  try {
    // A member System that is a Provider moves its dependents when its scope changes (#124). This pre-read is outside the transaction
    // on purpose (`recordProviderChanges` wraps it); it only picks the Providers to wrap. The fan-out reads its own member list after
    // the Boundary lock below, so a System that joins meanwhile is still recomputed (a Provider that joins in that window is the
    // same non-atomic #124 gap).
    const memberIds = frameworkIds ? (await prisma.complianceBoundarySystem.findMany({ where: { boundaryId: id }, select: { systemId: true } })).map((row) => row.systemId) : [];
    let reconcile: string[] = [];
    const outcome = await recordProviderChanges(memberIds, () => prisma.$transaction(async (tx) => {
      await lockBoundary(tx, id); // first, before any System lock; also keeps a retire from racing an edit
      const existing = await tx.complianceBoundary.findUnique({ where: { id }, select: { id: true, retiredAt: true, frameworks: { select: { frameworkId: true } } } });
      if (!existing) return { error: NOT_FOUND_MESSAGE, status: 404 };
      if (existing.retiredAt) return { error: RETIRED_REFUSAL, status: 409 }; // a retired Boundary is a read-only record (#424)
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
        const boundary = await tx.complianceBoundary.findUniqueOrThrow({ where: { id }, select: { id: true, name: true } });
        reconcile = await setBoundaryFrameworksIn(tx, boundary, frameworkIds, auth.user.id);
      }
      return { boundary: await getBoundary(id, tx) };
    }, BOUNDARY_FAN_OUT_TRANSACTION));
    for (const systemId of reconcile) await reconcileReviewSteps(systemId);
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

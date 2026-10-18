import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { BASE_FRAMEWORK_TIE_ERROR } from "@/lib/review-groups";

const tieSchema = z.object({ reviewGroupId: z.string().min(1) });

const reviewGroupSelect = { select: { id: true, name: true } } as const;

/**
 * Ties the Framework to a Review Group. A Framework has at most one: tying a different group while it has one is
 * refused (409; untie it first), tying the same group again changes nothing. The base Framework can't be tied (400).
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/review-group">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = tieSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A reviewGroupId is required" }, { status: 400 });
  }
  const { reviewGroupId } = parsed.data;

  const framework = await prisma.framework.findUnique({ where: { id } });
  if (!framework) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }
  if (framework.isBase) {
    return NextResponse.json({ error: BASE_FRAMEWORK_TIE_ERROR }, { status: 400 });
  }
  if (!(await prisma.reviewGroup.findUnique({ where: { id: reviewGroupId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Review Group not found" }, { status: 400 });
  }

  // Conditional write, so two concurrent ties can't both win.
  const { count } = await prisma.framework.updateMany({
    where: { id, isBase: false, OR: [{ reviewGroupId: null }, { reviewGroupId }] },
    data: { reviewGroupId },
  });
  if (count === 0) {
    return NextResponse.json(
      { error: "This Framework is already tied to a Review Group; untie it before tying another" },
      { status: 409 },
    );
  }

  const updated = await prisma.framework.findUniqueOrThrow({ where: { id }, include: { reviewGroup: reviewGroupSelect } });
  return NextResponse.json({ framework: updated });
}

/** Unties the Framework. Never blocked; untying a Framework that has no Review Group changes nothing. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/review-group">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  if (!(await prisma.framework.findUnique({ where: { id }, select: { id: true } }))) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }

  await prisma.framework.update({ where: { id }, data: { reviewGroupId: null } });
  const updated = await prisma.framework.findUniqueOrThrow({ where: { id }, include: { reviewGroup: reviewGroupSelect } });
  return NextResponse.json({ framework: updated });
}

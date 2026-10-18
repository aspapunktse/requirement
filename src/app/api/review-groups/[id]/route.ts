import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { loadReviewGroup, reviewGroupDescriptionSchema, reviewGroupNameSchema } from "@/lib/review-groups";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/review-groups/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const reviewGroup = await loadReviewGroup(id);
  if (!reviewGroup) {
    return NextResponse.json({ error: "Review Group not found" }, { status: 404 });
  }
  return NextResponse.json({ reviewGroup });
}

const updateReviewGroupSchema = z
  .object({
    name: reviewGroupNameSchema.optional(),
    description: reviewGroupDescriptionSchema.nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "Provide at least one of name or description to update",
  });

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/review-groups/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateReviewGroupSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  try {
    await prisma.reviewGroup.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ reviewGroup: await loadReviewGroup(id) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Review Group not found" }, { status: 404 });
      }
      if (error.code === "P2002") {
        return NextResponse.json({ error: "A Review Group with that name already exists" }, { status: 409 });
      }
    }
    throw error;
  }
}

const TIED_ERROR = "This Review Group is tied to one or more Frameworks; untie it from them before deleting it";

const DECIDED_ERROR = "This Review Group has recorded Review Step decisions, which are kept as history; it can't be deleted";

/**
 * Refused (409) while the group is tied to any Framework, or once it has decided a Review Step
 * (an Approval's Restrict foreign key; no step is decided by a group before #199). Its members just go with it.
 */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/review-groups/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const existing = await prisma.reviewGroup.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Review Group not found" }, { status: 404 });
  }
  if ((await prisma.framework.count({ where: { reviewGroupId: id } })) > 0) {
    return NextResponse.json({ error: TIED_ERROR }, { status: 409 });
  }
  if ((await prisma.approval.count({ where: { reviewGroupId: id } })) > 0) {
    return NextResponse.json({ error: DECIDED_ERROR }, { status: 409 });
  }

  try {
    await prisma.reviewGroup.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // A Restrict foreign key: a Framework was tied between the check and the delete.
      if (error.code === "P2003") return NextResponse.json({ error: TIED_ERROR }, { status: 409 });
      if (error.code === "P2025") return NextResponse.json({ error: "Review Group not found" }, { status: 404 });
    }
    throw error;
  }
}

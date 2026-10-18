import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";
import { loadReviewGroup } from "@/lib/review-groups";

/** Removes a member. Never blocked, not even for the last member (a tied group with no members keeps its Review Step). */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/review-groups/[id]/members/[userId]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id, userId } = await ctx.params;
  const group = await prisma.reviewGroup.findUnique({ where: { id }, select: { id: true } });
  if (!group) {
    return NextResponse.json({ error: "Review Group not found" }, { status: 404 });
  }

  await prisma.reviewGroup.update({ where: { id }, data: { members: { disconnect: { id: userId } } } });
  return NextResponse.json({ reviewGroup: await loadReviewGroup(id) });
}

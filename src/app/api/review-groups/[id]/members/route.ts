import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";
import { INTERNAL_AUDITOR_MEMBER_ERROR, loadReviewGroup } from "@/lib/review-groups";

const addMemberSchema = z.object({ userId: z.string().min(1) });

/** Adds a User to the group (adding an existing member changes nothing). Any role may be a member except Internal Auditor. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/review-groups/[id]/members">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const group = await prisma.reviewGroup.findUnique({ where: { id }, select: { id: true } });
  if (!group) {
    return NextResponse.json({ error: "Review Group not found" }, { status: 404 });
  }

  const parsed = addMemberSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A userId is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 400 });
  }
  if (user.role === "INTERNAL_AUDITOR") {
    return NextResponse.json({ error: INTERNAL_AUDITOR_MEMBER_ERROR }, { status: 400 });
  }

  await prisma.reviewGroup.update({ where: { id }, data: { members: { connect: { id: user.id } } } });
  return NextResponse.json({ reviewGroup: await loadReviewGroup(id) }, { status: 201 });
}

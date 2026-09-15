import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/users/[id]/framework-scopes/[frameworkId]">,
) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id, frameworkId } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { frameworkScopes: { disconnect: { id: frameworkId } } },
  });

  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { frameworkScopes: true } });
  return NextResponse.json({ frameworks: updated.frameworkScopes });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageFrameworkScopes, getSystemFrameworkScopes } from "@/lib/framework-scope";

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/framework-scopes/[frameworkId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, frameworkId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageFrameworkScopes(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can remove Framework Scope from a System" },
      { status: 403 },
    );
  }

  await prisma.system.update({
    where: { id: system.id },
    data: { frameworkScopes: { disconnect: { id: frameworkId } } },
  });

  const frameworkScopes = await getSystemFrameworkScopes(system.id);
  return NextResponse.json({ frameworkScopes });
}

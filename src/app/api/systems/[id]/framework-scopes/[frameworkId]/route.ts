import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import {
  applyFrameworkScopeRemoved,
  canManageFrameworkScopes,
  getSystemFrameworkScopes,
} from "@/lib/framework-scope";

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
      { error: "Only the System's owner or an Admin can remove Framework Scope" },
      { status: 403 },
    );
  }

  const framework = await prisma.framework.findUnique({ where: { id: frameworkId } });
  // The base Framework is always in every System's Framework Scope (F-FW.3): whether or not a
  // row is stored for it, it can't be removed.
  if (framework?.isBase) {
    return NextResponse.json(
      { error: "The base Framework is always in a System's Framework Scope and can't be removed" },
      { status: 409 },
    );
  }

  await applyFrameworkScopeRemoved(system, { id: frameworkId, name: framework?.name ?? frameworkId }, auth.user.id);

  const frameworkScopes = await getSystemFrameworkScopes(system.id);
  return NextResponse.json({ frameworkScopes });
}

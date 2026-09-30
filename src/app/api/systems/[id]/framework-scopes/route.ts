import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageFrameworkScopes, getSystemFrameworkScopes } from "@/lib/framework-scope";
import { logChangeEvent } from "@/lib/change-events";
import { canSeeDraftFrameworks } from "@/lib/frameworks";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/framework-scopes">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const frameworkScopes = await getSystemFrameworkScopes(system.id);
  return NextResponse.json({ frameworkScopes });
}

const declareFrameworkScopeSchema = z.object({ frameworkId: z.string().min(1) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/framework-scopes">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageFrameworkScopes(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can declare Framework Scope on a System" },
      { status: 403 },
    );
  }

  const parsed = declareFrameworkScopeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A frameworkId is required" }, { status: 400 });
  }

  const framework = await prisma.framework.findUnique({ where: { id: parsed.data.frameworkId } });
  // A Draft Framework doesn't exist as far as a user who can't see Drafts is concerned.
  if (!framework || (framework.status === "DRAFT" && !canSeeDraftFrameworks(auth.user))) {
    return NextResponse.json({ error: "Framework not found" }, { status: 400 });
  }
  // Draft Frameworks are invisible to Systems: they can't be put in scope until Published (#73).
  // (Scope rows that predate Draft/Published, e.g. from the #72 migration, are left alone.)
  if (framework.status === "DRAFT") {
    return NextResponse.json(
      { error: "A Draft Framework can't be added to a System's Framework Scope; publish it first" },
      { status: 400 },
    );
  }

  await prisma.system.update({
    where: { id: system.id },
    data: { frameworkScopes: { connect: { id: framework.id } } },
  });
  await logChangeEvent(
    system.id,
    "CLASSIFICATION_CHANGED",
    `Framework Scope "${framework.name}" added`,
    auth.user.id,
  );

  const frameworkScopes = await getSystemFrameworkScopes(system.id);
  return NextResponse.json({ frameworkScopes }, { status: 201 });
}

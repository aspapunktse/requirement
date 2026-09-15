import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";

/**
 * A BUSINESS_RISK_OWNER's assigned Framework portfolio. Admin-managed,
 * independent of their Business Unit assignment — see #55.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/users/[id]/framework-scopes">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id }, include: { frameworkScopes: true } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ frameworks: user.frameworkScopes });
}

const assignSchema = z.object({ frameworkId: z.string().min(1) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/users/[id]/framework-scopes">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (user.role !== "BUSINESS_RISK_OWNER") {
    return NextResponse.json(
      { error: "Only a BUSINESS_RISK_OWNER can be assigned a Framework scope" },
      { status: 400 },
    );
  }

  const parsed = assignSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A frameworkId is required" }, { status: 400 });
  }

  const framework = await prisma.framework.findUnique({ where: { id: parsed.data.frameworkId } });
  if (!framework) {
    return NextResponse.json({ error: "Framework not found" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { frameworkScopes: { connect: { id: framework.id } } },
  });

  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { frameworkScopes: true } });
  return NextResponse.json({ frameworks: updated.frameworkScopes }, { status: 201 });
}

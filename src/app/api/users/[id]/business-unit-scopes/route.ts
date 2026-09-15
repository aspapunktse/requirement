import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";

/**
 * A BUSINESS_RISK_OWNER's assigned Business Unit portfolio. Admin-managed,
 * like every other catalog assignment in this app — see #55.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/users/[id]/business-unit-scopes">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id }, include: { businessUnitScopes: true } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ businessUnits: user.businessUnitScopes });
}

const assignSchema = z.object({ businessUnitId: z.string().min(1) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/users/[id]/business-unit-scopes">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (user.role !== "BUSINESS_RISK_OWNER") {
    return NextResponse.json(
      { error: "Only a BUSINESS_RISK_OWNER can be assigned a Business Unit scope" },
      { status: 400 },
    );
  }

  const parsed = assignSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A businessUnitId is required" }, { status: 400 });
  }

  const businessUnit = await prisma.businessUnit.findUnique({ where: { id: parsed.data.businessUnitId } });
  if (!businessUnit) {
    return NextResponse.json({ error: "Business Unit not found" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { businessUnitScopes: { connect: { id: businessUnit.id } } },
  });

  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { businessUnitScopes: true } });
  return NextResponse.json({ businessUnits: updated.businessUnitScopes }, { status: 201 });
}

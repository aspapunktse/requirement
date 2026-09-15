import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";

const updateBusinessUnitSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "Provide at least one of name or description to update",
  });

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/business-units/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateBusinessUnitSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  try {
    const businessUnit = await prisma.businessUnit.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ businessUnit });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Business Unit not found" }, { status: 404 });
      }
      if (error.code === "P2002") {
        return NextResponse.json({ error: "A Business Unit with that name already exists" }, { status: 409 });
      }
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/business-units/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;

  const systemsUsingIt = await prisma.system.count({ where: { businessUnits: { some: { id } } } });
  if (systemsUsingIt > 0) {
    return NextResponse.json(
      { error: "This Business Unit is assigned to one or more Systems and can't be retired" },
      { status: 409 },
    );
  }

  try {
    await prisma.businessUnit.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Business Unit not found" }, { status: 404 });
    }
    throw error;
  }
}

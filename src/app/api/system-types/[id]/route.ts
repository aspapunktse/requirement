import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";

const updateSystemTypeSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "Provide at least one of name or description to update",
  });

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/system-types/[id]">) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateSystemTypeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  try {
    const systemType = await prisma.systemType.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ systemType });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "System Type not found" }, { status: 404 });
      }
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A System Type with that name already exists" },
          { status: 409 },
        );
      }
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/system-types/[id]">) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;

  const systemsUsingIt = await prisma.system.count({ where: { systemTypeId: id } });
  if (systemsUsingIt > 0) {
    return NextResponse.json(
      { error: "This System Type is assigned to one or more Systems and can't be retired" },
      { status: 409 },
    );
  }

  try {
    await prisma.systemType.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "System Type not found" }, { status: 404 });
    }
    throw error;
  }
}

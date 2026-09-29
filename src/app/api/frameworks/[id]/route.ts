import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";

const updateFrameworkSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    strictComplianceRequired: z.boolean().optional(),
  })
  .refine(
    (data) => data.name !== undefined || data.description !== undefined || data.strictComplianceRequired !== undefined,
    { message: "Provide at least one field to update" },
  );

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateFrameworkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  try {
    const framework = await prisma.framework.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ framework });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Framework not found" }, { status: 404 });
      }
      if (error.code === "P2002") {
        return NextResponse.json({ error: "A Framework with that name already exists" }, { status: 409 });
      }
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;

  const [systemsUsingIt, controlsUsingIt] = await Promise.all([
    prisma.system.count({ where: { frameworkScopes: { some: { id } } } }),
    prisma.control.count({ where: { frameworks: { some: { id } } } }),
  ]);
  if (systemsUsingIt > 0 || controlsUsingIt > 0) {
    return NextResponse.json(
      { error: "This Framework is in use by one or more Systems or Controls and can't be retired" },
      { status: 409 },
    );
  }

  try {
    await prisma.framework.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Framework not found" }, { status: 404 });
    }
    throw error;
  }
}

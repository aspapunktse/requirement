import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_CATALOG } from "@/lib/catalog";

const updateRegulatoryOverlaySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "Provide at least one of name or description to update",
  });

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/regulatory-overlays/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateRegulatoryOverlaySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  try {
    const regulatoryOverlay = await prisma.regulatoryOverlay.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ regulatoryOverlay });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Regulatory Overlay not found" }, { status: 404 });
      }
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A Regulatory Overlay with that name already exists" },
          { status: 409 },
        );
      }
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/regulatory-overlays/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_CATALOG);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;

  const [systemsUsingIt, requirementsUsingIt] = await Promise.all([
    prisma.system.count({ where: { regulatoryOverlays: { some: { id } } } }),
    prisma.requirement.count({ where: { regulatoryOverlays: { some: { id } } } }),
  ]);
  if (systemsUsingIt > 0 || requirementsUsingIt > 0) {
    return NextResponse.json(
      {
        error:
          "This Regulatory Overlay is declared by one or more Systems, or mapped to one or more Requirements, and can't be retired",
      },
      { status: 409 },
    );
  }

  try {
    await prisma.regulatoryOverlay.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Regulatory Overlay not found" }, { status: 404 });
    }
    throw error;
  }
}

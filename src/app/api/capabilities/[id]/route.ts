import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";

const updateCapabilitySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: "Provide at least one of name or description to update",
  });

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/capabilities/[id]">) {
  const auth = await authorize(request, ["ADMIN"]);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateCapabilitySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  try {
    const capability = await prisma.capability.update({ where: { id }, data: parsed.data });
    return NextResponse.json({ capability });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Capability not found" }, { status: 404 });
      }
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A Capability with that name already exists" },
          { status: 409 },
        );
      }
    }
    throw error;
  }
}

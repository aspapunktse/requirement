import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate, authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import {
  BASE_FRAMEWORK_ERRORS,
  checkBaseFrameworkInvariant,
  visibleFrameworksWhere,
  wouldCreateSupersedesCycle,
} from "@/lib/frameworks";

const updateFrameworkSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    strictComplianceRequired: z.boolean().optional(),
    licensing: z.enum(["PARAPHRASE_ONLY", "QUOTABLE"]).optional(),
    supersedesId: z.string().min(1).nullable().optional(),
    isBase: z.boolean().optional(),
    // Publishing is POST /api/frameworks/[id]/publish; `status` is only accepted here so an attempt to
    // move a Published Framework back to Draft gets a clear refusal instead of being silently ignored.
    status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

/** A Framework with its Requirement count; a Draft is a 404 for anyone who can't see Drafts. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const framework = await prisma.framework.findFirst({
    where: { id, ...visibleFrameworksWhere(auth.user) },
    include: { _count: { select: { requirements: true } } },
  });
  if (!framework) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }
  return NextResponse.json({ framework });
}

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateFrameworkSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  const existing = await prisma.framework.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }

  const { status, ...changes } = parsed.data;
  if (status === "DRAFT" && existing.status === "PUBLISHED") {
    return NextResponse.json(
      {
        error: existing.isBase
          ? "The base Framework can't be moved back to Draft"
          : "A Published Framework can't be moved back to Draft",
      },
      { status: 409 },
    );
  }
  if (status === "PUBLISHED" && existing.status === "DRAFT") {
    return NextResponse.json({ error: "Publish a Framework with POST /api/frameworks/[id]/publish" }, { status: 400 });
  }

  if (parsed.data.isBase === true && !existing.isBase && existing.reviewGroupId) {
    return NextResponse.json(
      { error: "Untie this Framework from its Review Group before making it the base Framework" },
      { status: 409 },
    );
  }

  if (parsed.data.isBase !== undefined) {
    const violation = await checkBaseFrameworkInvariant(id, {
      wasBase: existing.isBase,
      isBase: parsed.data.isBase,
    });
    if (violation) {
      return NextResponse.json({ error: BASE_FRAMEWORK_ERRORS[violation] }, { status: 409 });
    }
  }

  if (parsed.data.supersedesId && (await wouldCreateSupersedesCycle(id, parsed.data.supersedesId))) {
    return NextResponse.json({ error: "A Framework can't supersede itself, directly or indirectly" }, { status: 400 });
  }

  try {
    const framework = await prisma.framework.update({ where: { id }, data: changes });
    return NextResponse.json({ framework });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Framework not found" }, { status: 404 });
      }
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "A Framework with that name and version already exists" },
          { status: 409 },
        );
      }
      if (error.code === "P2003") {
        return NextResponse.json({ error: "The superseded Framework does not exist" }, { status: 400 });
      }
    }
    throw error;
  }
}

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;

  const existing = await prisma.framework.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }
  if (existing.isBase) {
    return NextResponse.json({ error: BASE_FRAMEWORK_ERRORS.LAST_BASE }, { status: 409 });
  }

  const [systemsUsingIt, requirements, supplementaryControls] = await Promise.all([
    prisma.system.count({ where: { frameworkScopes: { some: { id } } } }),
    prisma.requirement.count({ where: { frameworkId: id } }),
    prisma.control.count({ where: { originFrameworkId: id } }),
  ]);
  if (systemsUsingIt > 0 || requirements > 0 || supplementaryControls > 0) {
    return NextResponse.json(
      {
        error:
          "This Framework is in use by Systems, or has Requirements or Supplementary Controls, and can't be retired",
      },
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

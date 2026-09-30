import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { logMappingChange, requirementInclude } from "@/lib/frameworks";
import { finishRecompute, prepareRecompute, scopeForMappedControls } from "@/lib/applicability-recompute";
import { frameworkLabel } from "@/lib/framework-label";

const updateRequirementSchema = z
  .object({
    code: z.string().trim().min(1).optional(),
    section: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).optional(),
    text: z.string().trim().min(1).optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/frameworks/[id]/requirements/[requirementId]">,
) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;
  const parsed = updateRequirementSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  // Scoped to the Framework in the URL, so a Requirement id from another Framework is a 404.
  const existing = await prisma.requirement.findFirst({ where: { id: requirementId, frameworkId: id } });
  if (!existing) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  try {
    const requirement = await prisma.requirement.update({
      where: { id: requirementId },
      data: parsed.data,
      include: requirementInclude,
    });
    return NextResponse.json({ requirement });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return NextResponse.json(
          { error: "This Framework already has a Requirement with that code" },
          { status: 409 },
        );
      }
      if (error.code === "P2025") {
        return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
      }
    }
    throw error;
  }
}

/**
 * Deletes a Requirement, Draft or Published Framework alike (the base
 * Framework's Requirements are editable). Its Control Mappings go with it
 * (cascade), so one CONTROL_MAPPING_CHANGED "removed" event is logged per
 * mapping it had, in the same transaction as the delete, naming the cascade
 * as the reason. On a Published Framework that is a mapping removal, so it takes
 * effect immediately like any other (F-CL.7, #87): every System with the Framework in
 * scope is recomputed for the Controls the Requirement was mapped to.
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/frameworks/[id]/requirements/[requirementId]">,
) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;

  const existing = await prisma.requirement.findFirst({
    where: { id: requirementId, frameworkId: id },
    include: {
      framework: { select: { id: true, name: true, version: true, isBase: true, status: true } },
      mappings: { select: { coverage: true, control: { select: { id: true, code: true } } } },
    },
  });
  if (!existing) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  // Snapshot before the write, so the recompute can tell what just stopped applying.
  const pending = await prepareRecompute(
    scopeForMappedControls(
      existing.framework,
      existing.mappings.map((m) => m.control.id),
    ),
    { snapshot: true },
  );

  try {
    await prisma.$transaction(async (tx) => {
      await tx.requirement.delete({ where: { id: requirementId } });
      for (const mapping of existing.mappings) {
        await logMappingChange(
          {
            change: "removed",
            framework: existing.framework,
            requirementCode: existing.code,
            controlCode: mapping.control.code,
            from: mapping.coverage,
            to: null,
            note: "Requirement deleted",
          },
          auth.user.id,
          tx,
        );
      }
    });
    await finishRecompute(pending, `Requirement deleted: ${frameworkLabel(existing.framework)} ${existing.code}`);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
    }
    throw error;
  }
}

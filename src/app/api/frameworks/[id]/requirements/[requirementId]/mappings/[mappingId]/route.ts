import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { logMappingChange } from "@/lib/frameworks";
import { finishRecompute, prepareRecompute, scopeForMappedControls } from "@/lib/applicability-recompute";
import { frameworkLabel } from "@/lib/framework-label";
import { clearGapAcceptance } from "@/lib/framework-coverage";

type MappingContext = RouteContext<"/api/frameworks/[id]/requirements/[requirementId]/mappings/[mappingId]">;

const updateMappingSchema = z
  .object({
    coverage: z.enum(["FULL", "PARTIAL"]).optional(),
    rationale: z.string().trim().min(1).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

/** The mapping, but only if it belongs to the Requirement and Framework in the URL. */
function findMapping(id: string, requirementId: string, mappingId: string) {
  return prisma.controlMapping.findFirst({
    where: { id: mappingId, requirementId, requirement: { frameworkId: id } },
    include: {
      control: { select: { id: true, code: true, title: true } },
      requirement: {
        select: { code: true, framework: { select: { id: true, name: true, version: true, isBase: true, status: true } } },
      },
    },
  });
}

/**
 * Changes a mapping's Coverage and/or rationale. Only a Coverage change is
 * logged (CONTROL_MAPPING_CHANGED, old -> new); a rationale-only edit is an
 * ordinary catalog edit and stays unlogged.
 */
export async function PATCH(request: NextRequest, ctx: MappingContext) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id, requirementId, mappingId } = await ctx.params;
  const parsed = updateMappingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  const existing = await findMapping(id, requirementId, mappingId);
  if (!existing) {
    return NextResponse.json({ error: "Control Mapping not found" }, { status: 404 });
  }

  try {
    const mapping = await prisma.$transaction(async (tx) => {
      const updated = await tx.controlMapping.update({
        where: { id: mappingId },
        data: parsed.data,
        select: { id: true, coverage: true, rationale: true, control: { select: { id: true, code: true, title: true } } },
      });
      if (updated.coverage !== existing.coverage) {
        await logMappingChange(
          {
            change: "changed",
            framework: existing.requirement.framework,
            requirementCode: existing.requirement.code,
            controlCode: existing.control.code,
            from: existing.coverage,
            to: updated.coverage,
          },
          auth.user.id,
          tx,
        );
      }
      // Upgrading to Full makes the Requirement covered, so a gap acceptance no longer applies (#74).
      if (updated.coverage === "FULL") await clearGapAcceptance(tx, requirementId);
      return updated;
    });
    return NextResponse.json({ mapping });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Control Mapping not found" }, { status: 404 });
    }
    throw error;
  }
}

/**
 * Removes a Control from a Requirement. Logs a CONTROL_MAPPING_CHANGED event (old Coverage -> none).
 * On a Published Framework the removal takes effect immediately (F-CL.7, #87): every System with
 * the Framework in scope is recomputed, so an untouched Assessment for a Control that no longer
 * applies is removed and a touched one is kept as stale. A Coverage-only PATCH above is not a
 * trigger: the applicability gate is "mapped at any Coverage".
 */
export async function DELETE(request: NextRequest, ctx: MappingContext) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id, requirementId, mappingId } = await ctx.params;

  const existing = await findMapping(id, requirementId, mappingId);
  if (!existing) {
    return NextResponse.json({ error: "Control Mapping not found" }, { status: 404 });
  }

  // Snapshot before the write, so the recompute can tell what just stopped applying.
  const pending = await prepareRecompute(scopeForMappedControls(existing.requirement.framework, [existing.control.id]), {
    snapshot: true,
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.controlMapping.delete({ where: { id: mappingId } });
      await logMappingChange(
        {
          change: "removed",
          framework: existing.requirement.framework,
          requirementCode: existing.requirement.code,
          controlCode: existing.control.code,
          from: existing.coverage,
          to: null,
        },
        auth.user.id,
        tx,
      );
    });
    await finishRecompute(
      pending,
      `Control Mapping removed: ${frameworkLabel(existing.requirement.framework)} ${existing.requirement.code} ↔ ${existing.control.code}`,
    );
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Control Mapping not found" }, { status: 404 });
    }
    throw error;
  }
}

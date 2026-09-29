import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { logMappingChange } from "@/lib/frameworks";

const createMappingSchema = z.object({
  controlId: z.string().min(1),
  coverage: z.enum(["FULL", "PARTIAL"]),
  rationale: z.string().trim().min(1).nullable().optional(),
});

/**
 * Maps a Control onto a Requirement with a Coverage (Full/Partial) and an
 * optional rationale. A Requirement can map to several Controls, but to each
 * Control only once (409). Logs a System-less CONTROL_MAPPING_CHANGED event
 * in the same transaction. See #73, PRD 0001 F-CL.4.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/frameworks/[id]/requirements/[requirementId]/mappings">,
) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;
  const parsed = createMappingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "controlId and a coverage of FULL or PARTIAL are required" }, { status: 400 });
  }

  const requirement = await prisma.requirement.findFirst({
    where: { id: requirementId, frameworkId: id },
    include: { framework: { select: { name: true, version: true } } },
  });
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  const control = await prisma.control.findUnique({
    where: { id: parsed.data.controlId },
    select: { id: true, code: true },
  });
  if (!control) {
    return NextResponse.json({ error: "Control not found" }, { status: 400 });
  }

  try {
    const mapping = await prisma.$transaction(async (tx) => {
      const created = await tx.controlMapping.create({
        data: {
          requirementId,
          controlId: control.id,
          coverage: parsed.data.coverage,
          rationale: parsed.data.rationale ?? null,
        },
        select: { id: true, coverage: true, rationale: true, control: { select: { id: true, code: true, title: true } } },
      });
      await logMappingChange(
        {
          change: "added",
          framework: requirement.framework,
          requirementCode: requirement.code,
          controlCode: control.code,
          from: null,
          to: created.coverage,
        },
        auth.user.id,
        tx,
      );
      return created;
    });
    return NextResponse.json({ mapping }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "This Requirement is already mapped to that Control" }, { status: 409 });
    }
    throw error;
  }
}

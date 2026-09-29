import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { createControlSchema } from "@/lib/control-schema";
import { isCovered } from "@/lib/coverage-state";
import { clearGapAcceptance } from "@/lib/framework-coverage";
import { controlIncludeFor, logMappingChange } from "@/lib/frameworks";

/**
 * Closes a Coverage Gap by authoring a Supplementary Control: creates the
 * Control (same body and validation as `POST /api/controls`) with
 * `originFrameworkId` set to this Framework, and a FULL Control Mapping from
 * it to this Requirement, logging the same CONTROL_MAPPING_CHANGED event the
 * mapping endpoint does, all in one transaction (a failure, such as a duplicate
 * Control code, leaves nothing behind). Only a gap can be closed this way: a
 * covered Requirement is a 409; an accepted gap can be, and stops being
 * accepted since it is now covered. See #74, PRD 0001 F-CL.2.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/frameworks/[id]/requirements/[requirementId]/supplementary-control">,
) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;
  const parsed = createControlSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Control" }, { status: 400 });
  }

  const requirement = await prisma.requirement.findFirst({
    where: { id: requirementId, frameworkId: id },
    select: {
      id: true,
      code: true,
      framework: { select: { name: true, version: true } },
      mappings: { select: { coverage: true } },
    },
  });
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }
  if (isCovered(requirement.mappings)) {
    return NextResponse.json(
      { error: "This Requirement is already covered by a Full mapping, so it has no Coverage Gap to close" },
      { status: 409 },
    );
  }

  const { mandatory, examples, ...rest } = parsed.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const control = await tx.control.create({
        data: { ...rest, mandatory: mandatory ?? true, examples: examples ?? [], originFrameworkId: id },
        include: controlIncludeFor(auth.user),
      });
      const mapping = await tx.controlMapping.create({
        data: { requirementId, controlId: control.id, coverage: "FULL" },
        select: { id: true, coverage: true, rationale: true },
      });
      await logMappingChange(
        {
          change: "added",
          framework: requirement.framework,
          requirementCode: requirement.code,
          controlCode: control.code,
          from: null,
          to: "FULL",
        },
        auth.user.id,
        tx,
      );
      await clearGapAcceptance(tx, requirementId);
      return { control, mapping };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "A Control with that code already exists" }, { status: 409 });
    }
    throw error;
  }
}

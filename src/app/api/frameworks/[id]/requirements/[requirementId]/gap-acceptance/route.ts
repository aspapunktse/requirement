import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE } from "@/lib/catalog";
import { isCovered } from "@/lib/coverage-state";

type GapAcceptanceContext = RouteContext<"/api/frameworks/[id]/requirements/[requirementId]/gap-acceptance">;

const acceptGapSchema = z.object({ justification: z.string().trim().min(1) });

/** The Requirement (scoped to the Framework in the URL) with what's needed to judge whether it is a gap. */
function findRequirement(id: string, requirementId: string) {
  return prisma.requirement.findFirst({
    where: { id: requirementId, frameworkId: id },
    select: { id: true, gapAcceptedAt: true, mappings: { select: { coverage: true } } },
  });
}

/**
 * Accepts a Coverage Gap: records who accepted it, when, and why (the
 * justification is required). Calling it again on an already-accepted gap
 * replaces the justification and re-stamps who/when. A covered Requirement
 * has no gap to accept (409). Compliance Manager / Admin only. Acceptance
 * isn't a Change Event: PRD F-CE.1 lists Control Mappings, publishing, SoA
 * justifications and Check-ups, not gaps. See #74, PRD 0001 F-CL.5.
 */
export async function PUT(request: NextRequest, ctx: GapAcceptanceContext) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;
  const parsed = acceptGapSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A justification is required to accept a gap" }, { status: 400 });
  }

  const requirement = await findRequirement(id, requirementId);
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }
  if (isCovered(requirement.mappings)) {
    return NextResponse.json(
      { error: "This Requirement is covered by a Full mapping, so there is no Coverage Gap to accept" },
      { status: 409 },
    );
  }

  const updated = await prisma.requirement.update({
    where: { id: requirementId },
    data: { gapAcceptedAt: new Date(), gapAcceptedById: auth.user.id, gapJustification: parsed.data.justification },
    select: {
      id: true,
      gapAcceptedAt: true,
      gapJustification: true,
      gapAcceptedBy: { select: { id: true, name: true } },
    },
  });
  return NextResponse.json({ requirement: updated });
}

/** Un-accepts a gap: clears the acceptance so the Requirement is an open Coverage Gap again. 409 if it wasn't accepted. */
export async function DELETE(request: NextRequest, ctx: GapAcceptanceContext) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_MANAGE_REQUIREMENT_DATABASE);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;
  const requirement = await findRequirement(id, requirementId);
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }
  if (!requirement.gapAcceptedAt) {
    return NextResponse.json({ error: "This Requirement's gap has not been accepted" }, { status: 409 });
  }

  await prisma.requirement.update({
    where: { id: requirementId },
    data: { gapAcceptedAt: null, gapAcceptedById: null, gapJustification: null },
  });
  return new NextResponse(null, { status: 204 });
}

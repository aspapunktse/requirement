import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RequirementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { ForbiddenError, requireRole } from "@/lib/authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { getApplicableRequirement } from "@/lib/requirement-assessments";

const ROLES_ALLOWED_TO_WAIVE = ["ADMIN", "RISK_OWNER"] as const;
const STATUSES_REQUIRING_WAIVE_ROLE: RequirementStatus[] = ["WAIVED", "NOT_APPLICABLE"];

const updateAssessmentSchema = z.object({
  status: z.enum(RequirementStatus),
  evidence: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[requirementId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const parsed = updateAssessmentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { status, evidence, notes } = parsed.data;

  const requirement = await getApplicableRequirement(system, requirementId);
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  if (STATUSES_REQUIRING_WAIVE_ROLE.includes(status)) {
    try {
      requireRole(auth.user, [...ROLES_ALLOWED_TO_WAIVE]);
    } catch (error) {
      if (error instanceof ForbiddenError) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      throw error;
    }

    if (requirement.mandatory && !notes?.trim()) {
      return NextResponse.json(
        { error: "A justification note is required to waive or mark a mandatory Requirement Not Applicable" },
        { status: 400 },
      );
    }
  }

  const assessment = await prisma.requirementAssessment.upsert({
    where: { systemId_requirementId: { systemId: system.id, requirementId } },
    create: {
      systemId: system.id,
      requirementId,
      status,
      evidence,
      notes,
      assessedById: auth.user.id,
      assessedAt: new Date(),
    },
    update: {
      status,
      evidence,
      notes,
      assessedById: auth.user.id,
      assessedAt: new Date(),
    },
    include: { assessedBy: true },
  });

  return NextResponse.json({ assessment });
}

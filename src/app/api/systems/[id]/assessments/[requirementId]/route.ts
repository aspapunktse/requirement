import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RequirementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { checkWaiveGate, getRequirementForAssessmentEdit } from "@/lib/requirement-assessments";
import { logChangeEvent } from "@/lib/change-events";

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

  const requirement = await getRequirementForAssessmentEdit(system, requirementId);
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  if (STATUSES_REQUIRING_WAIVE_ROLE.includes(status)) {
    const gate = checkWaiveGate(auth.user, requirement, notes);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  const existing = await prisma.requirementAssessment.findUnique({
    where: { systemId_requirementId: { systemId: system.id, requirementId } },
  });

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
      // Any manual edit marks this Assessment human-owned, immune to
      // future automatic reversion if it was previously auto-fulfilled
      // by a Capability (see #16).
      fulfilledByCapabilityId: null,
    },
    include: { assessedBy: true },
  });

  if ((existing?.status ?? "NOT_STARTED") !== status) {
    await logChangeEvent(
      system.id,
      "ASSESSMENT_STATUS_CHANGED",
      `${requirement.code} status changed from ${existing?.status ?? "NOT_STARTED"} to ${status}`,
      auth.user.id,
    );
  }

  return NextResponse.json({ assessment });
}

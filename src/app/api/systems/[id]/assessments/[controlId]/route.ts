import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ControlAssessmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { assessmentEditAccess, canEditAssessment, WAIVE_GATED_STATUSES } from "@/lib/system-permissions";
import { checkWaiveGate, getControlForAssessmentEdit } from "@/lib/control-assessments";
import { logChangeEvent } from "@/lib/change-events";

const updateAssessmentSchema = z.object({
  status: z.enum(ControlAssessmentStatus),
  evidence: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, controlId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  // Seeing a System is not enough to edit its Assessments (#78).
  if (assessmentEditAccess(auth.user, system) === "none") {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can edit this System's Control Assessments" },
      { status: 403 },
    );
  }

  const parsed = updateAssessmentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { status, evidence, notes } = parsed.data;

  // A Risk Owner who doesn't own the System may only waive / mark Not Applicable.
  if (!canEditAssessment(auth.user, system, status)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can edit this System's Control Assessments" },
      { status: 403 },
    );
  }

  const control = await getControlForAssessmentEdit(system, controlId);
  if (!control) {
    return NextResponse.json({ error: "Control not found" }, { status: 404 });
  }

  if (WAIVE_GATED_STATUSES.includes(status)) {
    const gate = checkWaiveGate(auth.user, control, notes);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  const existing = await prisma.controlAssessment.findUnique({
    where: { systemId_controlId: { systemId: system.id, controlId } },
  });

  const assessment = await prisma.controlAssessment.upsert({
    where: { systemId_controlId: { systemId: system.id, controlId } },
    create: {
      systemId: system.id,
      controlId,
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
      `${control.code} status changed from ${existing?.status ?? "NOT_STARTED"} to ${status}`,
      auth.user.id,
    );
  }

  return NextResponse.json({ assessment });
}

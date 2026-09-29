import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SelfAssessmentAnswer } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { canWriteSystems, getVisibleSystem } from "@/lib/system-visibility";
import { checkWaiveGate, getApplicableControl } from "@/lib/control-assessments";
import { logChangeEvent, SYSTEM_ACTOR } from "@/lib/change-events";

const answerSchema = z.object({
  answer: z.enum(SelfAssessmentAnswer),
  notes: z.string().nullable().optional(),
});

/**
 * Yes -> Fulfilled. No -> left open (In Progress) plus an auto-opened Risk.
 * N/A -> Not Applicable, gated the same as a manual N/A edit (#3): only
 * ADMIN/RISK_OWNER, and a justification note on a mandatory Control.
 */
function statusForAnswer(answer: SelfAssessmentAnswer) {
  switch (answer) {
    case "YES":
      return "FULFILLED" as const;
    case "NO":
      return "IN_PROGRESS" as const;
    case "NA":
      return "NOT_APPLICABLE" as const;
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]/answer">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!canWriteSystems(auth.user)) {
    return NextResponse.json({ error: "Your role can read Systems but not change them" }, { status: 403 });
  }

  const { id, controlId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const parsed = answerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
  }
  const { answer, notes } = parsed.data;

  const control = await getApplicableControl(system, controlId);
  if (!control) {
    return NextResponse.json({ error: "Control not found" }, { status: 404 });
  }

  if (answer === "NA") {
    const gate = checkWaiveGate(auth.user, control, notes);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  const status = statusForAnswer(answer);

  const existing = await prisma.controlAssessment.findUnique({
    where: { systemId_controlId: { systemId: system.id, controlId } },
  });

  const assessment = await prisma.controlAssessment.upsert({
    where: { systemId_controlId: { systemId: system.id, controlId } },
    create: {
      systemId: system.id,
      controlId,
      status,
      notes,
      selfAssessmentAnswer: answer,
      assessedById: auth.user.id,
      assessedAt: new Date(),
    },
    update: {
      status,
      notes,
      selfAssessmentAnswer: answer,
      assessedById: auth.user.id,
      assessedAt: new Date(),
      // A manual answer marks this Assessment human-owned (see #16).
      fulfilledByCapabilityId: null,
    },
    include: { assessedBy: true },
  });

  if ((existing?.status ?? "NOT_STARTED") !== status) {
    await logChangeEvent(
      system.id,
      "ASSESSMENT_STATUS_CHANGED",
      `${control.code} status changed from ${existing?.status ?? "NOT_STARTED"} to ${status} (Self-Assessment answer: ${answer})`,
      auth.user.id,
    );
  }

  if (answer === "NO") {
    const existingRisk = await prisma.risk.findFirst({
      where: { controlAssessmentId: assessment.id },
    });
    if (!existingRisk) {
      await prisma.risk.create({
        data: {
          systemId: system.id,
          title: `${control.code}: ${control.title}`,
          description: `Auto-opened: "${control.question ?? control.title}" was answered No.`,
          severity: "MEDIUM",
          likelihood: "MEDIUM",
          controlAssessmentId: assessment.id,
        },
      });
      await logChangeEvent(
        system.id,
        "RISK_STATUS_CHANGED",
        `Risk "${control.code}: ${control.title}" auto-opened (status: OPEN) from a "No" Self-Assessment answer`,
        SYSTEM_ACTOR,
      );
    }
  }

  return NextResponse.json({ assessment });
}

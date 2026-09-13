import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SelfAssessmentAnswer } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { checkWaiveGate, getApplicableRequirement } from "@/lib/requirement-assessments";

const answerSchema = z.object({
  answer: z.enum(SelfAssessmentAnswer),
  notes: z.string().nullable().optional(),
});

/**
 * Yes -> Fulfilled. No -> left open (In Progress) plus an auto-opened Risk.
 * N/A -> Not Applicable, gated the same as a manual N/A edit (#3): only
 * ADMIN/RISK_OWNER, and a justification note on a mandatory Requirement.
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
  ctx: RouteContext<"/api/systems/[id]/assessments/[requirementId]/answer">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const parsed = answerSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid answer" }, { status: 400 });
  }
  const { answer, notes } = parsed.data;

  const requirement = await getApplicableRequirement(system, requirementId);
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  if (answer === "NA") {
    const gate = checkWaiveGate(auth.user, requirement, notes);
    if (!gate.ok) {
      return NextResponse.json({ error: gate.error }, { status: gate.status });
    }
  }

  const status = statusForAnswer(answer);

  const assessment = await prisma.requirementAssessment.upsert({
    where: { systemId_requirementId: { systemId: system.id, requirementId } },
    create: {
      systemId: system.id,
      requirementId,
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
    },
    include: { assessedBy: true },
  });

  if (answer === "NO") {
    const existingRisk = await prisma.risk.findFirst({
      where: { requirementAssessmentId: assessment.id },
    });
    if (!existingRisk) {
      await prisma.risk.create({
        data: {
          systemId: system.id,
          title: `${requirement.code}: ${requirement.title}`,
          description: `Auto-opened: "${requirement.question ?? requirement.title}" was answered No.`,
          severity: "MEDIUM",
          likelihood: "MEDIUM",
          requirementAssessmentId: assessment.id,
        },
      });
    }
  }

  return NextResponse.json({ assessment });
}

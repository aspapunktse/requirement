import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, RISK_INCLUDE } from "@/lib/risks";

const updateRiskSchema = z.object({
  status: z.enum(RiskStatus),
  mitigationPlan: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/risks/[riskId]">,
) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS]);
  if ("response" in auth) return auth.response;

  const { id, riskId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const parsed = updateRiskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { status, mitigationPlan } = parsed.data;

  if (status === "MITIGATED" && !mitigationPlan?.trim()) {
    return NextResponse.json(
      { error: "A mitigation plan is required to mark a Risk Mitigated" },
      { status: 400 },
    );
  }

  const existing = await prisma.risk.findFirst({ where: { id: riskId, systemId: system.id } });
  if (!existing) {
    return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  }

  const risk = await prisma.risk.update({
    where: { id: riskId },
    data: { status, mitigationPlan },
    include: RISK_INCLUDE,
  });
  return NextResponse.json({ risk });
}

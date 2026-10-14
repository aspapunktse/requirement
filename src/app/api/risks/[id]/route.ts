import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { logChangeEvent } from "@/lib/change-events";
import { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, RISK_INCLUDE } from "@/lib/risks";

const updateRiskSchema = z.object({
  status: z.enum(RiskStatus),
  mitigationPlan: z.string().nullable().optional(),
  /** Who acts on the Risk; absent leaves it, null unassigns. */
  ownerId: z.string().min(1).nullable().optional(),
});

/**
 * `PATCH /api/risks/[id]`: manage a Risk that belongs to no System (#157): its status, mitigation
 * plan and owner, under the rules of `PATCH /api/systems/[id]/risks/[riskId]` (a Risk Owner or an
 * Admin; Mitigated needs a mitigation plan; a status change is a RISK_STATUS_CHANGED Change Event,
 * System-less here). A Risk that belongs to a System is 404 here: it is managed through its System,
 * which also decides who may see it. The Internal Auditor reads these Risks and gets 403. The owner
 * must be a Risk Owner or an Admin.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/risks/[id]">) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS]);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateRiskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { status, mitigationPlan, ownerId } = parsed.data;

  if (status === "MITIGATED" && !mitigationPlan?.trim()) {
    return NextResponse.json({ error: "A mitigation plan is required to mark a Risk Mitigated" }, { status: 400 });
  }

  const existing = await prisma.risk.findFirst({ where: { id, systemId: null } });
  if (!existing) {
    return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  }

  if (ownerId) {
    const owner = await prisma.user.findFirst({
      where: { id: ownerId, role: { in: [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS] } },
      select: { id: true },
    });
    if (!owner) {
      return NextResponse.json({ error: "The owner must be a Risk Owner or an Admin" }, { status: 400 });
    }
  }

  const risk = await prisma.risk.update({
    where: { id },
    data: { status, mitigationPlan, ...(ownerId !== undefined && { ownerId }) },
    include: RISK_INCLUDE,
  });
  if (existing.status !== status) {
    await logChangeEvent(
      null,
      "RISK_STATUS_CHANGED",
      `Organization Risk "${existing.title}" status changed from ${existing.status} to ${status}`,
      auth.user.id,
    );
  }
  return NextResponse.json({ risk });
}

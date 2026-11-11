import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canAssignRiskOwner, ROLES_ALLOWED_TO_ASSIGN_RISK_OWNER, ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, RISK_INCLUDE } from "@/lib/risks";
import { logChangeEvent } from "@/lib/change-events";
import { refuseIfSystemClosed } from "@/lib/system-closed";

const updateRiskSchema = z.object({
  /** Absent in an owner-only change (#360). Present: the combined status form, for the roles that manage status. */
  status: z.enum(RiskStatus).optional(),
  mitigationPlan: z.string().nullable().optional(),
  /** Who acts on the Risk: any User, whatever their role (#322). Absent leaves it, null unassigns. */
  ownerId: z.string().min(1).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/risks/[riskId]">,
) {
  // Admin, Risk Owner and Risk Facilitator get in; what each may change is decided below, once the body is read.
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_ASSIGN_RISK_OWNER]);
  if ("response" in auth) return auth.response;

  const { id, riskId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const body: unknown = await request.json().catch(() => null);
  const parsed = updateRiskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { status, mitigationPlan, ownerId } = parsed.data;

  // Anything beyond the owner (any other field) needs the right to manage Risk status: a Risk Facilitator gets 403, nothing changed.
  const changesMoreThanOwner = typeof body === "object" && body !== null && Object.keys(body).some((key) => key !== "ownerId");
  if (changesMoreThanOwner && !ROLES_ALLOWED_TO_MANAGE_RISK_STATUS.includes(auth.user.role)) {
    return NextResponse.json({ error: "Only a Risk Owner or an Admin can change a Risk's status or mitigation plan" }, { status: 403 });
  }
  if (ownerId !== undefined && !canAssignRiskOwner(auth.user, system)) {
    return NextResponse.json({ error: "A Risk Facilitator can't assign a Risk's owner on a System they own" }, { status: 403 });
  }
  if (status === undefined && ownerId === undefined) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }
  if (status === undefined && mitigationPlan !== undefined) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

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

  if (ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!owner) {
      return NextResponse.json({ error: "The owner must be an existing User" }, { status: 400 });
    }
  }

  const risk = await prisma.risk.update({
    where: { id: riskId },
    data: { ...(status !== undefined && { status, mitigationPlan }), ...(ownerId !== undefined && { ownerId }) },
    include: RISK_INCLUDE,
  });
  if (status !== undefined && existing.status !== status) {
    await logChangeEvent(
      system.id,
      "RISK_STATUS_CHANGED",
      `Risk "${existing.title}" status changed from ${existing.status} to ${status}`,
      auth.user.id,
    );
  }
  return NextResponse.json({ risk });
}

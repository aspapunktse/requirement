import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { logChangeEvent } from "@/lib/change-events";
import { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS, RISK_INCLUDE } from "@/lib/risks";
import { recordRiskStatusChange } from "@/lib/status-history";
import { calendarDate, toCalendarDate } from "@/lib/risk-remediation";

const updateRiskSchema = z.object({
  /** Absent in an owner-only change (#360). */
  status: z.enum(RiskStatus).optional(),
  mitigationPlan: z.string().nullable().optional(),
  /** Who acts on the Risk; absent leaves it, null unassigns. */
  ownerId: z.string().min(1).nullable().optional(),
  /** The date the Risk is to be dealt with by (#456), `YYYY-MM-DD`; null clears it. */
  deadline: calendarDate.nullable().optional(),
});

/**
 * `PATCH /api/risks/[id]`: manage a Risk that belongs to no System (#157): its status, mitigation
 * plan and owner, under the rules of `PATCH /api/systems/[id]/risks/[riskId]` (a Risk Owner or an
 * Admin; Mitigated needs a mitigation plan; a status change is a RISK_STATUS_CHANGED Change Event,
 * System-less here). A Risk that belongs to a System is 404 here: it is managed through its System,
 * which also decides who may see it. The Internal Auditor reads these Risks and gets 403. The owner
 * may be any User, whatever their role (#322, PRD 0002 F-RA.3); an unknown id is 400 and changes nothing.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/risks/[id]">) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS]);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = updateRiskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }
  const { status, mitigationPlan, ownerId, deadline } = parsed.data;
  if (status === undefined && ((ownerId === undefined && deadline === undefined) || mitigationPlan !== undefined)) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  }

  if (status === "MITIGATED" && !mitigationPlan?.trim()) {
    return NextResponse.json({ error: "A mitigation plan is required to mark a Risk Mitigated" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    // Serialise with a concurrent edit of this Risk: the status read below is the one this write changes from (ADR 0019).
    await tx.$queryRaw`SELECT "id" FROM "Risk" WHERE "id" = ${id} FOR UPDATE`;
    const existing = await tx.risk.findFirst({ where: { id, systemId: null } });
    if (!existing) return { kind: "not-found" as const };
    if (ownerId && !(await tx.user.findFirst({ where: { id: ownerId }, select: { id: true } }))) return { kind: "bad-owner" as const };

    const risk = await tx.risk.update({
      where: { id },
      data: {
        ...(status !== undefined && { status, mitigationPlan }),
        ...(ownerId !== undefined && { ownerId }),
        ...(deadline !== undefined && { deadline: deadline === null ? null : toCalendarDate(deadline) }),
      },
      include: RISK_INCLUDE,
    });
    if (status !== undefined) {
      // The change, its status history and its Change Event commit together (#456).
      await recordRiskStatusChange(tx, { riskId: id, systemId: null, from: existing.status, to: status, actorId: auth.user.id });
      if (existing.status !== status) {
        await logChangeEvent(
          null,
          "RISK_STATUS_CHANGED",
          `Organization Risk "${existing.title}" status changed from ${existing.status} to ${status}`,
          auth.user.id,
          tx,
        );
      }
    }
    return { kind: "ok" as const, risk };
  }, { timeout: 30_000, maxWait: 30_000 });
  if (result.kind === "not-found") return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  if (result.kind === "bad-owner") return NextResponse.json({ error: "The owner must be an existing User" }, { status: 400 });
  return NextResponse.json({ risk: result.risk });
}

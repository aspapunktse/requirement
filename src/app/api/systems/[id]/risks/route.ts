import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RiskSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canAssignRiskOwner, canLogRisk, getSystemRisks, RISK_INCLUDE } from "@/lib/risks";
import { logChangeEvent } from "@/lib/change-events";
import { riskLoggedDetail } from "@/lib/risk-logged-event";
import { refuseIfSystemClosed } from "@/lib/system-closed";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risks">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const risks = await getSystemRisks(system.id);
  return NextResponse.json({ risks });
}

const createRiskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(RiskSeverity),
  likelihood: z.enum(RiskSeverity),
  /** Who acts on the Risk: any User (#360). Only those who may assign an owner may name one. */
  ownerId: z.string().min(1).nullable().optional(),
});

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risks">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canLogRisk(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner, a Risk Owner, or an Admin can log a Risk" },
      { status: 403 },
    );
  }

  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const parsed = createRiskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Risk" }, { status: 400 });
  }

  const { ownerId, ...riskFields } = parsed.data;
  // The System's owner may log a Risk but may not pick its owner (#360), unless they also hold a role that may.
  if (ownerId && !canAssignRiskOwner(auth.user, system)) {
    return NextResponse.json({ error: "Only a Risk Owner, a Risk Facilitator or an Admin can assign a Risk's owner" }, { status: 403 });
  }

  // The Risk and the Change Event that records it commit together (#245).
  const risk = await prisma.$transaction(async (tx) => {
    if (ownerId && !(await tx.user.findUnique({ where: { id: ownerId }, select: { id: true } }))) return null;
    const created = await tx.risk.create({
      // The source is the server's to set: an ad hoc Risk, whatever the body says (the schema has no such field).
      data: { ...riskFields, ...(ownerId ? { ownerId } : {}), systemId: system.id, source: "AD_HOC" },
      include: RISK_INCLUDE,
    });
    await logChangeEvent(
      system.id,
      "RISK_LOGGED",
      riskLoggedDetail({ title: created.title, severity: created.severity, how: { kind: "manual" } }),
      auth.user.id,
      tx,
    );
    return created;
  });
  if (!risk) return NextResponse.json({ error: "The owner must be an existing User" }, { status: 400 });
  return NextResponse.json({ risk }, { status: 201 });
}

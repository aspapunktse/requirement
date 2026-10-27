import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RiskSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canLogRisk, getSystemRisks, RISK_INCLUDE } from "@/lib/risks";
import { logChangeEvent } from "@/lib/change-events";
import { riskLoggedDetail } from "@/lib/risk-logged-event";

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

  const parsed = createRiskSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Risk" }, { status: 400 });
  }

  // The Risk and the Change Event that records it commit together (#245).
  const risk = await prisma.$transaction(async (tx) => {
    const created = await tx.risk.create({
      data: { ...parsed.data, systemId: system.id },
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
  return NextResponse.json({ risk }, { status: 201 });
}

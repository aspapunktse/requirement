import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { createMilestone, createMilestoneSchema } from "@/lib/risk-remediation";

/** `POST /api/risks/[id]/milestones` (#456): adds a remediation milestone to an Organization Risk (one with no System; a System's Risk is 404 here). A Risk Owner or an Admin. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/risks/[id]/milestones">) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS]);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = createMilestoneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid milestone" }, { status: 400 });
  const result = await createMilestone({ riskId: id, systemId: null }, parsed.data);
  if (result.kind !== "ok") return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  return NextResponse.json({ risk: result.risk }, { status: 201 });
}

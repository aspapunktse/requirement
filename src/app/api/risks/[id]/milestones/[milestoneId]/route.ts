import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { completedDateInFuture, deleteMilestone, updateMilestone, updateMilestoneSchema } from "@/lib/risk-remediation";

type Ctx = RouteContext<"/api/risks/[id]/milestones/[milestoneId]">;

/** `PATCH` (#456): edits a milestone of an Organization Risk, or marks it completed on a date. A Risk Owner or an Admin. */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS]);
  if ("response" in auth) return auth.response;
  const { id, milestoneId } = await ctx.params;
  const parsed = updateMilestoneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid milestone" }, { status: 400 });
  if (parsed.data.completedDate && completedDateInFuture(parsed.data.completedDate)) {
    return NextResponse.json({ error: "A milestone can't be completed in the future" }, { status: 400 });
  }
  const result = await updateMilestone({ riskId: id, systemId: null }, milestoneId, parsed.data);
  if (result.kind !== "ok") return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  return NextResponse.json({ risk: result.risk });
}

/** `DELETE`: removes a milestone that is not completed; a completed one stays (409). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS]);
  if ("response" in auth) return auth.response;
  const { id, milestoneId } = await ctx.params;
  const result = await deleteMilestone({ riskId: id, systemId: null }, milestoneId);
  if (result.kind === "not-found") return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  if (result.kind === "completed") return NextResponse.json({ error: "A completed milestone can't be deleted" }, { status: 409 });
  return NextResponse.json({ risk: result.risk });
}

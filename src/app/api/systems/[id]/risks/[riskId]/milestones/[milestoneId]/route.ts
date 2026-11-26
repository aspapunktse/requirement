import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { refuseIfSystemClosed } from "@/lib/system-closed";
import { completedDateInFuture, deleteMilestone, updateMilestone, updateMilestoneSchema } from "@/lib/risk-remediation";

type Ctx = RouteContext<"/api/systems/[id]/risks/[riskId]/milestones/[milestoneId]">;

type Resolved = { response: Response; scope?: undefined; milestoneId?: undefined } | { response?: undefined; scope: { riskId: string; systemId: string }; milestoneId: string };

async function resolve(request: NextRequest, ctx: Ctx): Promise<Resolved> {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS]);
  if ("response" in auth) return { response: auth.response };
  const { id, riskId, milestoneId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return { response: NextResponse.json({ error: "System not found" }, { status: 404 }) };
  const closed = await refuseIfSystemClosed(id);
  if (closed) return { response: closed };
  return { scope: { riskId, systemId: system.id }, milestoneId };
}

/** `PATCH`: edits a milestone, or marks it completed on a date (`completedDate`; null reopens it). Same people as changing the Risk's status (#456). */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if (resolved.response) return resolved.response;
  const parsed = updateMilestoneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid milestone" }, { status: 400 });
  if (parsed.data.completedDate && completedDateInFuture(parsed.data.completedDate)) {
    return NextResponse.json({ error: "A milestone can't be completed in the future" }, { status: 400 });
  }
  const result = await updateMilestone(resolved.scope, resolved.milestoneId, parsed.data);
  if (result.kind !== "ok") return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  return NextResponse.json({ risk: result.risk });
}

/** `DELETE`: removes a milestone that is not completed; a completed one is a record and stays (409). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const resolved = await resolve(request, ctx);
  if (resolved.response) return resolved.response;
  const result = await deleteMilestone(resolved.scope, resolved.milestoneId);
  if (result.kind === "not-found") return NextResponse.json({ error: "Milestone not found" }, { status: 404 });
  if (result.kind === "completed") return NextResponse.json({ error: "A completed milestone can't be deleted" }, { status: 409 });
  return NextResponse.json({ risk: result.risk });
}

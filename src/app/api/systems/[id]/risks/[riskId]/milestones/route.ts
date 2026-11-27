import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { ROLES_ALLOWED_TO_MANAGE_RISK_STATUS } from "@/lib/risks";
import { refuseIfSystemClosed } from "@/lib/system-closed";
import { createMilestone, createMilestoneSchema } from "@/lib/risk-remediation";

/**
 * `POST /api/systems/[id]/risks/[riskId]/milestones` (#456): adds a remediation milestone (a title and a planned date) to a Risk of
 * the System. Allowed to the people who may change the Risk's status (a Risk Owner or an Admin); anyone else is 403 and nothing changes.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/risks/[riskId]/milestones">) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_RISK_STATUS]);
  if ("response" in auth) return auth.response;

  const { id, riskId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const parsed = createMilestoneSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid milestone" }, { status: 400 });

  const result = await createMilestone({ riskId, systemId: system.id }, parsed.data);
  if (result.kind !== "ok") return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  return NextResponse.json({ risk: result.risk }, { status: 201 });
}

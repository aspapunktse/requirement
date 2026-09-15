import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { getRequirementForAssessmentEdit } from "@/lib/requirement-assessments";
import { ROLES_ALLOWED_TO_MANAGE_QUERIES, raiseQuery } from "@/lib/requirement-queries";

const raiseQuerySchema = z.object({ body: z.string().min(1) });

/** Raises a new Requirement Query — REVIEWER/RISK_OWNER/ADMIN only (see #56). */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[requirementId]/queries">,
) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_QUERIES]);
  if ("response" in auth) return auth.response;

  const { id, requirementId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const requirement = await getRequirementForAssessmentEdit(system, requirementId);
  if (!requirement) {
    return NextResponse.json({ error: "Requirement not found" }, { status: 404 });
  }

  const parsed = raiseQuerySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A question body is required" }, { status: 400 });
  }

  const query = await raiseQuery(system, requirementId, auth.user.id, parsed.data.body);
  return NextResponse.json({ query }, { status: 201 });
}

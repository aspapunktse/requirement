import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { ROLES_ALLOWED_TO_MANAGE_QUERIES, resolveQuery } from "@/lib/assessment-queries";

/**
 * Marks an Assessment Query resolved — REVIEWER/RISK_OWNER/ADMIN only, not
 * necessarily the original asker, and never the System Owner (see #56).
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]/queries/[queryId]/resolve">,
) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_MANAGE_QUERIES]);
  if ("response" in auth) return auth.response;

  const { id, controlId, queryId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const existing = await prisma.assessmentQuery.findFirst({
    where: { id: queryId, controlAssessment: { systemId: system.id, controlId } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Assessment Query not found" }, { status: 404 });
  }

  const query = await resolveQuery(queryId, auth.user.id);
  return NextResponse.json({ query });
}

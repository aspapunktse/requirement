import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import {
  ROLES_ALLOWED_TO_MANAGE_QUERIES,
  mayActThroughMembership,
  queryRightsFor,
  redactQueries,
  resolveQuery,
} from "@/lib/assessment-queries";

/**
 * Marks an Assessment Query resolved — a REVIEWER/RISK_OWNER/ADMIN, or a Review Group member for a
 * Control in the group's remit (#201); not necessarily the original asker, and never the System Owner
 * (see #56). The resolution is attributed as `queryRightsFor` says.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]/queries/[queryId]/resolve">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  // Neither a qualifying role nor a group member: refused before anything is looked up.
  if (!ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(auth.user.role) && !(await mayActThroughMembership(auth.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, controlId, queryId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const rights = await queryRightsFor(auth.user, system, controlId, "resolve");
  if (!rights.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const existing = await prisma.assessmentQuery.findFirst({
    where: { id: queryId, controlAssessment: { systemId: system.id, controlId } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Assessment Query not found" }, { status: 404 });
  }

  const query = await resolveQuery(queryId, auth.user.id, rights.attribution);
  const [view] = await redactQueries([query], auth.user, system.ownerId);
  return NextResponse.json({ query: view });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { getControlForAssessmentEdit } from "@/lib/control-assessments";
import {
  ROLES_ALLOWED_TO_MANAGE_QUERIES,
  mayActThroughMembership,
  queryRightsFor,
  raiseQuery,
  redactQueries,
} from "@/lib/assessment-queries";

const raiseQuerySchema = z.object({ body: z.string().min(1) });

/**
 * Raises a new Assessment Query: a REVIEWER/RISK_OWNER/ADMIN (see #56), or a Review Group member
 * of any role for a Control in the group's remit on this System (#201). The message is attributed
 * as `queryRightsFor` says, and the response redacts the people the viewer may not see.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]/queries">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  // Neither a qualifying role nor a group member: refused before anything is looked up.
  if (!ROLES_ALLOWED_TO_MANAGE_QUERIES.includes(auth.user.role) && !(await mayActThroughMembership(auth.user))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, controlId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const control = await getControlForAssessmentEdit(system, controlId);
  if (!control) {
    return NextResponse.json({ error: "Control not found" }, { status: 404 });
  }

  const rights = await queryRightsFor(auth.user, system, controlId, "raise");
  if (!rights.allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = raiseQuerySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A question body is required" }, { status: 400 });
  }

  const query = await raiseQuery(system, controlId, auth.user.id, parsed.data.body, rights.attribution);
  const [view] = await redactQueries([query], auth.user, system.ownerId);
  return NextResponse.json({ query: view }, { status: 201 });
}

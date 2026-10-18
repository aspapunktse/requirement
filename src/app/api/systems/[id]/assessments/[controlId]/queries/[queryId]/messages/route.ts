import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { canWriteSystems, getVisibleSystem } from "@/lib/system-visibility";
import { addQueryMessage, mayActThroughMembership, queryRightsFor, redactQueries } from "@/lib/assessment-queries";

const addMessageSchema = z.object({ body: z.string().min(1) });

/**
 * Replies to an Assessment Query — the System's owner, a REVIEWER/RISK_OWNER/ADMIN, or a Review
 * Group member for a Control in the group's remit (#201). Reopens the Query if it was resolved (see #56).
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[controlId]/queries/[queryId]/messages">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  // A read-only role is refused up front, unless it can still act as a Review Group member (Compliance Manager, #201).
  if (!canWriteSystems(auth.user) && !(await mayActThroughMembership(auth.user))) {
    return NextResponse.json({ error: "Your role can read Systems but not change them" }, { status: 403 });
  }

  const { id, controlId, queryId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const rights = await queryRightsFor(auth.user, system, controlId, "reply");
  if (!rights.allowed) {
    return NextResponse.json(
      { error: "Only the System's owner, a Reviewer, a Risk Owner, an Admin, or a Review Group member for this Control can reply" },
      { status: 403 },
    );
  }

  const existing = await prisma.assessmentQuery.findFirst({
    where: { id: queryId, controlAssessment: { systemId: system.id, controlId } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Assessment Query not found" }, { status: 404 });
  }

  const parsed = addMessageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A message body is required" }, { status: 400 });
  }

  const query = await addQueryMessage(queryId, auth.user.id, parsed.data.body, rights.attribution);
  const [view] = await redactQueries([query], auth.user, system.ownerId);
  return NextResponse.json({ query: view }, { status: 201 });
}

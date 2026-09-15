import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { addQueryMessage, canReplyToQuery } from "@/lib/requirement-queries";

const addMessageSchema = z.object({ body: z.string().min(1) });

/**
 * Replies to a Requirement Query — the System's owner or a
 * REVIEWER/RISK_OWNER/ADMIN. Reopens the Query if it was resolved (see #56).
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/assessments/[requirementId]/queries/[queryId]/messages">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, requirementId, queryId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canReplyToQuery(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner, a Reviewer, a Risk Owner, or an Admin can reply" },
      { status: 403 },
    );
  }

  const existing = await prisma.requirementQuery.findFirst({
    where: { id: queryId, requirementAssessment: { systemId: system.id, requirementId } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Requirement Query not found" }, { status: 404 });
  }

  const parsed = addMessageSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A message body is required" }, { status: 400 });
  }

  const query = await addQueryMessage(queryId, auth.user.id, parsed.data.body);
  return NextResponse.json({ query }, { status: 201 });
}

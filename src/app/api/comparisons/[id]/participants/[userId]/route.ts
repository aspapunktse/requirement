import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { removeParticipant } from "@/lib/comparison";

/** Removes a participant: the owner or an Admin. Candidates the participant added stay. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/participants/[userId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id, userId } = await ctx.params;
  const result = await removeParticipant(auth.user, id, userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ removed: true });
}

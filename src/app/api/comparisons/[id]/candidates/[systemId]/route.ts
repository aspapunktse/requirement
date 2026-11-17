import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { removeCandidate } from "@/lib/comparison";

/** Removes a Candidate: the owner, an Admin, or the System's owner for their own System. One Change Event on the System. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/candidates/[systemId]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id, systemId } = await ctx.params;
  const result = await removeCandidate(auth.user, id, systemId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ removed: true });
}

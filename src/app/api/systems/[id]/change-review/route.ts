import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { loadChangeReviewView } from "@/lib/change-review";

/** The Change Review panel's data (#334): the System's open Change Review, or `{ changeReview: null }`. 404 for a System the viewer can't see. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/change-review">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  return NextResponse.json({ changeReview: await loadChangeReviewView(auth.user, system.id) });
}

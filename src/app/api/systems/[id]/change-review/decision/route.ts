import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canDecideAtGate } from "@/lib/gate-decisions";
import { changeReviewDecisionSchema, CHANGE_REVIEW_DECISION_REFUSED, decideChangeReview } from "@/lib/change-review";
import { refuseIfSystemClosed } from "@/lib/system-closed";

/**
 * The Business System Owner's decision on the System's open Change Review (#334, PRD 0002 F-CR.2): `{ decision: ACCEPT | REVOKE, comment,
 * sendBackTo?, changeReviewId? }`. ACCEPT closes the review. REVOKE revokes the ATO and sends a staged System back to the stage named
 * (a System on the classic flow takes none and returns to Draft). Only the Business System Owner or an Admin who doesn't own the System:
 * 403 before the body or the review is looked at, 404 for a System they can't see. 409, nothing written, when there is no open review,
 * the System has no Business System Owner yet (F-CR.3) or a group hasn't recommended.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/change-review/decision">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;
  if (!canDecideAtGate(auth.user, system)) return NextResponse.json({ error: CHANGE_REVIEW_DECISION_REFUSED }, { status: 403 });

  const parsed = changeReviewDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid decision" }, { status: 400 });

  const result = await decideChangeReview(system.id, auth.user, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ decision: result.decision, stage: result.stage });
}

import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { checkUpAccess, getCheckUpDetail } from "@/lib/check-up-responses";

/**
 * One Check-up with its questions, its response and what the caller may do with it (F-IA.4, #155).
 * Readable by its recipient (whoever owns the target now) and by the roles that read Internal
 * Audits; everyone else gets 403, and 404 only when no such Check-up exists (an id is not guessable,
 * and the same answer for "not yours" and "not there" would make a missing id look forbidden).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/check-ups/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const checkUp = await getCheckUpDetail(id);
  if (!checkUp) return NextResponse.json({ error: "Check-up not found" }, { status: 404 });

  const access = checkUpAccess(auth.user, checkUp);
  if (!access.canRead) return NextResponse.json({ error: "You can't read this Check-up" }, { status: 403 });
  return NextResponse.json({
    // Only the audit readers see the Risk a Nonconformity opened; the recipient does not (#157).
    checkUp: access.canReadRisk ? checkUp : { ...checkUp, risk: null },
    canAnswer: access.canAnswer,
    canEvaluate: access.canEvaluate,
  });
}

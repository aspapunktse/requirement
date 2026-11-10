import { NextRequest } from "next/server";
import { postGateDecision } from "@/lib/gate-decision-route";

/**
 * The Business System Owner's decision at Qualification (#331, #330, PRD 0002 F-ST.4-5): see `postGateDecision`. 409, nothing written, when the
 * System is closed or isn't at Qualification or the send-back target isn't an earlier stage on its Track.
 * AUTHORIZE is "yes" at Qualification, "proceed" at OG2 and "authorize to operate" at OG3. At OG2, proceeding against an Advise-against
 * Recommendation needs a `justification` (400 without).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/evaluation/qualification-decision">) {
  const { id } = await ctx.params;
  return postGateDecision(request, id, "QUALIFICATION");
}

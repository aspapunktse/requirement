import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canDecideAtGate, decideAtOg3, GATE_DECISION_REFUSED, og3DecisionSchema } from "@/lib/gate-decisions";
import { refuseIfSystemClosed } from "@/lib/system-closed";

/**
 * The Business System Owner's decision at OG3 (#330, PRD 0002 F-ST.5-7): `{ decision: AUTHORIZE | REJECT | SEND_BACK, comment, sendBackTo? }`.
 * Only the System's Business System Owner or an Admin, never on a System they own: 403 before the body or the System's stage is looked
 * at, 404 for a System they can't see. 409, nothing written, when the System is closed, isn't at OG3, already has its authorization
 * or the send-back target isn't an earlier stage on its Track. 400 for a bad body (a comment is required). The decision, the change
 * it makes and its Change Event are one transaction.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/evaluation/og3-decision">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (!canDecideAtGate(auth.user, system)) return NextResponse.json({ error: GATE_DECISION_REFUSED }, { status: 403 });
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const parsed = og3DecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid decision" }, { status: 400 });

  const result = await decideAtOg3(system.id, auth.user, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ decision: result.outcome, stage: result.stage });
}

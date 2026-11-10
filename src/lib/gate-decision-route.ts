import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canDecideAtGate, decideAtGate, GATE_DECISION_REFUSED, gateDecisionSchema, type Gate } from "@/lib/gate-decisions";
import { refuseIfSystemClosed } from "@/lib/system-closed";

/**
 * The handler behind the three gate-decision routes (Qualification, OG2, OG3): `{ decision: AUTHORIZE | REJECT | SEND_BACK, comment,
 * sendBackTo?, justification? }`. Only the System's Business System Owner or an Admin, never on a System they own: 403 before the body or
 * the System's stage is looked at, 404 for a System they can't see, 409 for a closed System. Then the body (400) and `decideAtGate`.
 */
export async function postGateDecision(request: NextRequest, systemId: string, gate: Gate) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const system = await getVisibleSystem(auth.user, systemId);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  const closed = await refuseIfSystemClosed(systemId);
  if (closed) return closed;
  if (!canDecideAtGate(auth.user, system)) return NextResponse.json({ error: GATE_DECISION_REFUSED }, { status: 403 });

  const parsed = gateDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid decision" }, { status: 400 });

  const result = await decideAtGate(system.id, gate, auth.user, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ decision: result.outcome, stage: result.stage });
}

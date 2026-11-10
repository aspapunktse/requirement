import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canSubmit } from "@/lib/system-permissions";
import { submitFirstRound } from "@/lib/evaluation";
import { refuseIfSystemClosed } from "@/lib/system-closed";

/**
 * Submits a staged System's first round, moving it to OG1 (#328, PRD 0002 F-ST.2). The System's owner or an Admin (403 otherwise,
 * before anything is read or written; 404 for a System they can't see). 409 when the System isn't in its first round or something
 * is missing (a Business System Owner, a completed Risk Analysis, an Assessment on a mandatory first-round Control); nothing changes.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/evaluation/submit-first-round">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (!canSubmit(auth.user, system)) {
    return NextResponse.json({ error: "Only the System's owner or an Admin can submit its first round" }, { status: 403 });
  }

  const result = await submitFirstRound(system.id, auth.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ stage: result.stage });
}

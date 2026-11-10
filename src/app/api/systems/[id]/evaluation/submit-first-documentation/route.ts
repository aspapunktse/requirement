import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canSubmit } from "@/lib/system-permissions";
import { submitFirstDocumentation } from "@/lib/evaluation";
import { refuseIfSystemClosed } from "@/lib/system-closed";

/**
 * Submits a staged System's first documentation, moving it to the OAG review (#331, PRD 0002 F-ST.4). The System's owner or an Admin
 * (403 otherwise, before anything is read or written; 404 for a System they can't see). 409 when the System isn't at First documentation or
 * something is missing (a first-documentation Document Requirement not provided); nothing changes.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/evaluation/submit-first-documentation">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;
  if (!canSubmit(auth.user, system)) {
    return NextResponse.json({ error: "Only the System's owner or an Admin can submit its first documentation" }, { status: 403 });
  }

  const result = await submitFirstDocumentation(system.id, auth.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ stage: result.stage });
}

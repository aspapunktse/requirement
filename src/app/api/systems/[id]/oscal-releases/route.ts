import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { isSystemOwnerOrAdmin } from "@/lib/system-permissions";
import { closedRefusalText, refuseIfSystemClosed } from "@/lib/system-closed";
import { createOscalRelease, listOscalReleases } from "@/lib/oscal/releases";

type Ctx = RouteContext<"/api/systems/[id]/oscal-releases">;

/**
 * Lists a System's OSCAL Releases, newest first (#453), without their bytes: number, date, trigger, who made it and the
 * SHA-256 of the zip. Whoever may see the System may list them (404 for an unknown or invisible one, the same answer). A closed
 * System's releases are still listed. `canCreate` says whether the acting user may make one now (the System's owner or an
 * Admin, on a System that isn't closed), so the page can show or hide its button.
 */
export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  const releases = await listOscalReleases(id);
  const closed = system.status === "REJECTED" || system.status === "NOT_SELECTED" || system.evaluationClosedAt !== null;
  return NextResponse.json({ releases, canCreate: !closed && isSystemOwnerOrAdmin(auth.user, system) });
}

/**
 * Makes the System's next OSCAL Release by hand (#453): only the System's owner or an Admin (403 otherwise, nothing changes;
 * 404 for a System the user can't see), and not for a Rejected or Not selected System (409, like the live package). The body is
 * ignored: a release is always of the System's state now. 201 with the new release's summary.
 */
export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (!isSystemOwnerOrAdmin(auth.user, system)) {
    return NextResponse.json({ error: "Only the System's owner or an Admin can make an OSCAL Release" }, { status: 403 });
  }
  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  const result = await createOscalRelease({ systemId: id, actorId: auth.user.id, trigger: "MANUAL" });
  if (result.kind === "not-found") return NextResponse.json({ error: "System not found" }, { status: 404 });
  if (result.kind === "closed") return NextResponse.json({ error: closedRefusalText(result.status) }, { status: 409 });
  return NextResponse.json({ release: result.release }, { status: 201 });
}

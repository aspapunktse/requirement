import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageProviderDependencies } from "@/lib/provider-dependency-rules";
import { removeProviderDependency } from "@/lib/provider-dependencies";

/**
 * Remove a dependency on a Provider (#124). Order: 401, 404 (System not
 * visible), 403 (owner or Admin only), 404 (the System doesn't depend on that
 * Provider). Writes one `CLASSIFICATION_CHANGED` event, plus `"system"` events on
 * whatever it moved; the System's own Assessments are never touched. Returns
 * `{ id }`, the Provider's id.
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/dependencies/[providerId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, providerId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageProviderDependencies(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can remove its Provider dependencies" },
      { status: 403 },
    );
  }

  const result = await removeProviderDependency(system, providerId, auth.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: providerId });
}

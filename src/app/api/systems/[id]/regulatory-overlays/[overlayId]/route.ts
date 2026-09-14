import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import {
  applyOverlayRemoved,
  canManageRegulatoryOverlays,
  getSystemRegulatoryOverlays,
} from "@/lib/system-overlays";

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/regulatory-overlays/[overlayId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, overlayId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageRegulatoryOverlays(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can remove Regulatory Overlays on a Draft System" },
      { status: 403 },
    );
  }

  await applyOverlayRemoved(system, overlayId);

  const regulatoryOverlays = await getSystemRegulatoryOverlays(system.id);
  return NextResponse.json({ regulatoryOverlays });
}

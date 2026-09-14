import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageCapabilities, getSystemCapabilities } from "@/lib/system-capabilities";
import { applyCapabilityRemoved } from "@/lib/capability-fulfillment";

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/capabilities/[capabilityId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, capabilityId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageCapabilities(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can remove Capabilities on a Draft System" },
      { status: 403 },
    );
  }

  await prisma.system.update({
    where: { id: system.id },
    data: { capabilities: { disconnect: { id: capabilityId } } },
  });
  await applyCapabilityRemoved(system, capabilityId);

  const capabilities = await getSystemCapabilities(system.id);
  return NextResponse.json({ capabilities });
}

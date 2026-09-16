import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import {
  applyOverlayDeclared,
  canManageRegulatoryOverlays,
  getSystemRegulatoryOverlays,
} from "@/lib/system-overlays";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/regulatory-overlays">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const regulatoryOverlays = await getSystemRegulatoryOverlays(system.id);
  return NextResponse.json({ regulatoryOverlays });
}

const declareOverlaySchema = z.object({ regulatoryOverlayId: z.string().min(1) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/regulatory-overlays">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageRegulatoryOverlays(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can declare Regulatory Overlays on a Draft System" },
      { status: 403 },
    );
  }

  const parsed = declareOverlaySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A regulatoryOverlayId is required" }, { status: 400 });
  }

  const overlay = await prisma.regulatoryOverlay.findUnique({
    where: { id: parsed.data.regulatoryOverlayId },
  });
  if (!overlay) {
    return NextResponse.json({ error: "Regulatory Overlay not found" }, { status: 400 });
  }

  await applyOverlayDeclared(system, overlay.id, auth.user.id);

  const regulatoryOverlays = await getSystemRegulatoryOverlays(system.id);
  return NextResponse.json({ regulatoryOverlays }, { status: 201 });
}

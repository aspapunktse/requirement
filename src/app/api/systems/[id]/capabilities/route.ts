import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageCapabilities, getSystemCapabilities } from "@/lib/system-capabilities";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/capabilities">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const capabilities = await getSystemCapabilities(system.id);
  return NextResponse.json({ capabilities });
}

const declareCapabilitySchema = z.object({ capabilityId: z.string().min(1) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/capabilities">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageCapabilities(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can declare Capabilities on a Draft System" },
      { status: 403 },
    );
  }

  const parsed = declareCapabilitySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A capabilityId is required" }, { status: 400 });
  }

  const capability = await prisma.capability.findUnique({ where: { id: parsed.data.capabilityId } });
  if (!capability) {
    return NextResponse.json({ error: "Capability not found" }, { status: 400 });
  }

  await prisma.system.update({
    where: { id: system.id },
    data: { capabilities: { connect: { id: capability.id } } },
  });

  const capabilities = await getSystemCapabilities(system.id);
  return NextResponse.json({ capabilities }, { status: 201 });
}

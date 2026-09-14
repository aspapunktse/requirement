import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { changeSystemType } from "@/lib/system-type-change";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }
  return NextResponse.json({ system });
}

const updateSystemSchema = z.object({ systemTypeId: z.string().min(1) });

/** Currently only supports changing a Draft System's SystemType (see #15). */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/systems/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const isOwner = auth.user.role === "SYSTEM_OWNER" && system.ownerId === auth.user.id;
  if (auth.user.role !== "ADMIN" && !isOwner) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can change this System's Type" },
      { status: 403 },
    );
  }

  if (system.status !== "DRAFT") {
    return NextResponse.json(
      { error: "Only a Draft System's Type can be changed" },
      { status: 400 },
    );
  }

  const parsed = updateSystemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A systemTypeId is required" }, { status: 400 });
  }

  const systemType = await prisma.systemType.findUnique({ where: { id: parsed.data.systemTypeId } });
  if (!systemType) {
    return NextResponse.json({ error: "System Type not found" }, { status: 400 });
  }

  const { added, removed } = await changeSystemType(system, systemType.id);

  const updated = await prisma.system.findUnique({
    where: { id: system.id },
    include: { systemType: true, owner: true },
  });

  return NextResponse.json({ system: updated, added, removed });
}

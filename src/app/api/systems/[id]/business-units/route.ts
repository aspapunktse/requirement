import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageBusinessUnits, getSystemBusinessUnits } from "@/lib/business-units";
import { logChangeEvent } from "@/lib/change-events";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/business-units">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const businessUnits = await getSystemBusinessUnits(system.id);
  return NextResponse.json({ businessUnits });
}

const declareBusinessUnitSchema = z.object({ businessUnitId: z.string().min(1) });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/business-units">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageBusinessUnits(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can declare Business Units on a System" },
      { status: 403 },
    );
  }

  const parsed = declareBusinessUnitSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "A businessUnitId is required" }, { status: 400 });
  }

  const businessUnit = await prisma.businessUnit.findUnique({ where: { id: parsed.data.businessUnitId } });
  if (!businessUnit) {
    return NextResponse.json({ error: "Business Unit not found" }, { status: 400 });
  }

  await prisma.system.update({
    where: { id: system.id },
    data: { businessUnits: { connect: { id: businessUnit.id } } },
  });
  await logChangeEvent(
    system.id,
    "CLASSIFICATION_CHANGED",
    `Business Unit "${businessUnit.name}" declared`,
    auth.user.id,
  );

  const businessUnits = await getSystemBusinessUnits(system.id);
  return NextResponse.json({ businessUnits }, { status: 201 });
}

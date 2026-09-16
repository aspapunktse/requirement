import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageBusinessUnits, getSystemBusinessUnits } from "@/lib/business-units";
import { logChangeEvent } from "@/lib/change-events";

export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/business-units/[businessUnitId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, businessUnitId } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageBusinessUnits(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can remove Business Units from a System" },
      { status: 403 },
    );
  }

  const businessUnit = await prisma.businessUnit.findUnique({ where: { id: businessUnitId } });

  await prisma.system.update({
    where: { id: system.id },
    data: { businessUnits: { disconnect: { id: businessUnitId } } },
  });
  await logChangeEvent(
    system.id,
    "CLASSIFICATION_CHANGED",
    `Business Unit "${businessUnit?.name ?? businessUnitId}" removed`,
    auth.user.id,
  );

  const businessUnits = await getSystemBusinessUnits(system.id);
  return NextResponse.json({ businessUnits });
}

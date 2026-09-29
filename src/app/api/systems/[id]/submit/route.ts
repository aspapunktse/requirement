import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canSubmit } from "@/lib/system-permissions";
import { getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { logChangeEvent } from "@/lib/change-events";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/submit">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canSubmit(auth.user, system)) {
    return NextResponse.json({ error: "Only the System Owner or an Admin can submit this System for review" }, { status: 403 });
  }

  if (system.status !== "DRAFT") {
    return NextResponse.json({ error: "Only a Draft System can be submitted for review" }, { status: 400 });
  }

  const unaddressed = await getUnaddressedMandatoryControls(system);
  if (unaddressed.length > 0) {
    const names = unaddressed.map((r) => `${r.code} (${r.title})`).join(", ");
    return NextResponse.json(
      { error: `Cannot submit: mandatory Controls not yet addressed: ${names}` },
      { status: 400 },
    );
  }

  const updated = await prisma.system.update({
    where: { id: system.id },
    data: { status: "IN_REVIEW" },
    include: { deploymentFacets: true, owner: true },
  });
  await logChangeEvent(system.id, "SYSTEM_SUBMITTED", "Submitted for review", auth.user.id);

  return NextResponse.json({ system: updated });
}

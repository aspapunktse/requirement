import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canSubmit } from "@/lib/system-permissions";
import { getUnaddressedMandatoryControls } from "@/lib/control-assessments";
import { logChangeEvent } from "@/lib/change-events";

const NO_SENSITIVITY_LEVEL =
  "Cannot submit: set the System's Sensitivity Level first. It decides which Controls apply, so the review needs it.";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/submit">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canSubmit(auth.user, system)) {
    return NextResponse.json({ error: "Only the System's owner or an Admin can submit this System for review" }, { status: 403 });
  }

  if (system.status !== "DRAFT") {
    return NextResponse.json({ error: "Only a Draft System can be submitted for review" }, { status: 400 });
  }

  if (system.sensitivityLevel === null) {
    return NextResponse.json({ error: NO_SENSITIVITY_LEVEL }, { status: 400 });
  }

  const unaddressed = await getUnaddressedMandatoryControls(system);
  if (unaddressed.length > 0) {
    const names = unaddressed.map((r) => `${r.code} (${r.title})`).join(", ");
    return NextResponse.json(
      { error: `Cannot submit: mandatory Controls not yet addressed: ${names}` },
      { status: 400 },
    );
  }

  // The status change, the new Review Round and the Change Event commit together.
  const updated = await prisma.$transaction(async (tx) => {
    // Guards on Draft so two concurrent submits can't start two rounds.
    const moved = await tx.system.updateMany({
      where: { id: system.id, status: "DRAFT", sensitivityLevel: { not: null } },
      data: { status: "IN_REVIEW" },
    });
    if (moved.count === 0) {
      // Lost a race: another submit, or the Sensitivity Level was cleared since the check above.
      const now = await tx.system.findUnique({ where: { id: system.id }, select: { status: true, sensitivityLevel: true } });
      return now?.status === "DRAFT" && now.sensitivityLevel === null ? "NO_LEVEL" : null;
    }
    await tx.reviewRound.create({ data: { systemId: system.id } });
    await logChangeEvent(system.id, "SYSTEM_SUBMITTED", "Submitted for review", auth.user.id, tx);
    return tx.system.findUniqueOrThrow({
      where: { id: system.id },
      include: { deploymentFacets: true, owner: true },
    });
  });
  if (updated === "NO_LEVEL") {
    return NextResponse.json({ error: NO_SENSITIVITY_LEVEL }, { status: 400 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Only a Draft System can be submitted for review" }, { status: 400 });
  }

  return NextResponse.json({ system: updated });
}

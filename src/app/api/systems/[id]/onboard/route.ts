import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lockSystem } from "@/lib/system-lock";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canMarkOnboarded } from "@/lib/onboarding";
import { logChangeEvent } from "@/lib/change-events";
import { STAGED_SYSTEM_REFUSAL } from "@/lib/evaluation-stages";
import { PROVIDER_TRANSACTION_TIMEOUT_MS, withProviderInheritanceEvents } from "@/lib/provider-inheritance";
import { refuseIfSystemClosed } from "@/lib/system-closed";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/onboard">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canMarkOnboarded(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can mark this System Onboarded" },
      { status: 403 },
    );
  }

  const closed = await refuseIfSystemClosed(id);
  if (closed) return closed;

  // A staged System follows the staged evaluation, not the classic flow (#328): it can be marked Onboarded only once the Business
  // System Owner has authorized it to operate at OG3 (#330), which leaves it Approved (that is what ATO is).
  if (system.evaluationStage !== null && system.evaluationStage !== "OG3") {
    return NextResponse.json({ error: STAGED_SYSTEM_REFUSAL }, { status: 409 });
  }

  if (system.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Only a System with an ATO can be marked Onboarded" },
      { status: 400 },
    );
  }

  const NOT_APPROVED = "Only a System with an ATO can be marked Onboarded";
  // The System is locked first and its status read again, so an ATO revoked meanwhile (a Change Review decision, #437) is refused
  // rather than overwritten. A Provider's Offerings only count while it is Onboarded (F-IN.4), so onboarding one can move the
  // Systems depending on it: those are recorded in the same transaction (#124, F-IN.7).
  const markOnboarded = async (tx: Prisma.TransactionClient) => {
    const current = await tx.system.findUnique({ where: { id: system.id }, select: { status: true, evaluationClosedAt: true } });
    if (!current || current.status !== "APPROVED" || current.evaluationClosedAt) return null;
    const onboarded = await tx.system.update({
      where: { id: system.id },
      data: { status: "ONBOARDED", onboardedAt: new Date() },
      include: { deploymentFacets: true, owner: true },
    });
    await logChangeEvent(system.id, "SYSTEM_ONBOARDED", "Marked Onboarded", auth.user.id, tx);
    return onboarded;
  };

  const updated = await prisma.$transaction(
    async (tx) => {
      await lockSystem(tx, system.id);
      if (!system.isProvider) return markOnboarded(tx);
      const current = await tx.system.findUnique({ where: { id: system.id }, select: { status: true } });
      if (current?.status !== "APPROVED") return null; // nothing to record for a refused onboarding
      return withProviderInheritanceEvents(tx, { providerId: system.id }, () => markOnboarded(tx));
    },
    { timeout: PROVIDER_TRANSACTION_TIMEOUT_MS },
  );
  if (!updated) return NextResponse.json({ error: NOT_APPROVED }, { status: 400 });

  return NextResponse.json({ system: updated });
}

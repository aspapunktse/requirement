import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canMarkOnboarded } from "@/lib/onboarding";
import { logChangeEvent } from "@/lib/change-events";
import { PROVIDER_TRANSACTION_TIMEOUT_MS, withProviderInheritanceEvents } from "@/lib/provider-inheritance";

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

  if (system.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Only an Approved System can be marked Onboarded" },
      { status: 400 },
    );
  }

  const markOnboarded = async (db: Pick<typeof prisma, "system" | "changeEvent">) => {
    const onboarded = await db.system.update({
      where: { id: system.id },
      data: { status: "ONBOARDED", onboardedAt: new Date() },
      include: { deploymentFacets: true, owner: true },
    });
    await logChangeEvent(system.id, "SYSTEM_ONBOARDED", "Marked Onboarded", auth.user.id, db);
    return onboarded;
  };

  // A Provider's Offerings only count while it is Onboarded (F-IN.4), so onboarding one can
  // move the Systems depending on it: those are recorded in the same transaction (#124, F-IN.7).
  const updated = system.isProvider
    ? await prisma.$transaction(
        (tx) => withProviderInheritanceEvents(tx, { providerId: system.id }, () => markOnboarded(tx)),
        { timeout: PROVIDER_TRANSACTION_TIMEOUT_MS },
      )
    : await markOnboarded(prisma);

  return NextResponse.json({ system: updated });
}

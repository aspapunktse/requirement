import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canMarkOnboarded } from "@/lib/onboarding";

const ROLES_ALLOWED_TO_ONBOARD = ["ADMIN", "SYSTEM_OWNER"] as const;

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/onboard">) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_ONBOARD]);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canMarkOnboarded(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System Owner or an Admin can mark this System Onboarded" },
      { status: 403 },
    );
  }

  if (system.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Only an Approved System can be marked Onboarded" },
      { status: 400 },
    );
  }

  const updated = await prisma.system.update({
    where: { id: system.id },
    data: { status: "ONBOARDED", onboardedAt: new Date() },
    include: { systemType: true, owner: true },
  });

  return NextResponse.json({ system: updated });
}

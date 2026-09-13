import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { getUnaddressedMandatoryRequirements } from "@/lib/requirement-assessments";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/submit">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (system.status !== "DRAFT") {
    return NextResponse.json({ error: "Only a Draft System can be submitted for review" }, { status: 400 });
  }

  const unaddressed = await getUnaddressedMandatoryRequirements(system);
  if (unaddressed.length > 0) {
    const names = unaddressed.map((r) => `${r.code} (${r.title})`).join(", ");
    return NextResponse.json(
      { error: `Cannot submit: mandatory Requirements not yet addressed: ${names}` },
      { status: 400 },
    );
  }

  const updated = await prisma.system.update({
    where: { id: system.id },
    data: { status: "IN_REVIEW" },
    include: { systemType: true, owner: true },
  });

  return NextResponse.json({ system: updated });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageProvider, CONTROL_OFFERING_TYPES } from "@/lib/control-offering-rules";
import { createControlOffering, getControlOfferingRow, listControlOfferings } from "@/lib/control-offerings";

/**
 * A Provider's Control Offerings (PRD 0001 F-IN.2, #123), for everyone who can
 * see the System. Each row has the Control, the type, the customer
 * responsibility, whether the Control still applies to the Provider, and the
 * Provider's own Control Assessment status for it (Not Started with no row).
 * `{ isProvider, offerings }`; a System that isn't a Provider has none.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/offerings">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  return NextResponse.json({ isProvider: system.isProvider, offerings: await listControlOfferings(system) });
}

const createOfferingSchema = z.object({
  controlId: z.string().min(1),
  type: z.enum(CONTROL_OFFERING_TYPES),
  customerResponsibility: z.string().nullish(),
});

/**
 * Add an Offering. Order: 401, 404 (System not visible), 403 (the System's owner
 * or an Admin only; a Compliance Manager is refused), 400 (bad body, or Shared
 * without a customer responsibility), 409 (not a Provider), 404 (unknown
 * Control), 409 (the Control doesn't apply to the Provider), 409 (already
 * offered). Returns 201 `{ offering }` in the row shape of GET.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/offerings">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageProvider(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can maintain its Control Offerings" },
      { status: 403 },
    );
  }

  const parsed = createOfferingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A controlId and a type (FULL or SHARED) are required" }, { status: 400 });
  }

  const result = await createControlOffering(system, parsed.data, auth.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const offering = await getControlOfferingRow(system, result.value.offeringId);
  return NextResponse.json({ offering }, { status: 201 });
}

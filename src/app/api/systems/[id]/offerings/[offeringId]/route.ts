import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageProvider, CONTROL_OFFERING_TYPES } from "@/lib/control-offering-rules";
import { getControlOfferingRow, removeControlOffering, updateControlOffering } from "@/lib/control-offerings";

const updateOfferingSchema = z
  .object({
    type: z.enum(CONTROL_OFFERING_TYPES).optional(),
    customerResponsibility: z.string().nullable().optional(),
  })
  .refine((body) => body.type !== undefined || body.customerResponsibility !== undefined);

/**
 * Change an Offering's type and/or customer-responsibility text. Order: 401, 404
 * (System not visible), 403 (owner or Admin only), 400 (bad or empty body), 404
 * (not one of this Provider's Offerings), 400 (the resulting values are refused:
 * a Shared Offering needs a text; Shared to Full clears it). It works even if the
 * Control no longer applies to the Provider. A change that leaves the values as
 * they are writes nothing. Returns `{ offering }` in the row shape of GET.
 */
export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/offerings/[offeringId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, offeringId } = await ctx.params;
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

  const parsed = updateOfferingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send a type and/or a customerResponsibility" }, { status: 400 });
  }

  const result = await updateControlOffering(system, offeringId, parsed.data, auth.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const offering = await getControlOfferingRow(system, offeringId);
  return NextResponse.json({ offering });
}

/**
 * Remove an Offering. Order: 401, 404 (System not visible), 403 (owner or Admin
 * only), 404 (not one of this Provider's Offerings). Returns `{ id }`.
 */
export async function DELETE(
  request: NextRequest,
  ctx: RouteContext<"/api/systems/[id]/offerings/[offeringId]">,
) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id, offeringId } = await ctx.params;
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

  const result = await removeControlOffering(system, offeringId, auth.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: offeringId });
}

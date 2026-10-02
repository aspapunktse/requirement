import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageProvider } from "@/lib/control-offering-rules";
import { setSystemProvider } from "@/lib/control-offerings";

const providerSchema = z.object({ isProvider: z.boolean() });

/**
 * Mark or unmark the System as a Provider (PRD 0001 F-IN.2, #123): the System's
 * owner or an Admin, at any lifecycle stage (a Compliance Manager stays
 * read-only). Order: 401, 404 (not visible), 403, 400, then 409 when unmarking a
 * System that still has Control Offerings. Already in that state is a 200 that
 * writes nothing. A change logs a `CLASSIFICATION_CHANGED` Change Event.
 * Returns `{ isProvider }`.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/provider">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageProvider(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can mark a System as a Provider" },
      { status: 403 },
    );
  }

  const parsed = providerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "isProvider must be true or false" }, { status: 400 });
  }

  const result = await setSystemProvider(system.id, parsed.data.isProvider, auth.user.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ isProvider: result.value.isProvider });
}

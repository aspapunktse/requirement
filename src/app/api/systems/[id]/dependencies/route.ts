import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { canManageProviderDependencies } from "@/lib/provider-dependency-rules";
import { declareProviderDependency, getProviderDependencyRow, listProviderDependencies } from "@/lib/provider-dependencies";

/**
 * The Providers a System depends on (PRD 0001 F-IN.3, #124), for everyone who
 * can see the System. Each has its name, whether it is Onboarded (pending if
 * not), whether the viewer can open it as a System, and its Offerings that match
 * the System's applicable Controls with the Provider's own status of each: all a
 * viewer who can't see the Provider is told about it. `{ dependencies }`.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/dependencies">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  return NextResponse.json({ dependencies: await listProviderDependencies(system, auth.user) });
}

const declareDependencySchema = z.object({ providerId: z.string().min(1) });

/**
 * Declare a dependency on a Provider. Order: 401, 404 (System not visible), 403
 * (the System's owner or an Admin only; a Compliance Manager is refused, with
 * nothing written), 400 (bad body), 409 (itself), 404 (unknown System, found
 * WITHOUT the visibility filter because any Provider can be picked; a System
 * that is not a Provider and that the caller can't see is a 404 too, so its
 * existence doesn't leak), 409 (not a Provider), 409 (already declared), then
 * 201 `{ dependency }` in the row shape of GET. Writes one `CLASSIFICATION_CHANGED`
 * event, plus `"system"` events on whatever it moves (see `declareProviderDependency`).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/dependencies">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  if (!canManageProviderDependencies(auth.user, system)) {
    return NextResponse.json(
      { error: "Only the System's owner or an Admin can declare its Provider dependencies" },
      { status: 403 },
    );
  }

  const parsed = declareDependencySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A providerId is required" }, { status: 400 });
  }

  const result = await declareProviderDependency(system, parsed.data.providerId, auth.user);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const dependency = await getProviderDependencyRow(system, auth.user, parsed.data.providerId);
  return NextResponse.json({ dependency }, { status: 201 });
}

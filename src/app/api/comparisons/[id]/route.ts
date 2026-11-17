import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { comparisonNameSchema, comparisonNeedSchema, deleteComparison, readComparison, updateComparison } from "@/lib/comparison";

/**
 * One Comparison with the limited summary of each Candidate (#372): `{ comparison }`. 404 when it doesn't exist or the
 * acting user can't see it.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const comparison = await readComparison(auth.user, id);
  if (!comparison) return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
  return NextResponse.json({ comparison });
}

const updateSchema = z
  .object({ name: comparisonNameSchema.optional(), need: comparisonNeedSchema.nullable().optional(), ownerId: z.string().min(1).optional() })
  .refine((data) => data.name !== undefined || data.need !== undefined || data.ownerId !== undefined, { message: "Provide a name, need or ownerId to change" });

/**
 * Renames, edits the need, or (an Admin only) changes the owner. Body `{ name?, need?, ownerId? }`. The owner or an Admin (403
 * otherwise, 404 when hidden); 400 for a bad body or a new owner without a System-creating role. Returns `{ comparison }`.
 */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid update", issues: parsed.error.issues }, { status: 400 });
  const result = await updateComparison(auth.user, id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ comparison: result.value });
}

/** Deletes the Comparison and its Candidate and participant rows; the Systems are untouched. The owner or an Admin. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const result = await deleteComparison(auth.user, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ deleted: true });
}

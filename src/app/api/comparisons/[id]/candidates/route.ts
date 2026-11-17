import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { addCandidate, addCandidates, listAddableSystems, MAX_CANDIDATES } from "@/lib/comparison";

const bodySchema = z.union([
  z.object({ systemId: z.string().min(1) }).strict(),
  z.object({ systemIds: z.array(z.string().min(1)).min(1).max(MAX_CANDIDATES * 40) }).strict(),
]);

/**
 * The Systems the acting user may pick as a Candidate of this Comparison, each with the reason it can't be added now (or null),
 * for the Add Candidate picker: `{ systems, full, stagedEvaluation, canCreateSystem }`. 404 when the Comparison is hidden, 403 when
 * the acting user may not add Candidates to it.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/candidates">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const result = await listAddableSystems(auth.user, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ systems: result.systems, full: result.full, stagedEvaluation: result.stagedEvaluation, canCreateSystem: result.canCreateSystem });
}

/**
 * Adds a System as a Candidate. Body `{ systemId }`, or `{ systemIds }` to add several at once, all or nothing. The owner adds a
 * System they can see, a participant one they own, an Admin any (403 for anyone else, 404 when the Comparison is hidden or the owner
 * can't see the System). 409 when the System is not staged, is closed, is already a Candidate, or the Comparison has five; for
 * several, the 409 carries `failures`, a reason for each System that can't be added, and nothing is added. One Change Event per
 * System. Returns 201 `{ candidate }`, or `{ candidates }` for several.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/candidates">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "systemId or systemIds is required" }, { status: 400 });
  if ("systemIds" in parsed.data) {
    const result = await addCandidates(auth.user, id, parsed.data.systemIds);
    if (!result.ok) return NextResponse.json({ error: result.error, ...(result.failures && { failures: result.failures }) }, { status: result.status });
    return NextResponse.json({ candidates: result.value }, { status: 201 });
  }
  const result = await addCandidate(auth.user, id, parsed.data.systemId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ candidate: result.value }, { status: 201 });
}

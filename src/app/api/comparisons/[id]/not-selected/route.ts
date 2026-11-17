import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { closeCandidatesAsNotSelected } from "@/lib/comparison";

const bodySchema = z.object({ systemIds: z.array(z.string().min(1)).min(1).max(5) }).strict();

/**
 * Closes Candidates of a closed Comparison as Not selected, after the outcome was recorded (#376, ADR 0015); the Record outcome dialog
 * does the same with the outcome. Body `{ systemIds }`. The Comparison's owner (for the Candidates they own) or an Admin (any): 403 for
 * anyone else, 404 when the Comparison is hidden; 400 for a bad body or a System that is not a Candidate; 409 when the Comparison is still
 * open, the System is the chosen Candidate, or it is no longer in evaluation (closed, has an ATO or is Onboarded). All or nothing, and a
 * refusal changes nothing. One Change Event per System. Returns `{ closed }`, the number closed.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/not-selected">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const result = await closeCandidatesAsNotSelected(auth.user, id, parsed.data.systemIds);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ closed: result.value.closed });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { recordOutcome, reopenComparison } from "@/lib/comparison";
import { outcomeCommentSchema } from "@/lib/comparison-outcome";

const bodySchema = z
  .object({ chosenSystemId: z.string().min(1).nullable(), comment: outcomeCommentSchema, closeAsNotSelected: z.array(z.string().min(1)).max(5).default([]) })
  .strict();

/**
 * Records the outcome and closes the Comparison (#375). Body `{ chosenSystemId, comment }`: the id of the chosen Candidate, or null for
 * "None chosen"; the comment is required. The owner or an Admin (403 otherwise, 404 when hidden); 400 for a bad body or a System that
 * is not a Candidate; 409 when it is already closed, has fewer than two Candidates, or the chosen Candidate was rejected at a gate. Freezes
 * the Candidates' figures and writes one Change Event on each Candidate. `closeAsNotSelected` (optional) lists Candidates not chosen to close as
 * Not selected in the same transaction (#376): the owner's own Candidates, any for an Admin, only those still in evaluation; one that can't be closed
 * refuses the whole request (403, 409 or 400) and nothing is recorded. Returns `{ recorded: true }`.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/outcome">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid outcome", issues: parsed.error.issues }, { status: 400 });
  const result = await recordOutcome(auth.user, id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ recorded: true });
}

/** Reopens a closed Comparison: clears the outcome and the frozen figures, and writes a Change Event on each Candidate. The owner or an Admin; 409 when it is not closed. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/outcome">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const result = await reopenComparison(auth.user, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ reopened: true });
}

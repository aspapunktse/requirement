import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { canCreateSystem } from "@/lib/system-permissions";
import { comparisonNameSchema, comparisonNeedSchema, createComparison, createComparisonWithCandidates, listComparisons, MAX_CANDIDATES } from "@/lib/comparison";

/** The Comparisons the acting user sees (#372): `{ comparisons }`, newest first. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ comparisons: await listComparisons(auth.user) });
}

const createSchema = z.object({ name: comparisonNameSchema, need: comparisonNeedSchema.optional(), systemIds: z.array(z.string().min(1)).min(1).max(MAX_CANDIDATES * 40).optional() });

/**
 * Creates a Comparison, owned by the acting user. A role that may create a System only (403 otherwise); 400 for a bad
 * body. Body `{ name, need?, systemIds? }`; with `systemIds` the Systems become its Candidates in the same transaction, under the rules of
 * adding a Candidate: when any can't be added the answer is 409 with `failures` and no Comparison is created. Returns 201 `{ comparison }`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!canCreateSystem(auth.user)) {
    return NextResponse.json({ error: "Only a System Owner, Risk Owner or Admin can create a Comparison" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Comparison", issues: parsed.error.issues }, { status: 400 });
  const input = { name: parsed.data.name, need: parsed.data.need ?? null };
  if (parsed.data.systemIds) {
    const result = await createComparisonWithCandidates(auth.user, input, parsed.data.systemIds);
    if (!result.ok) return NextResponse.json({ error: result.error, ...(result.failures && { failures: result.failures }) }, { status: result.status });
    return NextResponse.json({ comparison: result.value }, { status: 201 });
  }
  const comparison = await createComparison(auth.user, input);
  return NextResponse.json({ comparison }, { status: 201 });
}

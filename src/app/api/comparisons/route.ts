import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { canCreateSystem } from "@/lib/system-permissions";
import { comparisonNameSchema, comparisonNeedSchema, createComparison, listComparisons } from "@/lib/comparison";

/** The Comparisons the acting user sees (#372): `{ comparisons }`, newest first. */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json({ comparisons: await listComparisons(auth.user) });
}

const createSchema = z.object({ name: comparisonNameSchema, need: comparisonNeedSchema.optional() });

/**
 * Creates a Comparison, owned by the acting user. A role that may create a System only (403 otherwise); 400 for a bad
 * body. Body `{ name, need? }`. Returns 201 `{ comparison }`.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  if (!canCreateSystem(auth.user)) {
    return NextResponse.json({ error: "Only a System Owner, Risk Owner or Admin can create a Comparison" }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Comparison", issues: parsed.error.issues }, { status: 400 });
  const comparison = await createComparison(auth.user, { name: parsed.data.name, need: parsed.data.need ?? null });
  return NextResponse.json({ comparison }, { status: 201 });
}

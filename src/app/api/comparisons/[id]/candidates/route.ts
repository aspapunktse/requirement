import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticate } from "@/lib/api-authz";
import { addCandidate } from "@/lib/comparison";

const bodySchema = z.object({ systemId: z.string().min(1) });

/**
 * Adds a System as a Candidate. Body `{ systemId }`. The owner adds a System they can see, a participant one they own, an Admin
 * any (403 for anyone else, 404 when the Comparison is hidden or the owner can't see the System). 409 when the System is not
 * staged, is closed, is already a Candidate, or the Comparison has five. One Change Event on the System. Returns 201 `{ candidate }`.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/candidates">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "systemId is required" }, { status: 400 });
  const result = await addCandidate(auth.user, id, parsed.data.systemId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ candidate: result.value }, { status: 201 });
}

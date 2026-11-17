import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { readCandidateClassification } from "@/lib/comparison";

/**
 * The classification a new System can start from, read off Candidate `systemId` of this Comparison: Deployment Facets, Information
 * Types, Sensitivity Level, Integrity and Availability Impact Levels and Framework Scope, by id, and nothing else. Only a
 * Candidate the acting user can open as a System is readable; anything else is 404 (so another owner's Information Types stay hidden).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/comparisons/[id]/candidates/[systemId]/classification">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;
  const { id, systemId } = await ctx.params;
  const result = await readCandidateClassification(auth.user, id, systemId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ classification: result.classification });
}

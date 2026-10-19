import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { getStaleAssessments, getSystemAssessments } from "@/lib/control-assessments";
import { presentAssessmentRows, presentationContextFor, presentStaleAssessments } from "@/lib/assessment-queries";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/assessments">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) {
    return NextResponse.json({ error: "System not found" }, { status: 404 });
  }

  const [assessments, staleAssessments] = await Promise.all([
    getSystemAssessments(system),
    getStaleAssessments(system),
  ]);
  // Queries go out redacted for this viewer (who wrote or resolved one), with a per-row "may raise/resolve" flag.
  const context = await presentationContextFor(auth.user, system);
  return NextResponse.json({
    assessments: await presentAssessmentRows(assessments, auth.user, system, context),
    staleAssessments: await presentStaleAssessments(staleAssessments, auth.user, system, context),
  });
}

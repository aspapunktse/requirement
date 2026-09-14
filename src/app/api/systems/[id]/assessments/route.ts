import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { getStaleAssessments, getSystemAssessments } from "@/lib/requirement-assessments";

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
  return NextResponse.json({ assessments, staleAssessments });
}

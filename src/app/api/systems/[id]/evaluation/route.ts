import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { getVisibleSystem } from "@/lib/system-visibility";
import { loadEvaluationView } from "@/lib/evaluation";

/** The Evaluation tab's data (#328): the stage, the first-round checklist or the OG1 verdicts. 404 for a System the viewer can't see or one that isn't staged. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/systems/[id]/evaluation">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const system = await getVisibleSystem(auth.user, id);
  if (!system) return NextResponse.json({ error: "System not found" }, { status: 404 });

  const evaluation = await loadEvaluationView(auth.user, system.id);
  if (!evaluation) return NextResponse.json({ error: "This System isn't evaluated in stages" }, { status: 404 });
  return NextResponse.json({ evaluation });
}

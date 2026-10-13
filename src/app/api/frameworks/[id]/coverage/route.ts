import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { findVisibleFramework } from "@/lib/frameworks";
import { loadFrameworkCoverage } from "@/lib/framework-coverage";

/**
 * The Framework Coverage view's data: every Requirement with its mapped
 * Controls, derived state (covered / Coverage Gap / accepted gap) and the
 * header counts. Any signed-in user may read a Published Framework; a Draft is
 * a 404 for anyone who can't see Drafts. See #74, PRD 0001 F-OUT.1.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/coverage">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const framework = await findVisibleFramework(auth.user, id);
  if (!framework) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }

  const coverage = await loadFrameworkCoverage(id);
  return NextResponse.json({ framework, ...coverage });
}

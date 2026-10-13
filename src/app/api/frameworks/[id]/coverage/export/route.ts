import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { csvFilename, csvResponse } from "@/lib/csv";
import { findVisibleFramework } from "@/lib/frameworks";
import { loadFrameworkCoverage } from "@/lib/framework-coverage";
import { frameworkCoverageCsv } from "@/lib/framework-coverage-csv";

/**
 * The Framework Coverage view as a CSV download (PRD 0001 F-OUT.5, #151): the whole
 * view, one row per Requirement and mapped Control. Same visibility as the view's
 * JSON route: any signed-in user may download a Published Framework, a Draft is a
 * 404 for anyone who can't see Drafts.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/frameworks/[id]/coverage/export">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const framework = await findVisibleFramework(auth.user, id);
  if (!framework) {
    return NextResponse.json({ error: "Framework not found" }, { status: 404 });
  }

  const { requirements } = await loadFrameworkCoverage(id);
  return csvResponse(
    frameworkCoverageCsv(requirements),
    csvFilename(["coverage", framework.name, framework.version], new Date()),
  );
}

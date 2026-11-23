import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { csvResponse } from "@/lib/csv";
import { loadBoundaryStatement } from "@/lib/boundary-statement";
import { boundaryStatementCsv, boundaryStatementFilename, selectSections } from "@/lib/boundary-statement-export";

/**
 * The Statement of Applicability of one Compliance Boundary as a CSV download (#421, design proposal C): the whole statement, or one
 * Framework's section with `?framework=<id>`. The same rows as the page, from `loadBoundaryStatement`; readable by every signed-in
 * role. 404 for an unknown Boundary or a Framework the Boundary doesn't hold; 409 for a retired Boundary, which has no statement (#424).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/compliance-boundaries/[id]/statement/export">) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const frameworkId = request.nextUrl.searchParams.get("framework");
  const statement = await loadBoundaryStatement(id, auth.user);
  if (!statement) return NextResponse.json({ error: "Compliance Boundary not found" }, { status: 404 });
  if (statement.boundary.retired) return NextResponse.json({ error: "A retired Compliance Boundary has no Statement of Applicability" }, { status: 409 });
  const sections = selectSections(statement, frameworkId);
  if (!sections) return NextResponse.json({ error: "This Compliance Boundary doesn't hold that Framework" }, { status: 404 });

  const whole = frameworkId === null;
  const now = new Date();
  return csvResponse(boundaryStatementCsv(statement, sections, whole, now), boundaryStatementFilename(statement, sections, whole, now));
}

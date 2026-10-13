import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/api-authz";
import { loadStatementOfApplicability } from "@/lib/statement-of-applicability";

/**
 * The Statement of Applicability: every Control in the Control Library exactly
 * once, with whether it is included, its generated inclusion justification and
 * its implementation status (PRD 0001 F-OUT.4, #145). Derived live, read-only,
 * readable by every signed-in role.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if ("response" in auth) return auth.response;

  return NextResponse.json({ rows: await loadStatementOfApplicability() });
}

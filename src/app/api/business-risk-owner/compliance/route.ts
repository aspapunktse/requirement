import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { resolveScopeWhere } from "@/lib/business-risk-owner";
import { getComplianceForSystems } from "@/lib/compliance";

/**
 * Compliance percentage for Systems within the acting user's Business Risk
 * Owner scope, optionally narrowed further by businessUnitId/frameworkId
 * query params (combined, not either/or — see #55). Passing frameworkId
 * also narrows which Requirements count (only ones tagged with that
 * Framework) and applies its strictComplianceRequired rule.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, ["ADMIN", "BUSINESS_RISK_OWNER"]);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const businessUnitId = url.searchParams.get("businessUnitId") ?? undefined;
  const frameworkId = url.searchParams.get("frameworkId") ?? undefined;

  const resolved = await resolveScopeWhere(auth.user, { businessUnitId, frameworkId });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 403 });
  }

  const compliance = await getComplianceForSystems(resolved.where, { frameworkId });
  return NextResponse.json({ compliance });
}

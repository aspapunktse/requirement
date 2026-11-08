import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { resolveScopeWhere } from "@/lib/business-risk-owner";
import { riskSourceSchema } from "@/lib/risk-source";
import { RISK_INCLUDE, SYSTEM_RISK_WHERE } from "@/lib/risks";

/**
 * Risks (ad-hoc and Control-auto-opened alike) for Systems within the
 * acting user's Business Risk Owner scope, optionally narrowed further by
 * businessUnitId/frameworkId query params, and by Risk Source with `source` (#322; an unknown value is 400).
 * Read-only view — see #55.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, ["ADMIN", "BUSINESS_RISK_OWNER"]);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const businessUnitId = url.searchParams.get("businessUnitId") ?? undefined;
  const frameworkId = url.searchParams.get("frameworkId") ?? undefined;

  const sourceParam = url.searchParams.get("source");
  const source = sourceParam ? riskSourceSchema.safeParse(sourceParam) : null;
  if (source && !source.success) {
    return NextResponse.json({ error: "Invalid Risk Source" }, { status: 400 });
  }

  const resolved = await resolveScopeWhere(auth.user, { businessUnitId, frameworkId });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 403 });
  }

  const risks = await prisma.risk.findMany({
    // An Organization Risk has no System and is never listed in a scoped view (#157), whatever the filter.
    where: { ...SYSTEM_RISK_WHERE, system: resolved.where, ...(source && { source: source.data }) },
    include: { ...RISK_INCLUDE, system: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ risks });
}

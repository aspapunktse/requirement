import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorize } from "@/lib/api-authz";
import { resolveScopeWhere } from "@/lib/business-risk-owner";
import { getComplianceForSystems } from "@/lib/compliance";

export type PortfolioSystem = {
  id: string;
  name: string;
  vendor: string | null;
  status: string;
  /** Met ÷ applicable Requirements of the filtered Framework, else the base Framework; null if none apply. */
  compliancePercentage: number | null;
  requirementsMet: number;
  requirementsApplicable: number;
  openRiskCount: number;
};

/**
 * Systems within the acting user's Business Risk Owner scope, optionally
 * narrowed further by businessUnitId/frameworkId query params, each
 * carrying its onboarding status plus a compliance-% and open-Risk-count
 * badge — the "System Portfolio" view on the dashboard. See #62. The
 * compliance-% is the Requirement-based one (#90) for the filtered Framework,
 * or the base Framework when no Framework filter is set.
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

  const [systems, compliance, openRisks] = await Promise.all([
    prisma.system.findMany({
      where: resolved.where,
      select: { id: true, name: true, vendor: true, status: true },
    }),
    getComplianceForSystems(resolved.where, { frameworkId }),
    prisma.risk.groupBy({
      by: ["systemId"],
      where: { status: "OPEN", system: resolved.where },
      _count: { _all: true },
    }),
  ]);

  const complianceBySystemId = new Map(compliance.bySystem.map((s) => [s.systemId, s]));
  const openRiskCountBySystemId = new Map(openRisks.map((r) => [r.systemId, r._count._all]));

  const portfolio: PortfolioSystem[] = systems.map((system) => ({
    id: system.id,
    name: system.name,
    vendor: system.vendor,
    status: system.status,
    compliancePercentage: complianceBySystemId.get(system.id)?.percentage ?? null,
    requirementsMet: complianceBySystemId.get(system.id)?.met ?? 0,
    requirementsApplicable: complianceBySystemId.get(system.id)?.applicable ?? 0,
    openRiskCount: openRiskCountBySystemId.get(system.id) ?? 0,
  }));

  return NextResponse.json({ portfolio });
}

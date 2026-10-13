import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS } from "@/lib/internal-audit-rules";
import { isOnboardingStatus, type SystemFilter } from "@/lib/internal-audit-system-filter";
import { resolveSystemFilter } from "@/lib/internal-audits";
import { internalAuditErrorResponse } from "@/lib/internal-audit-api";

/**
 * The Systems matching a filter, for the draft audit form's preview (#153). Query parameters
 * `frameworkId`, `deploymentFacetId`, `businessUnitId` and `status`, each optional (blank counts
 * as not set); the criteria combine with AND. Nothing is stored and no audit is named: the form adds
 * the result to its picked Systems and the draft keeps those. Internal Auditors only, as they are the
 * only ones who draft audits; the draft-only rule is enforced where the Systems are saved (PATCH).
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const params = request.nextUrl.searchParams;
  const value = (name: string) => params.get(name)?.trim() || undefined;

  const status = value("status");
  if (status && !isOnboardingStatus(status)) {
    return NextResponse.json({ error: "That onboarding status doesn't exist" }, { status: 400 });
  }
  const filter: SystemFilter = {
    frameworkId: value("frameworkId"),
    deploymentFacetId: value("deploymentFacetId"),
    businessUnitId: value("businessUnitId"),
    status: status as SystemFilter["status"],
  };

  try {
    return NextResponse.json({ systems: await resolveSystemFilter(filter) });
  } catch (error) {
    return internalAuditErrorResponse(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { getOrganizationRisks, ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS } from "@/lib/risks";

/**
 * `GET /api/risks?scope=organization`: the Risks that belong to no System (#157), opened by an
 * Organization-level Nonconformity. A Risk Owner, an Admin and an Internal Auditor read them;
 * everyone else is refused (403), the Business Risk Owner included. A System's Risks are
 * `GET /api/systems/[id]/risks`; no other scope exists, so any other value is a 400.
 */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, [...ROLES_ALLOWED_TO_READ_ORGANIZATION_RISKS]);
  if ("response" in auth) return auth.response;

  if (new URL(request.url).searchParams.get("scope") !== "organization") {
    return NextResponse.json({ error: "Only scope=organization is supported" }, { status: 400 });
  }
  return NextResponse.json({ risks: await getOrganizationRisks() });
}

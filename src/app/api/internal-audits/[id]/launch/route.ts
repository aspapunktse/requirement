import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS } from "@/lib/internal-audit-rules";
import { getInternalAudit } from "@/lib/internal-audits";
import { launchInternalAudit, listCheckUps } from "@/lib/check-ups";
import { internalAuditErrorResponse } from "@/lib/internal-audit-api";

/**
 * Launches a draft Internal Audit (F-IA.3, #154): generates the Check-ups and freezes the audit.
 * Internal Auditors only (Admin and Compliance Manager are refused, like everywhere an audit is
 * written). 404 if missing, 409 if it isn't a draft (so launching twice is refused), 400 naming
 * what blocks it (no question, no Control Owner, past due date, nothing to generate), with no DB
 * change. Answers with the launch summary, the audit and its Check-ups.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/internal-audits/[id]/launch">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    const summary = await launchInternalAudit(id, auth.user.id);
    const [internalAudit, checkUps] = await Promise.all([getInternalAudit(id), listCheckUps(id)]);
    return NextResponse.json({ summary, internalAudit, checkUps });
  } catch (error) {
    return internalAuditErrorResponse(error);
  }
}

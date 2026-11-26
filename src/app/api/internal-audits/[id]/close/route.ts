import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS } from "@/lib/internal-audit-rules";
import { getInternalAudit } from "@/lib/internal-audits";
import { closeInternalAudit, makeReleasesAfterClose } from "@/lib/internal-audit-closing";
import { listCheckUps } from "@/lib/check-ups";
import { internalAuditErrorResponse } from "@/lib/internal-audit-api";

/**
 * Closes a launched Internal Audit (F-IA.8, #158): it and its Check-ups, responses, evaluations and
 * withdrawals become read-only for every role. Internal Auditors only (Admin and Compliance Manager
 * are refused, like everywhere an audit is written). 404 if missing, 409 if it isn't launched (a
 * draft is deleted, a closed audit stays closed) or if any Check-up is neither evaluated nor
 * withdrawn, in which case `problems` names each one; no DB change on any refusal. Writes no Change
 * Event. Once closed it makes an OSCAL Release for each System in the audit (#454) outside the close's transaction, so a failing
 * build leaves the audit closed. Answers with the audit and its Check-ups.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/internal-audits/[id]/close">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    await closeInternalAudit(id, auth.user.id);
    // The close has committed. One OSCAL Release per System (#454), each in its own transaction; a failure is logged, never undoes the close.
    await makeReleasesAfterClose(id, auth.user.id);
    const [internalAudit, checkUps] = await Promise.all([getInternalAudit(id), listCheckUps(id)]);
    return NextResponse.json({ internalAudit, checkUps });
  } catch (error) {
    return internalAuditErrorResponse(error);
  }
}

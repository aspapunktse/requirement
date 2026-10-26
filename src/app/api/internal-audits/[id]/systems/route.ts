import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS } from "@/lib/internal-audit-rules";
import { addSystemsToInternalAudit, getInternalAudit } from "@/lib/internal-audits";
import { addSystemsBodySchema, internalAuditErrorResponse, readJson } from "@/lib/internal-audit-api";

/**
 * Adds Systems to a draft Internal Audit, keeping the ones it has (#234, the Systems list's bulk
 * "Add to Internal Audit"). Body `{ systemIds }`, non-empty. Answers `{ added, skipped, internalAudit }`.
 * Internal Auditors only (product-owner decision of 2026-10-25).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/internal-audits/[id]/systems">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = addSystemsBodySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide the Systems to add (systemIds, at least one)" }, { status: 400 });
  }

  try {
    const result = await addSystemsToInternalAudit(id, parsed.data.systemIds);
    return NextResponse.json({ ...result, internalAudit: await getInternalAudit(id) });
  } catch (error) {
    return internalAuditErrorResponse(error);
  }
}

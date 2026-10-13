import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_READ_INTERNAL_AUDITS, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS } from "@/lib/internal-audit-rules";
import { deleteInternalAudit, getInternalAudit, updateInternalAudit } from "@/lib/internal-audits";
import { internalAuditBodySchema, internalAuditErrorResponse, readJson } from "@/lib/internal-audit-api";

/** One Internal Audit with its target Controls and selected Systems. Readable by the reading roles. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/internal-audits/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_READ_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const internalAudit = await getInternalAudit(id);
  if (!internalAudit) return NextResponse.json({ error: "Internal Audit not found" }, { status: 404 });
  return NextResponse.json({ internalAudit });
}

/** Edits a draft; `controlIds` / `systemIds`, when present, replace the set. Internal Auditors only. */
export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/internal-audits/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = internalAuditBodySchema.safeParse(await readJson(request));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Provide at least one valid field to update" }, { status: 400 });
  }

  try {
    await updateInternalAudit(id, parsed.data);
    return NextResponse.json({ internalAudit: await getInternalAudit(id) });
  } catch (error) {
    return internalAuditErrorResponse(error);
  }
}

/** Deletes a draft. Internal Auditors only. */
export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/internal-audits/[id]">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  try {
    await deleteInternalAudit(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return internalAuditErrorResponse(error);
  }
}

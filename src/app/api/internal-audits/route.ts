import { NextRequest, NextResponse } from "next/server";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_READ_INTERNAL_AUDITS, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS } from "@/lib/internal-audit-rules";
import { createInternalAudit, getInternalAudit, listInternalAudits } from "@/lib/internal-audits";
import { internalAuditBodySchema, internalAuditErrorResponse, readJson } from "@/lib/internal-audit-api";

/** Every Internal Audit (title, due date, state, counts). Readable by the reading roles. */
export async function GET(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_READ_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  return NextResponse.json({ internalAudits: await listInternalAudits() });
}

/** Creates a draft Internal Audit. Internal Auditors only: every other role gets 403, Admin included. */
export async function POST(request: NextRequest) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const parsed = internalAuditBodySchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Internal Audit" }, { status: 400 });

  try {
    const id = await createInternalAudit(parsed.data, auth.user.id);
    return NextResponse.json({ internalAudit: await getInternalAudit(id) }, { status: 201 });
  } catch (error) {
    return internalAuditErrorResponse(error);
  }
}

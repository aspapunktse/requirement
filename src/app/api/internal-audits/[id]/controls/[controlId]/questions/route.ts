import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-authz";
import { ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS } from "@/lib/internal-audit-rules";
import { getInternalAudit } from "@/lib/internal-audits";
import { setDraftQuestions } from "@/lib/check-ups";
import { internalAuditErrorResponse, readJson } from "@/lib/internal-audit-api";

const bodySchema = z.object({ questions: z.array(z.string()) });

/**
 * Replaces the ordered question list of one target Control of a draft Internal Audit (F-IA.2,
 * #154): editing, adding, removing and reordering are all this one write. Internal Auditors only;
 * 409 once the audit is launched (or closed), 404 if the audit or that target Control is unknown,
 * 400 for a blank or over-long question.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/internal-audits/[id]/controls/[controlId]/questions">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_WRITE_INTERNAL_AUDITS);
  if ("response" in auth) return auth.response;

  const { id, controlId } = await ctx.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return NextResponse.json({ error: "Provide the questions as a list of texts" }, { status: 400 });

  try {
    await setDraftQuestions(id, controlId, parsed.data.questions);
    const internalAudit = await getInternalAudit(id);
    return NextResponse.json({ questions: internalAudit?.controls.find((c) => c.id === controlId)?.questions ?? [] });
  } catch (error) {
    return internalAuditErrorResponse(error);
  }
}

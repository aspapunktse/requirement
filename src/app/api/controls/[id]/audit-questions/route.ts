import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authorize } from "@/lib/api-authz";
import { replaceAuditQuestions, ROLES_ALLOWED_TO_CURATE_AUDIT_QUESTIONS, validateAuditQuestions } from "@/lib/control-audit-questions";

const bodySchema = z.object({ questions: z.array(z.string()) });

/**
 * Replaces a Control's ordered Audit Questions (#404): adding, editing, removing and reordering are all this
 * one all-or-nothing write. Compliance Manager, Admin and Internal Auditor; anyone else is a 403 and nothing
 * changes. 404 for an unknown Control, 400 for a blank, over-long or repeated question. No Change Event.
 * Existing Internal Audit drafts and launched Check-ups keep their own copies.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/controls/[id]/audit-questions">) {
  const auth = await authorize(request, ROLES_ALLOWED_TO_CURATE_AUDIT_QUESTIONS);
  if ("response" in auth) return auth.response;

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide the Audit Questions as a list of texts" }, { status: 400 });
  const problems = validateAuditQuestions(parsed.data.questions);
  if (problems.length > 0) return NextResponse.json({ error: problems.join("; "), problems }, { status: 400 });

  const questions = await replaceAuditQuestions(id, parsed.data.questions);
  if (!questions) return NextResponse.json({ error: "Control not found" }, { status: 404 });
  return NextResponse.json({ questions });
}

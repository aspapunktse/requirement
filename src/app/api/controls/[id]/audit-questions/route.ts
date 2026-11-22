import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { questionItemsSchema, splitQuestionItems } from "@/lib/check-up-rules";
import { authorize } from "@/lib/api-authz";
import { replaceAuditQuestions, ROLES_ALLOWED_TO_CURATE_AUDIT_QUESTIONS, validateAuditQuestions } from "@/lib/control-audit-questions";

const bodySchema = z.object({ questions: questionItemsSchema });

/**
 * Replaces a Control's ordered Audit Questions (#404). Each item is a text or `{ text, guidance? }` (#405): the optional
 * guidance note is trimmed, empty means none, and over 1,000 characters is a 400. The response lists `questions` and,
 * in the same order, their `guidance` (null for none). Adding, editing, removing and reordering are all this
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
  const { texts, guidance } = splitQuestionItems(parsed.data.questions);
  const problems = validateAuditQuestions(texts, guidance);
  if (problems.length > 0) return NextResponse.json({ error: problems.join("; "), problems }, { status: 400 });

  const questions = await replaceAuditQuestions(id, texts, guidance);
  if (!questions) return NextResponse.json({ error: "Control not found" }, { status: 404 });
  return NextResponse.json({ questions: questions.map((q) => q.text), guidance: questions.map((q) => q.guidance) });
}

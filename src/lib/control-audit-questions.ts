import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MAX_QUESTION_LENGTH, MAX_QUESTIONS_PER_CONTROL } from "@/lib/check-up-rules";

/**
 * Audit Questions (#404): a Control's standing, ordered questions an Internal Auditor verifies it with. Curated
 * in the Control Library by the Compliance Manager, the Admin and the Internal Auditor (product-owner decision
 * 3), whatever the Control's scope; a Change Event is not written (decision 8). A new Internal Audit draft
 * starts from a copy of them (`defaultQuestionsForControl`); the draft keeps its own copy.
 */
export const ROLES_ALLOWED_TO_CURATE_AUDIT_QUESTIONS: UserRole[] = ["COMPLIANCE_MANAGER", "ADMIN", "INTERNAL_AUDITOR"];

export function canCurateAuditQuestions(user: { role: UserRole }): boolean {
  return ROLES_ALLOWED_TO_CURATE_AUDIT_QUESTIONS.includes(user.role);
}

/**
 * Why `questions` isn't an acceptable Audit Question list for one Control, one message per problem (empty when
 * fine). The text is compared trimmed, so "Is MFA on?" and " Is MFA on? " are the same question. The route and
 * the editor share this. The cap is the one a draft has per Control, since a draft starts as a copy of the list.
 */
export function validateAuditQuestions(questions: string[]): string[] {
  const problems: string[] = [];
  const texts = questions.map((text) => text.trim());
  if (texts.length > MAX_QUESTIONS_PER_CONTROL) problems.push(`A Control can have at most ${MAX_QUESTIONS_PER_CONTROL} Audit Questions`);
  if (texts.some((text) => text === "")) problems.push("An Audit Question can't be blank");
  if (texts.some((text) => text.length > MAX_QUESTION_LENGTH)) problems.push(`An Audit Question can be at most ${MAX_QUESTION_LENGTH} characters`);
  if (new Set(texts.filter((text) => text !== "")).size < texts.filter((text) => text !== "").length) {
    problems.push("The same Audit Question is listed twice");
  }
  return problems;
}

/** One Control's Audit Questions in order, on the caller's transaction client. */
export async function listAuditQuestions(tx: Prisma.TransactionClient, controlId: string): Promise<string[]> {
  const rows = await tx.controlAuditQuestion.findMany({ where: { controlId }, orderBy: { position: "asc" }, select: { text: true } });
  return rows.map((row) => row.text);
}

/**
 * Replaces the whole ordered list in one transaction (add, edit, remove and reorder are all this one write).
 * Returns the saved list, or null when the Control doesn't exist. `questions` must already have passed
 * `validateAuditQuestions`.
 */
export async function replaceAuditQuestions(controlId: string, questions: string[]): Promise<string[] | null> {
  const texts = questions.map((text) => text.trim());
  return prisma.$transaction(async (tx) => {
    const control = await tx.control.findUnique({ where: { id: controlId }, select: { id: true } });
    if (!control) return null;
    await tx.controlAuditQuestion.deleteMany({ where: { controlId } });
    await tx.controlAuditQuestion.createMany({ data: texts.map((text, index) => ({ controlId, position: index + 1, text })) });
    return texts;
  });
}

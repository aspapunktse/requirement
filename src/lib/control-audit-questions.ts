import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guidanceProblem, MAX_QUESTION_LENGTH, MAX_QUESTIONS_PER_CONTROL, normalizeGuidance, type GuidedQuestion } from "@/lib/check-up-rules";

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
export function validateAuditQuestions(questions: string[], guidance: (string | null | undefined)[] = []): string[] {
  const problems: string[] = [];
  for (const problem of new Set(guidance.map(guidanceProblem))) if (problem) problems.push(problem);
  const texts = questions.map((text) => text.trim());
  if (texts.length > MAX_QUESTIONS_PER_CONTROL) problems.push(`A Control can have at most ${MAX_QUESTIONS_PER_CONTROL} Audit Questions`);
  if (texts.some((text) => text === "")) problems.push("An Audit Question can't be blank");
  if (texts.some((text) => text.length > MAX_QUESTION_LENGTH)) problems.push(`An Audit Question can be at most ${MAX_QUESTION_LENGTH} characters`);
  if (new Set(texts.filter((text) => text !== "")).size < texts.filter((text) => text !== "").length) {
    problems.push("The same Audit Question is listed twice");
  }
  return problems;
}

/** One Control's Audit Questions in order, with their guidance notes (#405), on the caller's transaction client. */
export async function listAuditQuestions(tx: Prisma.TransactionClient, controlId: string): Promise<GuidedQuestion[]> {
  return tx.controlAuditQuestion.findMany({ where: { controlId }, orderBy: { position: "asc" }, select: { text: true, guidance: true } });
}

/**
 * Replaces the whole ordered list in one transaction (add, edit, remove and reorder are all this one write).
 * Returns the saved list, or null when the Control doesn't exist. `questions` (and the optional `guidance`
 * notes, by index; trimmed, empty stored as none) must already have passed `validateAuditQuestions`.
 */
export async function replaceAuditQuestions(controlId: string, questions: string[], guidance: (string | null | undefined)[] = []): Promise<GuidedQuestion[] | null> {
  const items = questions.map((text, index): GuidedQuestion => ({ text: text.trim(), guidance: normalizeGuidance(guidance[index]) }));
  return prisma.$transaction(async (tx) => {
    // Lock the Control row so two simultaneous replaces for it run one after the other (else both delete, then both
    // insert, and the second hits the (controlId, position) unique index). No row means no such Control.
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Control" WHERE id = ${controlId} FOR UPDATE`;
    if (locked.length === 0) return null;
    await tx.controlAuditQuestion.deleteMany({ where: { controlId } });
    await tx.controlAuditQuestion.createMany({ data: items.map(({ text, guidance }, index) => ({ controlId, position: index + 1, text, guidance })) });
    return items;
  });
}

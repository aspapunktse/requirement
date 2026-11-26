import type { Prisma } from "@prisma/client";
import type { prisma } from "@/lib/prisma";
import { toEvidenceView } from "@/lib/evidence";

/** The include that reads an Assessment's Evidence records, oldest collected first, with what the download link needs. */
export const EVIDENCE_INCLUDE = {
  include: { systemDocument: { select: { documentRequirementId: true } } },
  orderBy: [{ collectedAt: "asc" }, { id: "asc" }],
} satisfies Prisma.ControlAssessment$evidenceItemsArgs;

/** The Evidence records of one Assessment, oldest collected first. */
export async function listEvidence(db: Pick<typeof prisma, "evidenceItem">, assessmentId: string, validityMonths: number | null, now: Date) {
  const items = await db.evidenceItem.findMany({
    where: { controlAssessmentId: assessmentId },
    ...EVIDENCE_INCLUDE,
  });
  return items.map((item) => toEvidenceView(item, validityMonths, now));
}

import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { normalizeExclusionJustification } from "@/lib/statement-of-applicability-rules";

/** The longest old or new text kept in a Change Event detail (the same cap as a removed Assessment's text). */
export const EXCLUSION_JUSTIFICATION_AUDIT_TEXT_LIMIT = 200;

function truncateForAudit(text: string) {
  return text.length > EXCLUSION_JUSTIFICATION_AUDIT_TEXT_LIMIT
    ? `${text.slice(0, EXCLUSION_JUSTIFICATION_AUDIT_TEXT_LIMIT)}…`
    : text;
}

function quoted(text: string | null) {
  return text === null ? "none" : `"${truncateForAudit(text)}"`;
}

export function describeExclusionJustificationChange(controlCode: string, from: string | null, to: string | null) {
  return `Statement of Applicability exclusion justification changed: Control ${controlCode} (${quoted(from)} → ${quoted(to)})`;
}

/**
 * Stores `text` (already normalized) as the Control's exclusion justification and writes
 * one System-less SOA_JUSTIFICATION_CHANGED Change Event, in one transaction. Writes nothing
 * when the stored text already equals `text`. Returns whether anything changed, or null when
 * the Control does not exist.
 */
export async function saveExclusionJustification(controlId: string, text: string | null, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const control = await tx.control.findUnique({
      where: { id: controlId },
      select: { code: true, soaExclusionJustification: true },
    });
    if (!control) return null;
    const from = normalizeExclusionJustification(control.soaExclusionJustification);
    if (from === text) return { changed: false };
    await tx.control.update({ where: { id: controlId }, data: { soaExclusionJustification: text } });
    await logChangeEvent(null, "SOA_JUSTIFICATION_CHANGED", describeExclusionJustificationChange(control.code, from, text), actorId, tx);
    return { changed: true };
  });
}

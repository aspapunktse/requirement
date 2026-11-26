/**
 * Evidence records (#455): when a piece of Evidence expires, and how it is shown. Pure, no database, no clock of its own.
 *
 * The effective expiry is the person's own `expiresAt` when they set one, else the Control's `evidenceValidityMonths` after
 * `collectedAt`; a Control with no period (null) never expires its Evidence, and neither does Evidence with no override on it.
 */

/** The Evidence fields the expiry rule reads. */
export type EvidenceDates = { collectedAt: Date; expiresAt: Date | null };

/** `date` plus `months` calendar months in UTC, the day clamped to the target month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** When the Evidence expires: the override, else collected + the Control's validity period, else never (null). */
export function effectiveExpiry(evidence: EvidenceDates, validityMonths: number | null): Date | null {
  if (evidence.expiresAt) return evidence.expiresAt;
  if (validityMonths === null || validityMonths <= 0) return null;
  return addMonthsUtc(evidence.collectedAt, validityMonths);
}

/** Expired (stale) at `now`: an effective expiry at or before it. */
export function isEvidenceStale(evidence: EvidenceDates, validityMonths: number | null, now: Date): boolean {
  const expiry = effectiveExpiry(evidence, validityMonths);
  return expiry !== null && expiry.getTime() <= now.getTime();
}

/** The most months a validity period may be set to (50 years): a sanity bound, not a rule of the product. */
export const MAX_EVIDENCE_VALIDITY_MONTHS = 600;

/** http(s) URLs in free text, without trailing punctuation (the migration's rule, in TypeScript). */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/g)].map((m) => m[0].replace(/[.,;:!?)\]]+$/, "")).filter((u) => /^https?:\/\/[^/]+/.test(u));
}

/** Whether an Evidence note says anything beyond the URLs that are already Evidence records (`recordUrls`). */
export function noteHasTextBeyondUrls(note: string, recordUrls: string[]): boolean {
  let rest = note;
  for (const url of urlsIn(note)) if (recordUrls.includes(url)) rest = rest.split(url).join(" ");
  return /[\p{L}\p{N}]/u.test(rest);
}

/** The wire shape of one Evidence record, as the API and the System page give it (dates as ISO strings). */
export type EvidenceItemView = {
  id: string;
  kind: "LINK" | "DOCUMENT";
  url: string | null;
  title: string | null;
  /** DOCUMENT: the System's document it points at; null when it has since been deleted. */
  systemDocumentId: string | null;
  /** DOCUMENT: the Document Requirement the file belongs to, for the download link. */
  documentRequirementId: string | null;
  /** DOCUMENT: the document's external link, for one with no stored file. */
  documentLink: string | null;
  /** DOCUMENT: whether a file is stored, i.e. the download endpoint has something to serve. */
  documentHasFile: boolean;
  collectedAt: string;
  /** The person's own override, if any. */
  expiresAt: string | null;
  /** Override, else collected + the Control's period; null = never. */
  effectiveExpiresAt: string | null;
  stale: boolean;
};

export function toEvidenceView(
  item: { id: string; kind: "LINK" | "DOCUMENT"; url: string | null; title: string | null; systemDocumentId: string | null; collectedAt: Date; expiresAt: Date | null; systemDocument?: { documentRequirementId: string; link: string | null; file: { id: string } | null } | null },
  validityMonths: number | null,
  now: Date,
): EvidenceItemView {
  const expiry = effectiveExpiry(item, validityMonths);
  return {
    id: item.id,
    kind: item.kind,
    url: item.url,
    title: item.title,
    systemDocumentId: item.systemDocumentId,
    documentRequirementId: item.systemDocument?.documentRequirementId ?? null,
    documentLink: item.systemDocument?.link ?? null,
    documentHasFile: item.systemDocument?.file != null,
    collectedAt: item.collectedAt.toISOString(),
    expiresAt: item.expiresAt?.toISOString() ?? null,
    effectiveExpiresAt: expiry?.toISOString() ?? null,
    stale: expiry !== null && expiry.getTime() <= now.getTime(),
  };
}

/**
 * The wording and plain rules of "About the system" (#357), free of server code so the interview and the
 * System page can import them in the browser. The zod schema the API checks requests with is in
 * `src/lib/vendor-details.ts`.
 */

export const TEXT_MAX = 200;
export const URL_MAX = 2000;
export const NOTICE_PERIOD_MAX_MONTHS = 120;

export const DATA_LOCATIONS = ["SWEDEN", "EU_EEA", "OUTSIDE_EU_EEA", "UNKNOWN"] as const;
export type DataLocationValue = (typeof DATA_LOCATIONS)[number];

export const DATA_PROCESSING_AGREEMENTS = ["SIGNED", "IN_PROGRESS", "NOT_SIGNED", "NOT_NEEDED"] as const;
export type DataProcessingAgreementValue = (typeof DATA_PROCESSING_AGREEMENTS)[number];

export const DATA_LOCATION_LABELS: Record<DataLocationValue, string> = {
  SWEDEN: "Sweden",
  EU_EEA: "EU/EEA",
  OUTSIDE_EU_EEA: "Outside the EU/EEA",
  UNKNOWN: "Don't know yet",
};

export const DATA_PROCESSING_AGREEMENT_LABELS: Record<DataProcessingAgreementValue, string> = {
  SIGNED: "Signed",
  IN_PROGRESS: "In progress",
  NOT_SIGNED: "Not signed",
  NOT_NEEDED: "Not needed (no personal data)",
};

export const VENDOR_DETAILS_REQUIRED_MESSAGE = "A System delivered as a service needs its vendor name and service URL";

/** True for an absolute `http:` or `https:` URL, and nothing else (`javascript:`, `ftp:`, `data:` are refused). */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** A calendar date as `YYYY-MM-DD` that really exists. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The two details a System with a "needs vendor details" Deployment Facet must have; empty when both are given. */
export function missingVendorDetails(details: { vendor?: string | null; serviceUrl?: string | null }): ("vendor" | "serviceUrl")[] {
  const missing: ("vendor" | "serviceUrl")[] = [];
  if (!details.vendor?.trim()) missing.push("vendor");
  if (!details.serviceUrl?.trim()) missing.push("serviceUrl");
  return missing;
}

/** The "About the system" details as the text of their inputs (an empty string is "not set"). */
export type AboutFieldTexts = {
  vendor: string;
  vendorWebsiteUrl: string;
  serviceUrl: string;
  productPlan: string;
  vendorTrustUrl: string;
  contractReference: string;
  contractRenewalDate: string;
  noticePeriodMonths: string;
};

const URL_FIELDS = [
  ["vendorWebsiteUrl", "Vendor website"],
  ["serviceUrl", "Service URL"],
  ["vendorTrustUrl", "Vendor trust or security page"],
] as const;

/**
 * The first thing wrong with the "About the system" texts, or null: the same rules the API enforces, so a
 * mistake is caught before the request. `needsVendorDetails` makes vendor name and service URL required.
 */
export function validateAboutTexts(texts: AboutFieldTexts, needsVendorDetails: boolean): string | null {
  if (texts.vendor.trim().length > TEXT_MAX) return `Vendor can be at most ${TEXT_MAX} characters`;
  for (const [key, label] of URL_FIELDS) {
    const value = texts[key].trim();
    if (value !== "" && !isHttpUrl(value)) return `${label} must be a web address starting with http:// or https://`;
  }
  if (texts.productPlan.trim().length > TEXT_MAX) return `Product and plan can be at most ${TEXT_MAX} characters`;
  if (texts.contractReference.trim().length > TEXT_MAX) return `Contract reference can be at most ${TEXT_MAX} characters`;
  if (texts.contractRenewalDate !== "" && !isCalendarDate(texts.contractRenewalDate)) return "Contract renewal date must be a date";
  const notice = texts.noticePeriodMonths.trim();
  if (notice !== "" && !(/^\d+$/.test(notice) && Number(notice) <= NOTICE_PERIOD_MAX_MONTHS)) {
    return `Notice period must be a whole number of months, 0 to ${NOTICE_PERIOD_MAX_MONTHS}`;
  }
  if (needsVendorDetails && missingVendorDetails(texts).length > 0) return VENDOR_DETAILS_REQUIRED_MESSAGE;
  return null;
}

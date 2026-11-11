import { z } from "zod";
import {
  DATA_LOCATIONS,
  DATA_PROCESSING_AGREEMENTS,
  NOTICE_PERIOD_MAX_MONTHS,
  TEXT_MAX,
  URL_MAX,
  isCalendarDate,
  isHttpUrl,
} from "@/lib/vendor-detail-labels";

/**
 * "About the system" (#357): the zod fields for the vendor, service, data location and contract details a
 * System carries, shared by `POST /api/systems` and `PATCH /api/systems/[id]/details`. Every field is
 * optional; vendor name and service URL become required for a System that declares a Deployment Facet with
 * `requiresVendorDetails` (see `missingVendorDetails`, checked by both routes). Wording and plain helpers
 * are in `vendor-detail-labels.ts`.
 */

/** Optional text: trimmed, and empty after trimming means "not set" (null). */
export const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

/** An optional http(s) URL: trimmed, empty means "not set" (null). */
const optionalUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(URL_MAX, `${label} can be at most ${URL_MAX} characters`)
    .refine((value) => value === "" || isHttpUrl(value), `${label} must be a web address starting with http:// or https://`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const vendorDetailFields = {
  vendor: optionalText(TEXT_MAX, "Vendor"),
  vendorWebsiteUrl: optionalUrl("Vendor website"),
  serviceUrl: optionalUrl("Service URL"),
  productPlan: optionalText(TEXT_MAX, "Product and plan"),
  vendorTrustUrl: optionalUrl("Vendor trust or security page"),
  dataLocation: z.enum(DATA_LOCATIONS, { message: "Data location must be one of the listed choices" }).nullable().optional(),
  dataProcessingAgreement: z
    .enum(DATA_PROCESSING_AGREEMENTS, { message: "Data processing agreement must be one of the listed choices" })
    .nullable()
    .optional(),
  contractReference: optionalText(TEXT_MAX, "Contract reference"),
  contractRenewalDate: z
    .string()
    .trim()
    .refine((value) => value === "" || isCalendarDate(value), "Contract renewal date must be a date as YYYY-MM-DD")
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
  noticePeriodMonths: z
    .number({ message: "Notice period must be a whole number of months" })
    .int("Notice period must be a whole number of months")
    .min(0, "Notice period can't be negative")
    .max(NOTICE_PERIOD_MAX_MONTHS, `Notice period can be at most ${NOTICE_PERIOD_MAX_MONTHS} months`)
    .nullable()
    .optional(),
};

export type VendorDetailKey = keyof typeof vendorDetailFields;
export const VENDOR_DETAIL_KEYS = Object.keys(vendorDetailFields) as VendorDetailKey[];

/** `contractRenewalDate` as stored (a Date at UTC midnight) back to `YYYY-MM-DD`. */
export function dayString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** `YYYY-MM-DD` to the Date stored in the `@db.Date` column. */
export function dayDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

import { z } from "zod";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { canChangeSystemClassification } from "@/lib/system-classification-change";
import {
  DATA_LOCATION_LABELS,
  DATA_PROCESSING_AGREEMENT_LABELS,
  VENDOR_DETAILS_REQUIRED_MESSAGE,
  type DataLocationValue,
  type DataProcessingAgreementValue,
} from "@/lib/vendor-detail-labels";
import {
  VENDOR_DETAIL_KEYS,
  dayDate,
  dayString,
  optionalText,
  vendorDetailFields,
} from "@/lib/vendor-details";

export const NAME_MAX = 200;
export const VENDOR_MAX = 200;
export const DESCRIPTION_MAX = 2000;

/**
 * The body of `PATCH /api/systems/[id]/details` (#246, #357). A field left out is left unchanged; a text,
 * URL or date that is empty after trimming (or null) is cleared. The details are the name, vendor and
 * description and the "About the system" fields (vendor website, service URL, product and plan, vendor trust
 * page, data location, data processing agreement, contract reference, renewal date and notice period).
 */
export const systemDetailsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(NAME_MAX, `Name can be at most ${NAME_MAX} characters`)
      .optional(),
    description: optionalText(DESCRIPTION_MAX, "Description"),
    ...vendorDetailFields,
  })
  .refine((data) => data.name !== undefined || data.description !== undefined || VENDOR_DETAIL_KEYS.some((key) => data[key] !== undefined), {
    message: "Provide at least one detail to change",
  });

export type SystemDetailsChanges = z.infer<typeof systemDetailsSchema>;

/** A System's details as the API and the page show them: the renewal date as `YYYY-MM-DD`. */
export type SystemDetails = {
  name: string;
  description: string | null;
  vendor: string | null;
  vendorWebsiteUrl: string | null;
  serviceUrl: string | null;
  productPlan: string | null;
  vendorTrustUrl: string | null;
  dataLocation: DataLocationValue | null;
  dataProcessingAgreement: DataProcessingAgreementValue | null;
  contractReference: string | null;
  contractRenewalDate: string | null;
  noticePeriodMonths: number | null;
};

type DetailKey = keyof SystemDetails;

const SHOWN_MAX = 120;

function shown(key: DetailKey, value: SystemDetails[DetailKey]) {
  if (value === null) return "Not set";
  if (key === "dataLocation") return DATA_LOCATION_LABELS[value as DataLocationValue];
  if (key === "dataProcessingAgreement") return DATA_PROCESSING_AGREEMENT_LABELS[value as DataProcessingAgreementValue];
  if (key === "noticePeriodMonths") return `${value} ${value === 1 ? "month" : "months"}`;
  const flat = String(value).replace(/\s+/g, " ");
  return `"${flat.length > SHOWN_MAX ? `${flat.slice(0, SHOWN_MAX)}…` : flat}"`;
}

const FIELDS: { key: DetailKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "vendor", label: "Vendor" },
  { key: "description", label: "Description" },
  { key: "vendorWebsiteUrl", label: "Vendor website" },
  { key: "serviceUrl", label: "Service URL" },
  { key: "productPlan", label: "Product and plan" },
  { key: "vendorTrustUrl", label: "Vendor trust page" },
  { key: "dataLocation", label: "Data location" },
  { key: "dataProcessingAgreement", label: "Data processing agreement" },
  { key: "contractReference", label: "Contract reference" },
  { key: "contractRenewalDate", label: "Contract renewal date" },
  { key: "noticePeriodMonths", label: "Notice period" },
];

/**
 * What an edit changes, as the Change Event's detail: `Name: "Old" → "New"; Vendor: "Not set" → "Acme"`.
 * Long values are cut at 120 characters so the timeline stays readable. Null when nothing differs.
 */
export function describeDetailsChange(before: SystemDetails, changes: SystemDetailsChanges): { data: Partial<SystemDetails>; detail: string } | null {
  const data: Record<string, unknown> = {};
  const parts: string[] = [];
  for (const { key, label } of FIELDS) {
    const next = changes[key];
    if (next === undefined || next === before[key]) continue;
    data[key] = next;
    parts.push(`${label}: ${shown(key, before[key])} → ${shown(key, next)}`);
  }
  return parts.length === 0 ? null : { data: data as Partial<SystemDetails>, detail: parts.join("; ") };
}

export type SaveDetailsResult =
  | { status: 200; system: SystemDetails & { id: string } }
  | { status: 400; error: string }
  | { status: 403 | 404 };

const DETAIL_SELECT = {
  name: true,
  description: true,
  vendor: true,
  vendorWebsiteUrl: true,
  serviceUrl: true,
  productPlan: true,
  vendorTrustUrl: true,
  dataLocation: true,
  dataProcessingAgreement: true,
  contractReference: true,
  contractRenewalDate: true,
  noticePeriodMonths: true,
} as const;

type DetailRow = Omit<SystemDetails, "contractRenewalDate"> & { contractRenewalDate: Date | null };

/** A System row's details with the renewal date as `YYYY-MM-DD`. */
export function toSystemDetails(row: DetailRow): SystemDetails {
  return {
    name: row.name,
    description: row.description,
    vendor: row.vendor,
    vendorWebsiteUrl: row.vendorWebsiteUrl,
    serviceUrl: row.serviceUrl,
    productPlan: row.productPlan,
    vendorTrustUrl: row.vendorTrustUrl,
    dataLocation: row.dataLocation,
    dataProcessingAgreement: row.dataProcessingAgreement,
    contractReference: row.contractReference,
    contractRenewalDate: dayString(row.contractRenewalDate),
    noticePeriodMonths: row.noticePeriodMonths,
  };
}

/**
 * Saves a System's details and its Change Event in one transaction. The System row is locked first
 * (`FOR UPDATE`), so overlapping saves run one after the other and each diffs against what the one before
 * wrote, and the owner is re-read under the lock: this is the authoritative permission check, since the
 * route's earlier one can be stale by the time it gets here (an Admin may have handed the System over).
 *
 * The vendor rule (#357) is checked under the same lock, against the System's Deployment Facets as they are
 * now: when one of them has `requiresVendorDetails`, an edit that clears the vendor name or the service URL
 * is refused (400) and nothing is written. A System that never had them is not blocked by edits to other
 * details; only actually clearing a value that is there is refused. Every query uses `tx`.
 */
export async function saveSystemDetails(
  actor: { id: string; role: UserRole },
  systemId: string,
  changes: SystemDetailsChanges,
): Promise<SaveDetailsResult> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "System" WHERE "id" = ${systemId} FOR UPDATE`;
    if (locked.length === 0) return { status: 404 };
    const row = await tx.system.findUnique({
      where: { id: systemId },
      select: { id: true, ownerId: true, ...DETAIL_SELECT, deploymentFacets: { select: { requiresVendorDetails: true } } },
    });
    if (!row) return { status: 404 };
    if (!canChangeSystemClassification(actor, row)) return { status: 403 };
    const current = toSystemDetails(row);
    const change = describeDetailsChange(current, changes);
    if (!change) return { status: 200, system: { id: row.id, ...current } };

    const needsVendorDetails = row.deploymentFacets.some((facet) => facet.requiresVendorDetails);
    const clears = change.data.vendor === null || change.data.serviceUrl === null;
    if (needsVendorDetails && clears) return { status: 400, error: VENDOR_DETAILS_REQUIRED_MESSAGE };

    const { contractRenewalDate, ...rest } = change.data;
    const updated = await tx.system.update({
      where: { id: row.id },
      data: {
        ...rest,
        ...(contractRenewalDate !== undefined && { contractRenewalDate: contractRenewalDate === null ? null : dayDate(contractRenewalDate) }),
      },
      select: { id: true, ...DETAIL_SELECT },
    });
    await logChangeEvent(row.id, "SYSTEM_DETAILS_CHANGED", change.detail, actor.id, tx);
    return { status: 200, system: { id: updated.id, ...toSystemDetails(updated) } };
  });
}

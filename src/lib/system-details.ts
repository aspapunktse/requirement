import { z } from "zod";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";
import { canChangeSystemClassification } from "@/lib/system-classification-change";

export const NAME_MAX = 200;
export const VENDOR_MAX = 200;
export const DESCRIPTION_MAX = 2000;

/** Optional text: trimmed, and empty after trimming means "not set" (null). */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} can be at most ${max} characters`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

/**
 * The body of `PATCH /api/systems/[id]/details` (#246). A field left out is left unchanged; a vendor or
 * description that is empty after trimming (or null) is cleared.
 */
export const systemDetailsSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(NAME_MAX, `Name can be at most ${NAME_MAX} characters`)
      .optional(),
    vendor: optionalText(VENDOR_MAX, "Vendor"),
    description: optionalText(DESCRIPTION_MAX, "Description"),
  })
  .refine((data) => data.name !== undefined || data.vendor !== undefined || data.description !== undefined, {
    message: "Provide at least one of name, vendor or description",
  });

export type SystemDetailsChanges = z.infer<typeof systemDetailsSchema>;

type Details = { name: string; vendor: string | null; description: string | null };

const SHOWN_MAX = 120;

function shown(value: string | null) {
  if (value === null) return "Not set";
  const flat = value.replace(/\s+/g, " ");
  return `"${flat.length > SHOWN_MAX ? `${flat.slice(0, SHOWN_MAX)}…` : flat}"`;
}

const FIELDS: { key: keyof Details; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "vendor", label: "Vendor" },
  { key: "description", label: "Description" },
];

/**
 * What an edit changes, as the Change Event's detail: `Name: "Old" → "New"; Vendor: "Not set" → "Acme"`.
 * Long values are cut at 120 characters so the timeline stays readable. Null when nothing differs.
 */
export function describeDetailsChange(before: Details, changes: SystemDetailsChanges): { data: Partial<Details>; detail: string } | null {
  const data: Partial<Details> = {};
  const parts: string[] = [];
  for (const { key, label } of FIELDS) {
    const next = changes[key];
    if (next === undefined || next === before[key]) continue;
    (data as Record<string, string | null>)[key] = next;
    parts.push(`${label}: ${shown(before[key])} → ${shown(next)}`);
  }
  return parts.length === 0 ? null : { data, detail: parts.join("; ") };
}

export type SaveDetailsResult =
  | { status: 200; system: { id: string; name: string; vendor: string | null; description: string | null } }
  | { status: 403 | 404 };

/**
 * Saves a System's details and its Change Event in one transaction. The System row is locked first
 * (`FOR UPDATE`), so overlapping saves run one after the other and each diffs against what the one before
 * wrote, and the owner is re-read under the lock: this is the authoritative permission check, since the
 * route's earlier one can be stale by the time it gets here (an Admin may have handed the System over).
 * Every query uses `tx`.
 */
export async function saveSystemDetails(
  actor: { id: string; role: UserRole },
  systemId: string,
  changes: SystemDetailsChanges,
): Promise<SaveDetailsResult> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "System" WHERE "id" = ${systemId} FOR UPDATE`;
    if (locked.length === 0) return { status: 404 };
    const current = await tx.system.findUnique({
      where: { id: systemId },
      select: { id: true, ownerId: true, name: true, vendor: true, description: true },
    });
    if (!current) return { status: 404 };
    if (!canChangeSystemClassification(actor, current)) return { status: 403 };
    const change = describeDetailsChange(current, changes);
    if (!change) return { status: 200, system: { id: current.id, name: current.name, vendor: current.vendor, description: current.description } };
    const updated = await tx.system.update({
      where: { id: current.id },
      data: change.data,
      select: { id: true, name: true, vendor: true, description: true },
    });
    await logChangeEvent(current.id, "SYSTEM_DETAILS_CHANGED", change.detail, actor.id, tx);
    return { status: 200, system: updated };
  });
}

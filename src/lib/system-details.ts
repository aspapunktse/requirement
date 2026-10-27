import { z } from "zod";

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

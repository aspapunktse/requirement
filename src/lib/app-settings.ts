import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logChangeEvent } from "@/lib/change-events";

/**
 * App Settings (#240): values an Admin can change without a deploy. Each setting is declared once here
 * (key, label, help text, section, type, range, default); the settings page and the API render and validate
 * from this registry, so adding a setting is one entry. A key with no row in `AppSetting` uses its default,
 * so nothing is stored until an Admin saves a value.
 *
 * This file imports only zod and the server-side data helpers below; the registry itself
 * (`APP_SETTINGS`, `SETTING_SECTIONS`) holds plain data, safe to read on the server and pass as props.
 */

export type AppSettingKey = "systems.staleDraftDays" | "systems.underFulfilledPercent" | "organization.name";

type AppSettingBase = {
  key: AppSettingKey;
  section: string;
  label: string;
  help: string;
};

export type IntegerSettingDefinition = AppSettingBase & {
  type: "integer";
  /** The unit shown beside the field, e.g. "days". */
  unit: string;
  min: number;
  max: number;
  default: number;
  /** Does a change move the Systems list's trend lines? (Earlier days keep counting under the old value.) */
  affectsTrends: boolean;
};

/** A free-text setting (#273): trimmed before it is checked or stored; the default "" means unset. */
export type TextSettingDefinition = AppSettingBase & {
  type: "text";
  maxLength: number;
  default: string;
};

export type AppSettingDefinition = IntegerSettingDefinition | TextSettingDefinition;

/** The sections of the settings page, in order. */
export const SETTING_SECTIONS = ["Systems list", "Organization"] as const;

export const APP_SETTINGS: readonly AppSettingDefinition[] = [
  {
    key: "systems.staleDraftDays",
    section: "Systems list",
    label: "Stale Draft after",
    help: "A System that is still a Draft and has not changed for more than this many days needs attention.",
    unit: "days",
    type: "integer",
    min: 1,
    max: 365,
    default: 60,
    affectsTrends: true,
  },
  {
    key: "systems.underFulfilledPercent",
    section: "Systems list",
    label: "\"Under N% met\" threshold",
    help: "The saved view for roles without a view of their own lists Systems whose base-Framework fulfilment is below this percentage.",
    unit: "%",
    type: "integer",
    min: 1,
    max: 100,
    default: 70,
    affectsTrends: true,
  },
  {
    key: "organization.name",
    section: "Organization",
    label: "Organization name",
    help: "Named on the cover of the Statement of Applicability export for audit. Leave it empty to leave the Organization line out.",
    type: "text",
    maxLength: 200,
    default: "",
  },
];

export const isAppSettingKey = (key: string): key is AppSettingKey => APP_SETTINGS.some((setting) => setting.key === key);

export const definitionOf = (key: AppSettingKey): AppSettingDefinition => APP_SETTINGS.find((setting) => setting.key === key)!;

/**
 * The zod schema of a setting's value. An integer setting: a whole number within its range (strings and
 * decimals are refused). A text setting: a string, trimmed, at most `maxLength` characters.
 */
export const schemaOf = (definition: AppSettingDefinition): z.ZodType<number | string> =>
  definition.type === "text"
    ? z.string().trim().max(definition.maxLength)
    : z.number().int().min(definition.min).max(definition.max);

/** What a refused value is told, per type. */
const refusalOf = (definition: AppSettingDefinition) =>
  definition.type === "text"
    ? `${definition.label} must be text of at most ${definition.maxLength} characters`
    : `${definition.label} must be a whole number from ${definition.min} to ${definition.max}`;

export type AppSettingValue = {
  key: AppSettingKey;
  value: number | string;
  /** True when no row is saved (or the saved one no longer fits the declaration) and the default is in use. */
  isDefault: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
};

/** The current value of every setting, in registry order. Reads on the caller's client (`tx` inside a transaction). */
export async function readAppSettings(client: Pick<Prisma.TransactionClient, "appSetting"> = prisma): Promise<AppSettingValue[]> {
  const rows = await client.appSetting.findMany({ include: { updatedBy: { select: { name: true } } } });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return APP_SETTINGS.map((definition) => {
    const row = byKey.get(definition.key);
    const parsed = row ? schemaOf(definition).safeParse(row.value) : null;
    return parsed?.success && row
      ? { key: definition.key, value: parsed.data, isDefault: false, updatedAt: row.updatedAt.toISOString(), updatedByName: row.updatedBy?.name ?? null }
      : { key: definition.key, value: definition.default, isDefault: true, updatedAt: null, updatedByName: null };
  });
}

/** The Systems list's two thresholds, read together (inside the list's RepeatableRead transaction, on `tx`). */
export type SystemsThresholds = { staleDraftDays: number; underFulfilledPercent: number };

const integerDefault = (key: AppSettingKey) => definitionOf(key).default as number;

export const DEFAULT_SYSTEMS_THRESHOLDS: SystemsThresholds = {
  staleDraftDays: integerDefault("systems.staleDraftDays"),
  underFulfilledPercent: integerDefault("systems.underFulfilledPercent"),
};

export async function readSystemsThresholds(tx: Pick<Prisma.TransactionClient, "appSetting">): Promise<SystemsThresholds> {
  const values = new Map((await readAppSettings(tx)).map((setting) => [setting.key, setting.value]));
  const number = (key: AppSettingKey, fallback: number) => {
    const value = values.get(key);
    return typeof value === "number" ? value : fallback;
  };
  return {
    staleDraftDays: number("systems.staleDraftDays", DEFAULT_SYSTEMS_THRESHOLDS.staleDraftDays),
    underFulfilledPercent: number("systems.underFulfilledPercent", DEFAULT_SYSTEMS_THRESHOLDS.underFulfilledPercent),
  };
}

/** The Organization's name (#273), trimmed; null while unset. Reads on the caller's client (`tx` inside a transaction). */
export async function readOrganizationName(tx: Pick<Prisma.TransactionClient, "appSetting">): Promise<string | null> {
  const setting = (await readAppSettings(tx)).find((entry) => entry.key === "organization.name");
  return typeof setting?.value === "string" && setting.value !== "" ? setting.value : null;
}

/** A value as written in a Change Event: text in quotes (so an empty one reads as ""), numbers bare. */
const shown = (value: number | string) => (typeof value === "string" ? JSON.stringify(value) : String(value));

export type SaveSettingResult =
  | { ok: true; changed: boolean; setting: AppSettingValue }
  | { ok: false; status: 400; error: string };

/**
 * Saves one setting for `actorId`. The value is checked against the setting's schema before anything is
 * written. In one transaction (every query on `tx`): the row is upserted and one System-less
 * APP_SETTING_CHANGED Change Event is written. Saving the value the setting already has changes nothing and
 * writes no event (`changed: false`). The old value is read inside the transaction, so the event's detail is
 * the value this write replaced.
 */
export async function saveAppSetting(actorId: string, key: string, value: unknown): Promise<SaveSettingResult> {
  if (!isAppSettingKey(key)) return { ok: false, status: 400, error: `Unknown setting: ${key}` };
  const definition = definitionOf(key);
  const parsed = schemaOf(definition).safeParse(value);
  if (!parsed.success) {
    return { ok: false, status: 400, error: refusalOf(definition) };
  }
  const next = parsed.data;
  return prisma.$transaction(async (tx) => {
    const before = (await readAppSettings(tx)).find((setting) => setting.key === key)!;
    // Same as the value in force (a saved one or the default): nothing is written, no event.
    if (before.value === next) return { ok: true as const, changed: false, setting: before };
    const row = await tx.appSetting.upsert({
      where: { key },
      create: { key, value: next, updatedById: actorId },
      update: { value: next, updatedById: actorId },
      include: { updatedBy: { select: { name: true } } },
    });
    await logChangeEvent(null, "APP_SETTING_CHANGED", `${definition.label} (${key}) changed from ${shown(before.value)} to ${shown(next)}`, actorId, tx);
    return {
      ok: true as const,
      changed: true,
      setting: { key, value: next, isDefault: false, updatedAt: row.updatedAt.toISOString(), updatedByName: row.updatedBy?.name ?? null },
    };
  });
}

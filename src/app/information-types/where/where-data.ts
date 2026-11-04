import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { visibleSystemsWhere } from "@/lib/system-visibility";
import { listInformationTypes } from "@/lib/information-type-data";
import { listSensitivityLevels } from "@/lib/sensitivity-level-data";
import { whereCounts, type WhereCounts } from "@/lib/information-type-where";
import type { InformationTypeRow } from "@/lib/information-type";
import type { SensitivityLevelInfo } from "@/lib/sensitivity-level";

/** A System the acting user may see, as the view lists it. */
export type WhereSystem = { id: string; name: string; isProvider: boolean; sensitivityLevel: number | null; typeIds: string[] };

/**
 * What the "Where can I put this information?" view renders for the acting user (#305).
 * - `systems` holds only the Systems `visibleSystemsWhere` lets the user see, so a hidden System's name never leaves the
 *   server; the page groups them per type with `src/lib/information-type-where.ts`.
 * - `counts` is per type over every System, visible or not (the Statement of Applicability does the same), so the page
 *   can say "N more not visible to you" where its list is shorter than the count.
 */
export type WhereView = {
  types: InformationTypeRow[];
  levels: SensitivityLevelInfo[];
  systems: WhereSystem[];
  counts: Record<string, WhereCounts>;
};

/** One RepeatableRead transaction, every query on `tx`, so the counts and the lists agree. */
export async function loadWhereView(user: { id: string; role: UserRole }): Promise<WhereView> {
  return prisma.$transaction((tx) => readWhereView(tx, user), { isolationLevel: "RepeatableRead" });
}

/** All the reads of the view on the caller's client; the caller owns the snapshot (a test compares two reads in one). */
export async function readWhereView(tx: Prisma.TransactionClient, user: { id: string; role: UserRole }): Promise<WhereView> {
  const types = await listInformationTypes(tx);
  const levels = await listSensitivityLevels(tx);
  const visible = await visibleSystemsWhere(user, tx);
  const all = await tx.system.findMany({
    select: { id: true, name: true, isProvider: true, sensitivityLevel: true, informationTypes: { select: { id: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
  const visibleIds = new Set((await tx.system.findMany({ where: visible, select: { id: true } })).map((system) => system.id));
  const facts = all.map((system) => ({ ...system, typeIds: system.informationTypes.map((type) => type.id) }));
  return {
    types,
    levels,
    systems: facts
      .filter((system) => visibleIds.has(system.id))
      .map((system): WhereSystem => ({ id: system.id, name: system.name, isProvider: system.isProvider, sensitivityLevel: system.sensitivityLevel, typeIds: system.typeIds })),
    counts: Object.fromEntries(types.map((type) => [type.id, whereCounts(type, facts)])),
  };
}

/** The type to show first: the one named in the URL, else the first (highest level) one. Null with an empty catalogue. */
export function pickType(types: readonly { id: string }[], requested: string | null | undefined): string | null {
  return types.find((type) => type.id === requested)?.id ?? types[0]?.id ?? null;
}

import type { Prisma } from "@prisma/client";
import { floorSettingTypes, informationTypeFloor, meetsInformationTypeFloor, type FloorType } from "@/lib/information-type-floor";

/**
 * A System's Information Types on the server side (#304, ADR 0012): reading them, the refusal text when a level is
 * below the floor, and the Change Event wording. The rule itself is `information-type-floor.ts`.
 */

type Db = Pick<Prisma.TransactionClient, "informationType" | "sensitivityLevel">;

/** A refusal found while writing a System's classification: thrown to roll the transaction back, answered as 400. */
export class ClassificationRefused extends Error {
  readonly status = 400 as const;
}

export const UNKNOWN_INFORMATION_TYPES = "One or more Information Type ids do not exist";

async function labelOf(db: Pick<Prisma.TransactionClient, "sensitivityLevel">, level: number): Promise<string> {
  const row = await db.sensitivityLevel.findUnique({ where: { level }, select: { label: true } });
  return row?.label ?? String(level);
}

/**
 * Throws `ClassificationRefused` unless `level` meets the floor of `types`. Called inside the transaction that
 * writes, with the types the System will have after the request, so a below-floor save changes nothing.
 */
export async function assertMeetsInformationTypeFloor(db: Db, level: number | null, types: readonly FloorType[]): Promise<void> {
  if (meetsInformationTypeFloor(level, types)) return;
  const floor = informationTypeFloor(types)!;
  const setters = floorSettingTypes(types).map((type) => type.name).join(", ");
  const floorLabel = await labelOf(db, floor);
  if (level === null) {
    throw new ClassificationRefused(
      `A System with Information Types needs a Sensitivity Level of at least ${floorLabel}: ${setters} sets that floor. Choose a level, or remove the Information Types.`,
    );
  }
  throw new ClassificationRefused(
    `The Sensitivity Level can't be lower than the System's Information Types: ${setters} is ${floorLabel}. Raise the level to ${floorLabel} or higher, or leave the type out.`,
  );
}

/** The Information Types with these ids, or a refusal when any doesn't exist. */
export async function readInformationTypesOrRefuse(db: Pick<Prisma.TransactionClient, "informationType">, ids: readonly string[]): Promise<FloorType[]> {
  const unique = [...new Set(ids)];
  const rows = await db.informationType.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, sensitivityLevel: true } });
  if (rows.length !== unique.length) throw new ClassificationRefused(UNKNOWN_INFORMATION_TYPES);
  return rows;
}

/** A System's declared Information Types, with their current levels. */
export async function readSystemInformationTypes(db: Pick<Prisma.TransactionClient, "informationType">, systemId: string): Promise<FloorType[]> {
  return db.informationType.findMany({
    where: { systems: { some: { id: systemId } } },
    select: { id: true, name: true, sensitivityLevel: true },
    orderBy: { name: "asc" },
  });
}

/** Do these two sets hold the same types? */
export function sameTypeSet(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  const ids = new Set(a.map((type) => type.id));
  return a.length === b.length && b.every((type) => ids.has(type.id));
}

/** The Change Event wording for a change of types: "Information Types: Payroll → Payroll, Source code" ("none" when empty). */
export function describeTypesChange(before: readonly { name: string }[], after: readonly { name: string }[]): string {
  const names = (types: readonly { name: string }[]) => (types.length === 0 ? "none" : types.map((type) => type.name).sort((a, b) => a.localeCompare(b)).join(", "));
  return `Information Types: ${names(before)} → ${names(after)}`;
}

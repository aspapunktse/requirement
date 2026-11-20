import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ControlPackRow } from "@/lib/control-pack";

const codeCollator = new Intl.Collator("en", { numeric: true });

type Db = Prisma.TransactionClient | typeof prisma;

const PACK_SELECT = {
  id: true,
  name: true,
  note: true,
  controls: { select: { control: { select: { id: true, code: true } } } },
} satisfies Prisma.ControlPackSelect;

type PackRecord = Prisma.ControlPackGetPayload<{ select: typeof PACK_SELECT }>;

export function toControlPackRow(pack: PackRecord): ControlPackRow {
  return {
    id: pack.id,
    name: pack.name,
    note: pack.note,
    controlIds: pack.controls
      .map((row) => row.control)
      .sort((a, b) => codeCollator.compare(a.code, b.code))
      .map((control) => control.id),
  };
}

/** Every pack by name. Pass the transaction client from inside a transaction. */
export async function listControlPacks(db: Db = prisma): Promise<ControlPackRow[]> {
  const packs = await db.controlPack.findMany({ select: PACK_SELECT });
  return packs.map(toControlPackRow).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

export async function getControlPack(id: string, db: Db = prisma): Promise<ControlPackRow | null> {
  const pack = await db.controlPack.findUnique({ where: { id }, select: PACK_SELECT });
  return pack ? toControlPackRow(pack) : null;
}

/** The pack whose name matches ignoring case (other than `exceptId`), or null. Same rule as the unique index on lower("name"). */
export async function findPackNamed(tx: Prisma.TransactionClient, name: string, exceptId?: string): Promise<{ id: string; name: string } | null> {
  const rows = await tx.$queryRaw<{ id: string; name: string }[]>`
    SELECT "id", "name" FROM "ControlPack" WHERE lower("name") = lower(${name}) AND "id" <> ${exceptId ?? ""} LIMIT 1`;
  return rows[0] ?? null;
}

/** The ids in `ids` that no Control has. */
export async function missingControlIds(tx: Prisma.TransactionClient, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const found = new Set((await tx.control.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((control) => control.id));
  return ids.filter((id) => !found.has(id));
}

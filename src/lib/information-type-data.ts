import { prisma } from "@/lib/prisma";
import type { InformationTypeRow } from "@/lib/information-type";

export const INFORMATION_TYPE_SELECT = {
  id: true,
  name: true,
  description: true,
  sensitivityLevel: true,
  _count: { select: { systems: true } },
} as const;

type Selected = {
  id: string;
  name: string;
  description: string | null;
  sensitivityLevel: number;
  _count: { systems: number };
};

export function toRow(row: Selected): InformationTypeRow {
  return { id: row.id, name: row.name, description: row.description, sensitivityLevel: row.sensitivityLevel, systemCount: row._count.systems };
}

/** The whole catalogue, highest level first and then by name, each type with the number of Systems declaring it. */
export async function listInformationTypes(client: { informationType: typeof prisma.informationType } = prisma): Promise<InformationTypeRow[]> {
  const rows = await client.informationType.findMany({ select: INFORMATION_TYPE_SELECT, orderBy: [{ sensitivityLevel: "desc" }, { name: "asc" }] });
  return rows.map(toRow);
}

export async function getInformationType(
  id: string,
  client: { informationType: typeof prisma.informationType } = prisma,
): Promise<InformationTypeRow | null> {
  const row = await client.informationType.findUnique({ where: { id }, select: INFORMATION_TYPE_SELECT });
  return row ? toRow(row) : null;
}

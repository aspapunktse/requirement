import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BASE_FRAMEWORK_NOT_SUGGESTED, UNKNOWN_SUGGESTED_FRAMEWORKS, type InformationTypeRow } from "@/lib/information-type";

/** A refusal found while a curator picks the Frameworks a type suggests: thrown inside the transaction, answered as 400. */
export class SuggestedFrameworksRefused extends Error {
  readonly status = 400 as const;
}

/**
 * Checks the Frameworks a curator picked for a type: each must exist and none may be the base Framework (always in
 * scope, so never a suggestion). A Draft Framework is allowed; it suggests once Published (ADR 0013). Throws
 * `SuggestedFrameworksRefused`, so the caller's transaction rolls back and nothing changes.
 */
export async function assertSuggestableFrameworks(db: Pick<Prisma.TransactionClient, "framework">, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await db.framework.findMany({ where: { id: { in: [...ids] } }, select: { id: true, isBase: true } });
  if (rows.length !== new Set(ids).size) throw new SuggestedFrameworksRefused(UNKNOWN_SUGGESTED_FRAMEWORKS);
  if (rows.some((row) => row.isBase)) throw new SuggestedFrameworksRefused(BASE_FRAMEWORK_NOT_SUGGESTED);
}

export const INFORMATION_TYPE_SELECT = {
  id: true,
  name: true,
  description: true,
  sensitivityLevel: true,
  _count: { select: { systems: true } },
  suggestedFrameworks: { select: { id: true, name: true, version: true, status: true }, orderBy: { name: "asc" } },
} as const;

type Selected = {
  id: string;
  name: string;
  description: string | null;
  sensitivityLevel: number;
  _count: { systems: number };
  suggestedFrameworks: { id: string; name: string; version: string; status: "DRAFT" | "PUBLISHED" }[];
};

/**
 * One type as the API and the page show it. A Draft Framework is shown only with `includeDrafts` (for a viewer who may
 * see Drafts: the Compliance Manager and an Admin); to everyone else Draft Frameworks don't exist (#73).
 */
export function toRow(row: Selected, includeDrafts = false): InformationTypeRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sensitivityLevel: row.sensitivityLevel,
    systemCount: row._count.systems,
    suggestedFrameworks: row.suggestedFrameworks.filter((framework) => includeDrafts || framework.status === "PUBLISHED"),
  };
}

/** The whole catalogue, highest level first and then by name, each type with the number of Systems declaring it. */
export async function listInformationTypes(
  client: { informationType: typeof prisma.informationType } = prisma,
  includeDrafts = false,
): Promise<InformationTypeRow[]> {
  const rows = await client.informationType.findMany({ select: INFORMATION_TYPE_SELECT, orderBy: [{ sensitivityLevel: "desc" }, { name: "asc" }] });
  return rows.map((row) => toRow(row, includeDrafts));
}

export async function getInformationType(
  id: string,
  client: { informationType: typeof prisma.informationType } = prisma,
  includeDrafts = false,
): Promise<InformationTypeRow | null> {
  const row = await client.informationType.findUnique({ where: { id }, select: INFORMATION_TYPE_SELECT });
  return row ? toRow(row, includeDrafts) : null;
}
